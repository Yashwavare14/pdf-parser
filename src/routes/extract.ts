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

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// Extract sections from PDF
router.post('/extract-sections', upload.single('pdfFile'), async (req: Request, res: Response) => {
  const file = (req as any).file;
  const bodyPdf = req.body?.pdfFileName;

  if (!file && !bodyPdf) return res.status(400).json({ error: "Provide a PDF file upload ('pdfFile') or a server path in 'pdfFileName'." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });

  const pdfPath = file ? (file as any).path : bodyPdf;

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

    const { parsed, raw } = await uploadPdfAndGenerate(apiKey, pdfPath, 'gemini-2.5-flash', [prompt], sectionSchema, 0.1);

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

// Accept either a multipart file upload under 'pdfFile' or a JSON body with pdfFileName (server path)
router.post('/extract-blocks', upload.single('pdfFile'), async (req: Request, res: Response) => {
  const file = (req as any).file;
  const bodyPdf = req.body?.pdfFileName;

  if (!file && !bodyPdf) return res.status(400).json({ error: "Provide a PDF file upload ('pdfFile') or a server path in 'pdfFileName'." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });

  const geminiSchema = zodToJsonSchema(UniversalExamSchema) as any;

  const pdfPath = file ? (file as any).path : bodyPdf;
  const section = req.body?.section as string | undefined;

  try {
    let prompt = `Extract exam questions into strict JSON format. CRITICAL: Output ONLY valid, complete JSON with no truncation. Close all strings and objects properly. For each question: number, body (text blocks), type, options (a/b/c/d), answer_key, brief explanation. Math as LaTeX, tables as 2D arrays, images as placeholders. Ensure valid JSON syntax - no unterminated strings.`;
    
    if (section) {
      prompt += ` IMPORTANT: Extract ONLY questions from the section titled "${section}". Skip all other sections.`;
    }

    const { parsed, raw } = await uploadPdfAndGenerate(apiKey, pdfPath, 'gemini-2.5-flash', [prompt], geminiSchema, 0.1);

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
