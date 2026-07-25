import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

type UploadedMeta = any;

/**
 * Attempt to repair truncated JSON produced by a cut-off model stream.
 *
 * Strategy: walk the text tracking the open-container stack and string state.
 * If the whole document closes cleanly we return it as-is. Otherwise we rewind
 * to the last "safe" boundary — a completed element, i.e. right after a closing
 * `}`/`]` or the comma that follows a complete value — drop the partial trailing
 * element, and append the closers needed to balance the containers still open at
 * that boundary. This yields valid JSON that preserves every fully-received item.
 */
function attemptJsonRepair(text: string): string | null {
  const stack: string[] = []; // closers ('}' / ']') for each open container
  let inString = false;
  let escapeNext = false;
  let lastSafe = -1; // cut point (exclusive) of the last completed element
  let lastSafeStack: string[] = []; // containers still open at that cut point

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (char === '\\') {
        escapeNext = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']');
    } else if (char === '}' || char === ']') {
      stack.pop();
      if (stack.length === 0) {
        // A top-level value closed cleanly; anything after it is trailing noise.
        return text.substring(0, i + 1);
      }
      lastSafe = i + 1;
      lastSafeStack = stack.slice();
    } else if (char === ',' && stack.length > 0) {
      // The element before the comma is complete; the comma itself is dropped.
      lastSafe = i;
      lastSafeStack = stack.slice();
    }
  }

  if (lastSafe <= 0) return null;

  const closers = lastSafeStack.slice().reverse().join('');
  const repaired = text.substring(0, lastSafe).replace(/,\s*$/, '') + closers;
  console.log(`Truncated stream; rewound to position ${lastSafe} and balanced ${lastSafeStack.length} container(s).`);
  return repaired;
}

export async function uploadPdfAndGenerate(
  apiKey: string,
  pdfPath: string,
  model: string,
  contents: any[],
  responseSchema: any,
  temperature = 0.1
): Promise<{ parsed?: any; raw?: any }>{
  // Extended timeout for Gemini API requests (15 minutes)
  const ai = new GoogleGenAI({ apiKey });

  const resolvedPath = path.resolve(pdfPath);
  if (!fs.existsSync(resolvedPath)) throw new Error(`File not found: ${pdfPath}`);

  let uploaded: UploadedMeta | null = null;

  try {
    uploaded = await ai.files.upload({ file: resolvedPath, config: { mimeType: 'application/pdf' } });

    const fileContent = uploaded && uploaded.uri ? {
      fileData: {
        fileUri: uploaded.uri,
        mimeType: 'application/pdf'
      }
    } : null;

    const requestContents = fileContent ? [fileContent, ...contents] : [...contents];
    console.log('generateContent request contents:', JSON.stringify(requestContents, null, 2));

    // Use streaming to avoid timeout on large responses and allow longer generated JSON.
    const stream = await ai.models.generateContentStream({
      model,
      contents: requestContents,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: responseSchema,
        maxOutputTokens: 200000,
        temperature
      }
    });

    let fullText = '';
    for await (const chunk of stream) {
      if (chunk.text) {
        fullText += chunk.text;
        console.log(`Received chunk (${chunk.text.length} chars), total: ${fullText.length}`);
      }
    }

    console.log('Full response length:', fullText.length);
    console.log('Response first 500 chars:', fullText.substring(0, 500));

    if (fullText) {
      try {
        const parsed = JSON.parse(fullText);
        return { parsed, raw: { text: fullText } };
      } catch (err: any) {
        console.error('JSON parse error:', err.message);
        console.error('Response length:', fullText.length);
        console.error('Last 500 chars:', fullText.substring(Math.max(0, fullText.length - 500)));
        
        // Attempt to repair truncated JSON by removing incomplete fields
        console.log('Attempting to repair truncated JSON...');
        const repaired = attemptJsonRepair(fullText);
        if (repaired) {
          try {
            const parsed = JSON.parse(repaired);
            console.log('Successfully repaired and parsed JSON');
            return { parsed, raw: { text: repaired } };
          } catch (repairErr: any) {
            console.error('Repair failed:', repairErr.message);
            throw err; // throw original error if repair fails
          }
        }
        throw err;
      }
    }

    return { parsed: undefined, raw: { text: fullText } };
  } catch (err: any) {
    // Handle timeout errors specifically
    if (err.cause?.code === 'UND_ERR_HEADERS_TIMEOUT' || err.message?.includes('Headers Timeout')) {
      throw new Error(
        'Gemini API request timed out. The PDF may be too large or complex. ' +
        'Try with a smaller PDF or break it into sections.'
      );
    }
    if (err.message?.includes('fetch failed')) {
      throw new Error(
        'Failed to connect to Gemini API: ' + (err.cause?.message || err.message)
      );
    }
    // Re-throw other errors
    throw err;
  } finally {
    if (uploaded) {
      try {
        await ai.files.delete({ name: uploaded.name });
      } catch (err) {
        // swallow cleanup errors but log them — do not throw from cleanup
        console.warn('Failed to cleanup uploaded file:', err);
      }
    }
  }
}
