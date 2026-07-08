import express, { Request, Response } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { UniversalExamSchema } from '../schema.js';
import { uploadPdfAndGenerate } from '../services/geminiParser.js';
import * as dotenv from 'dotenv';
import { UniversalExam } from '../schema.js';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { LLMProvider } from '../providers/types.js';
import { getSubjectParser, detectSectionKey, listSubjects } from '../parsers/registry.js';
import { getLLMProvider, getVisionFallbackProvider } from '../providers/index.js';
import { rasterizePage } from '../utils/rasterize.js';
import { extractPdfText } from '../utils/pdfText.js';

dotenv.config();

const router = express.Router();

// ensure uploads directory exists
const uploadsDir = path.resolve('uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req: any, file: any, cb: any) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

async function extractWithProvider(
  providerName: string,
  provider: LLMProvider,
  pdfPath: string,
  prompt: string,
  model: string,
  responseSchema: any
) {
  if (providerName === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    return await uploadPdfAndGenerate(apiKey!, pdfPath, model, [prompt], responseSchema, 0.1);
  }

  const documentText = await extractPdfText(pdfPath);
  const combinedPrompt = `${prompt}\n\nDOCUMENT TEXT:\n${documentText}`;
  const responseText = await provider.generateJSON(combinedPrompt, responseSchema);

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (err) {
    throw new Error('Provider returned invalid JSON: ' + String(err));
  }

  return { parsed, raw: { text: responseText } };
}

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// Extract sections from PDF
router.post('/extract-sections', upload.single('pdfFile'), async (req: Request, res: Response) => {
  const file = (req as any).file;
  const bodyPdf = req.body?.pdfFileName;

  if (!file && !bodyPdf) return res.status(400).json({ error: "Provide a PDF file upload ('pdfFile') or a server path in 'pdfFileName'." });

  const pdfPath = file ? (file as any).path : bodyPdf;
  const selectedProvider = (req.body?.provider as string) || (process.env.LLM_PROVIDER || 'gemini');
  const selectedModel = (req.body?.model as string) || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (selectedProvider === 'openai' && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
  }

  if (selectedProvider === 'gemini' && !process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
  }

  try {
    const sectionSchema = zodToJsonSchema(
      z.object({
        sections: z.array(z.object({
          name: z.string(),
          description: z.string().optional()
        }))
      })
    ) as any;

    const prompt = `Analyze this PDF and identify all main sections/chapters/parts. Return a JSON object with an array of sections, each with a name and optional description. For example: {"sections": [{"name": "Part 1: Algebra", "description": "Questions 1-10"}, ...]}`;

    const provider = getLLMProvider(selectedProvider);
    const { parsed, raw } = await extractWithProvider(
      selectedProvider,
      provider,
      pdfPath,
      prompt,
      selectedModel,
      sectionSchema
    );

    if (!parsed) return res.status(500).json({ error: 'Empty model response.' });

    return res.status(200).json({ success: true, sections: parsed.sections || [] });
  } catch (err: any) {
    console.error('Section extraction error:', err);
    return res.status(500).json({ error: err.message || 'Internal section extraction error' });
  } finally {
    if (file) {
      try {
        fs.unlinkSync((file as any).path);
      } catch (e) {
        console.warn('Failed to remove temporary uploaded file:', e);
      }
    }
  }
});

router.get('/list-subjects', (_req: Request, res: Response) => {
  try {
    const subjects = listSubjects();
    return res.status(200).json({ success: true, subjects });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to list subjects' });
  }
});

// Accept either a multipart file upload under 'pdfFile' or a JSON body with pdfFileName (server path)
router.post('/extract-blocks', upload.single('pdfFile'), async (req: Request, res: Response) => {
  const file = (req as any).file;
  const bodyPdf = req.body?.pdfFileName;

  if (!file && !bodyPdf) return res.status(400).json({ error: "Provide a PDF file upload ('pdfFile') or a server path in 'pdfFileName'." });

  const pdfPath = file ? (file as any).path : bodyPdf;
  const selectedProvider = (req.body?.provider as string) || (process.env.LLM_PROVIDER || 'gemini');
  const selectedModel = (req.body?.model as string) || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (selectedProvider === 'openai' && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
  }

  if (selectedProvider === 'gemini' && !process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
  }

  const geminiSchema = zodToJsonSchema(UniversalExamSchema) as any;
  const section = req.body?.section as string | undefined;

  try {
    // If a subject is provided (or can be detected from the section name), use its parser
    const subjectParam = (req.body?.subject as string) || undefined;
    let subjectKey: string | undefined = subjectParam;
    if (!subjectKey && section) {
      // try to map the selected section heading to a subject key
      subjectKey = detectSectionKey(section) || undefined;
    }

    let prompt = `Extract exam questions into strict JSON format. CRITICAL: Output ONLY valid, complete JSON with no truncation. Close all strings and objects properly. For each question: number, body (text blocks), type, options (a/b/c/d), answer_key, brief explanation. Math as LaTeX, tables as 2D arrays, images as placeholders. Ensure valid JSON syntax - no unterminated strings.`;

    if (subjectKey) {
      try {
        const parser = getSubjectParser(subjectKey);
        // buildPrompt may accept context such as the section heading
        prompt = parser.buildPrompt(section || subjectKey);
      } catch (e) {
        console.warn('Unknown subject key, falling back to generic prompt', subjectKey);
      }
    } else if (section) {
      prompt += ` IMPORTANT: Extract ONLY questions from the section titled "${section}". Skip all other sections.`;
    }

    const provider = getLLMProvider(selectedProvider);
    const visionProvider = 'generateFromImage' in provider && typeof provider.generateFromImage === 'function'
      ? provider
      : getVisionFallbackProvider();

    let finalPrompt = prompt;
    let imageInput: string | undefined;
    let imageMimeType: string | undefined;

    if (subjectKey) {
      const parser = getSubjectParser(subjectKey);

      if (parser.needsMultimodal) {
        const rasterized = await rasterizePage(pdfPath, 1);
        if (rasterized?.base64) {
          imageInput = rasterized.base64;
          imageMimeType = rasterized.mimeType;
        }

        if (imageInput && 'generateFromImage' in visionProvider && typeof visionProvider.generateFromImage === 'function') {
          try {
            const visionPrompt = `Extract any diagram or image-based detail from this page for subject: ${parser.label}. Summarize it as text that can be used in the final JSON extraction.`;
            const visionText = await visionProvider.generateFromImage(
              visionPrompt,
              imageInput,
              imageMimeType || 'image/png'
            );
            finalPrompt = parser.buildPrompt([visionText, section || subjectKey].filter(Boolean).join('\n\n'));
          } catch (imageErr) {
            console.warn('Vision extraction failed, falling back to text prompt:', imageErr);
            finalPrompt = parser.buildPrompt(section || subjectKey);
          }
        } else {
          if (!imageInput) {
            console.warn('Unable to rasterize PDF for multimodal extraction; using text-only prompt.');
          }
          finalPrompt = parser.buildPrompt(section || subjectKey);
        }
      } else {
        finalPrompt = parser.buildPrompt(section || subjectKey);
      }
    }

    const { parsed, raw } = await extractWithProvider(
      selectedProvider,
      provider,
      pdfPath,
      finalPrompt,
      selectedModel,
      geminiSchema
    );

    if (!parsed) return res.status(500).json({ error: 'Empty model response.' });

    const validated = UniversalExamSchema.safeParse(parsed as UniversalExam);
    if (!validated.success) {
      return res.status(422).json({ error: 'Schema validation failed', details: validated.error.errors });
    }

    return res.status(200).json({ success: true, data: validated.data });
  } catch (err: any) {
    console.error('Extraction error:', err);
    return res.status(500).json({ error: err.message || 'Internal extraction error' });
  } finally {
    // remove local uploaded file if present
    if (file) {
      try {
        fs.unlinkSync((file as any).path);
      } catch (e) {
        console.warn('Failed to remove temporary uploaded file:', e);
      }
    }
  }
});

export default router;
