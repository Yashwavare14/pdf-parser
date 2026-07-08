import fs from 'fs';
import path from 'path';

// Try to implement rasterization using pdfjs-dist + node-canvas. If the
// native canvas module or pdfjs cannot be loaded (for example on platforms
// without native build deps), the function will return null as a safe fallback.
export async function rasterizePage(pdfPath: string, pageNumber: number, dpi = 150) {
  try {
    // dynamic imports to avoid hard dependency failures at runtime
    // when canvas native build isn't available
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createCanvas } = await import('canvas');

    // Ensure worker is set (pdfjs expects a worker file in browsers; for
    // node we can set disableWorker to true by passing disableStream
    // options to getDocument or leave default behavior)

    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = pdfjs.getDocument({ data });
    const doc = await loadingTask.promise;
    const page = await doc.getPage(pageNumber);

    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const pngBuffer = canvas.toBuffer('image/png');
    const base64 = pngBuffer.toString('base64');
    return { base64, mimeType: 'image/png' };
  } catch (err) {
    console.warn('Rasterization unavailable or failed:', (err as any)?.message || err);
    return null;
  }
}

export default rasterizePage;
