import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

type UploadedMeta = any;

/**
 * Attempt to repair truncated JSON by removing incomplete trailing fields.
 * Handles cases where a string literal was cut off mid-stream.
 */
function attemptJsonRepair(text: string): string | null {
  // Find the last opening brace or bracket that's properly nested
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let lastValidPos = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{' || char === '[') {
        depth++;
      } else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          lastValidPos = i + 1;
        }
      }
    }
  }

  if (lastValidPos > 0 && lastValidPos < text.length) {
    const repaired = text.substring(0, lastValidPos);
    console.log(`Truncated at position ${lastValidPos}, repaired to valid JSON`);
    return repaired;
  }

  return null;
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
