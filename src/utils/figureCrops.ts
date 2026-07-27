import fs from 'fs';

export interface CropRequest {
  id: unknown;      // opaque handle the caller uses to map the result back
  page: number;     // 1-based page number
  bbox: number[];   // [ymin, xmin, ymax, xmax], each normalized 0..1000 (top-left origin)
}

/**
 * Tighten a rendered crop to its actual ink. The model's boxes are often loose,
 * but these figures are dark line-art on a light background, so we can trim the
 * all-but-white margins deterministically. The luminance threshold is set low
 * enough to ignore light-gray page watermarks and anti-aliasing halos. Returns
 * the content rectangle within the canvas, or null if the crop is effectively
 * blank.
 */
function findContentRect(
  ctx: any,
  w: number,
  h: number,
  threshold = 165,
  margin = 8,
): { x: number; y: number; w: number; h: number } | null {
  const data = ctx.getImageData(0, 0, w, h).data as Uint8ClampedArray;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] <= 20) continue; // transparent == background
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(w - 1, maxX + margin);
  maxY = Math.min(h - 1, maxY + margin);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Render the referenced PDF pages with mupdf and crop each requested bounding
 * box to a PNG data URI. mupdf is used because pdf.js cannot rasterize these
 * papers (unsupported knockout transparency groups), whereas mupdf renders both
 * vector line-art and raster images reliably.
 *
 * Pages are rendered once and reused across all crops that fall on them. Returns
 * a Map keyed by each request's `id`. Best-effort: failures are skipped, never
 * thrown.
 */
export async function cropFigures(
  pdfPath: string,
  requests: CropRequest[],
  opts: { dpi?: number; padFraction?: number } = {}
): Promise<Map<unknown, string>> {
  const result = new Map<unknown, string>();
  if (requests.length === 0) return result;

  const dpi = opts.dpi ?? 150;
  // Keep the pre-crop margin small: the whitespace trim only removes blank
  // borders (it can't separate a figure from adjacent text), so grabbing extra
  // here risks pulling neighboring columns/captions into a dense-layout crop.
  const pad = opts.padFraction ?? 0.008;

  try {
    const mupdf: any = await import('mupdf');
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');

    const doc = mupdf.Document.openDocument(fs.readFileSync(pdfPath), 'application/pdf');
    const numPages = doc.countPages();
    const scale = dpi / 72;
    const matrix = mupdf.Matrix.scale(scale, scale);

    // Group requests by page so each page is rendered only once.
    const byPage = new Map<number, CropRequest[]>();
    for (const r of requests) {
      if (!Array.isArray(r.bbox) || r.bbox.length !== 4) continue;
      if (!Number.isFinite(r.page) || r.page < 1 || r.page > numPages) continue;
      (byPage.get(r.page) ?? byPage.set(r.page, []).get(r.page)!).push(r);
    }

    for (const [pageNum, reqs] of byPage) {
      let img: any;
      try {
        const page = doc.loadPage(pageNum - 1);
        const pix = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
        img = await loadImage(Buffer.from(pix.asPNG()));
      } catch (pageErr) {
        console.warn(`Failed to render page ${pageNum} for cropping:`, (pageErr as any)?.message || pageErr);
        continue;
      }

      const W = img.width, H = img.height;
      for (const r of reqs) {
        try {
          let [ymin, xmin, ymax, xmax] = r.bbox;
          if (xmax < xmin) [xmin, xmax] = [xmax, xmin];
          if (ymax < ymin) [ymin, ymax] = [ymax, ymin];

          const sx = Math.max(0, Math.floor((xmin / 1000) * W - pad * W));
          const sy = Math.max(0, Math.floor((ymin / 1000) * H - pad * H));
          const ex = Math.min(W, Math.ceil((xmax / 1000) * W + pad * W));
          const ey = Math.min(H, Math.ceil((ymax / 1000) * H + pad * H));
          const sw = ex - sx, sh = ey - sy;
          if (sw < 6 || sh < 6) continue;

          // Crop the model's (padded) box out of the rendered page.
          const canvas = createCanvas(sw, sh);
          const cctx = canvas.getContext('2d');
          cctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

          // Auto-tighten to the actual figure ink.
          let outCanvas = canvas;
          const rect = findContentRect(cctx, sw, sh);
          if (rect && (rect.w < sw || rect.h < sh) && rect.w >= 6 && rect.h >= 6) {
            outCanvas = createCanvas(rect.w, rect.h);
            outCanvas.getContext('2d').drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
          }

          result.set(r.id, 'data:image/png;base64,' + outCanvas.toBuffer('image/png').toString('base64'));
        } catch (cropErr) {
          console.warn(`Failed to crop a figure on page ${pageNum}:`, (cropErr as any)?.message || cropErr);
        }
      }
    }
  } catch (err) {
    console.warn('Figure cropping unavailable:', (err as any)?.message || err);
  }

  return result;
}

export default cropFigures;
