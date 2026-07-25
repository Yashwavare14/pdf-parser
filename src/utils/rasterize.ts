import fs from 'fs';

export interface RasterizedPage {
  page: number;
  base64: string;
  mimeType: string;
}

/**
 * Render PDF pages to PNG images using pdfjs-dist + @napi-rs/canvas.
 *
 * @napi-rs/canvas ships prebuilt native binaries (works on Windows/macOS/Linux
 * without a compiler), so this no longer silently fails the way the old
 * `canvas` dependency did. If loading still fails for any reason we return an
 * empty result so callers can fall back to text-only extraction.
 */
async function renderPages(pdfPath: string, pageNumbers: number[], dpi: number): Promise<RasterizedPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
  const { createCanvas } = await import('@napi-rs/canvas');

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;

  const results: RasterizedPage[] = [];
  for (const pageNumber of pageNumbers) {
    if (pageNumber < 1 || pageNumber > doc.numPages) continue;

    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx as any, viewport }).promise;

    const base64 = canvas.toBuffer('image/png').toString('base64');
    results.push({ page: pageNumber, base64, mimeType: 'image/png' });
  }

  return results;
}

/**
 * Rasterize a single page. Returns null on failure (safe fallback).
 */
export async function rasterizePage(pdfPath: string, pageNumber: number, dpi = 150) {
  try {
    const [result] = await renderPages(pdfPath, [pageNumber], dpi);
    return result ? { base64: result.base64, mimeType: result.mimeType } : null;
  } catch (err) {
    console.warn('Rasterization unavailable or failed:', (err as any)?.message || err);
    return null;
  }
}

/**
 * Rasterize every page (up to `maxPages`) of the PDF. Returns [] on failure.
 */
export async function rasterizePages(pdfPath: string, maxPages = 10, dpi = 150): Promise<RasterizedPage[]> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const doc = await pdfjs.getDocument({ data }).promise;
    const total = Math.min(doc.numPages, maxPages);
    const pageNumbers = Array.from({ length: total }, (_, i) => i + 1);
    return await renderPages(pdfPath, pageNumbers, dpi);
  } catch (err) {
    console.warn('Rasterization unavailable or failed:', (err as any)?.message || err);
    return [];
  }
}

export default rasterizePage;
