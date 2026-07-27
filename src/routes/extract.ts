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
import { rasterizePages } from '../utils/rasterize.js';
import { extractPdfText } from '../utils/pdfText.js';
import { cropFigures, CropRequest } from '../utils/figureCrops.js';

dotenv.config();

const router = express.Router();

// Cap how many pages we rasterize for the multimodal/vision pass, to bound
// API calls and latency on large papers.
const MAX_VISION_PAGES = 10;

// Appended to every extraction prompt so the model locates each figure with a
// page number and bounding box, which we then crop out of the rendered page.
const IMAGE_INSTRUCTION = `\n\nIMAGE HANDLING: When a question, option, passage, or explanation contains a figure/diagram/picture/chart (including reasoning diagrams, geometric shapes, cubes, figure series, mirror images, graphs, etc.), insert a content block of type "image_placeholder" at that position with these fields:
- image_reference_tag: a short human-readable label, e.g. "figure for Q5" or "option (a) figure".
- image_page: the 1-based PDF page number on which the figure appears.
- image_bbox: the figure's bounding box as [ymin, xmin, ymax, xmax], where each value is an integer from 0 to 1000 normalized to that page's dimensions. The origin (0,0) is the TOP-LEFT corner of the page; (1000,1000) is the BOTTOM-RIGHT corner. ymin/ymax are vertical (top→bottom), xmin/xmax are horizontal (left→right). Make the box tightly enclose the entire figure and nothing else — do not include the question text, option letters, or neighboring columns.
For example, a figure sitting in the upper-right region of the page might be image_page: 1, image_bbox: [180, 640, 300, 940] (roughly the top-right; ymin<ymax and xmin<xmax always).
Emit a separate image_placeholder for every distinct figure — if a question has a stem figure and four option figures, that is five image_placeholder blocks, each with its own tight image_bbox. Only add blocks for figures that visually exist. Never output raw image bytes or base64.`;

type AnyBlock = {
  type?: string;
  image_reference_tag?: string;
  image_page?: number;
  image_bbox?: number[];
  image_data_uri?: string;
};

/** Walk every content block in an extracted exam document. */
function forEachBlock(data: any, fn: (block: AnyBlock) => void) {
  const visit = (blocks: any) => Array.isArray(blocks) && blocks.forEach(fn);
  for (const cluster of data?.question_clusters || []) {
    visit(cluster?.shared_context_blocks);
    for (const q of cluster?.sub_questions || []) {
      visit(q?.question_body);
      visit(q?.explanation);
      for (const opt of q?.options || []) visit(opt?.content);
    }
  }
}

/** Collect crop requests for every figure the model localized with page + bbox. */
function collectFigureCrops(data: any): { block: AnyBlock; request: CropRequest }[] {
  const jobs: { block: AnyBlock; request: CropRequest }[] = [];
  forEachBlock(data, (b) => {
    if (
      b?.type === 'image_placeholder' &&
      typeof b.image_page === 'number' &&
      Array.isArray(b.image_bbox) &&
      b.image_bbox.length === 4
    ) {
      jobs.push({ block: b, request: { id: b, page: b.image_page, bbox: b.image_bbox } });
    }
  });
  return jobs;
}

// ensure uploads directory exists
const uploadsDir = path.resolve('uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

/**
 * Resolve a client-supplied server-side PDF name to a path that is guaranteed
 * to live inside the uploads directory. Prevents path-traversal / arbitrary
 * file reads via the `pdfFileName` body field. Returns null if the name escapes
 * the uploads dir or the file does not exist.
 */
function resolveServerPdf(bodyPdf: string): string | null {
  const candidate = path.resolve(uploadsDir, path.basename(String(bodyPdf)));
  const rel = path.relative(uploadsDir, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(candidate)) return null;
  return candidate;
}

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

  const pdfPath = file ? (file as any).path : resolveServerPdf(bodyPdf);
  if (!pdfPath) return res.status(400).json({ error: "Invalid PDF reference. Upload a file or provide a valid filename in 'pdfFileName' (must exist in the uploads directory)." });
  const selectedProvider = (req.body?.provider as string) || (process.env.LLM_PROVIDER || 'gemini');
  const selectedModel = (req.body?.model as string) || process.env.GEMINI_MODEL || 'gemini-2.5-pro';

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

    const prompt = `Analyze this PDF and identify all main sections/chapters/parts. Return a JSON object with an array of sections, each with a name and optional description. For example: {"sections": [{"name": "Part 1: Algebra", "description": "Questions 1-10"}, ...]}. Wrap mathematical expressions in dollar delimiters for inline math ($...$) or display math ($$...$$) whenever present.`;

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

  const pdfPath = file ? (file as any).path : resolveServerPdf(bodyPdf);
  if (!pdfPath) return res.status(400).json({ error: "Invalid PDF reference. Upload a file or provide a valid filename in 'pdfFileName' (must exist in the uploads directory)." });
  const selectedProvider = (req.body?.provider as string) || (process.env.LLM_PROVIDER || 'gemini');
  const selectedModel = (req.body?.model as string) || process.env.GEMINI_MODEL || 'gemini-2.5-pro';

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

    let prompt = `Extract exam questions into strict JSON format. CRITICAL: Output ONLY valid, complete JSON with no truncation. Close all strings and objects properly. For each question: number, body (text blocks), type, options (a/b/c/d), answer_key, brief explanation. Wrap mathematical expressions in dollar delimiters for inline math ($...$) or display math ($$...$$). Tables as 2D arrays, images as placeholders. Ensure valid JSON syntax - no unterminated strings.`;

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

    if (subjectKey) {
      const parser = getSubjectParser(subjectKey);
      const contextHint = section || subjectKey;

      if (parser.needsMultimodal) {
        const pages = await rasterizePages(pdfPath, MAX_VISION_PAGES);
        const canDoVision = 'generateFromImage' in visionProvider && typeof visionProvider.generateFromImage === 'function';

        if (pages.length > 0 && canDoVision) {
          const visionSummaries: string[] = [];
          for (const page of pages) {
            try {
              const visionPrompt = `Extract any diagram or image-based detail from page ${page.page} for subject: ${parser.label}. Summarize it as text that can be used in the final JSON extraction.`;
              const visionText = await visionProvider.generateFromImage!(
                visionPrompt,
                page.base64,
                page.mimeType
              );
              if (visionText?.trim()) visionSummaries.push(`[Page ${page.page}] ${visionText.trim()}`);
            } catch (imageErr) {
              console.warn(`Vision extraction failed for page ${page.page}:`, imageErr);
            }
          }
          finalPrompt = parser.buildPrompt([visionSummaries.join('\n\n'), contextHint].filter(Boolean).join('\n\n'));
        } else {
          if (pages.length === 0) {
            console.warn('Unable to rasterize PDF for multimodal extraction; using text-only prompt.');
          }
          finalPrompt = parser.buildPrompt(contextHint);
        }
      } else {
        finalPrompt = parser.buildPrompt(contextHint);
      }
    }

    // Ask the model to tag figures with IDs matching our image extractor.
    finalPrompt += IMAGE_INSTRUCTION;

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

    const data: any = validated.data;

    // For each figure the model localized (page + bbox), render that page with
    // mupdf, crop the box, and inline the PNG as base64 on that block. Automatic
    // association — the box travels with its own question. Best-effort: never
    // fail the request over image cropping.
    const cropJobs = collectFigureCrops(data);
    if (cropJobs.length > 0) {
      try {
        const crops = await cropFigures(pdfPath, cropJobs.map((j) => j.request));
        for (const job of cropJobs) {
          const uri = crops.get(job.block);
          if (uri) job.block.image_data_uri = uri;
        }
      } catch (imgErr) {
        console.warn('Failed to crop figures:', imgErr);
      }
    }

    return res.status(200).json({ success: true, data });
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
