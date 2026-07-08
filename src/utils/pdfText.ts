import fs from 'fs';

export async function extractPdfText(pdfPath: string, maxChars = 150000) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;

  let text = '';
  for (let pageIndex = 1; pageIndex <= doc.numPages; pageIndex++) {
    const page = await doc.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => (item && typeof item.str === 'string' ? item.str : ''))
      .join(' ');

    text += `\n\n--- Page ${pageIndex} ---\n${pageText}`;
    if (text.length >= maxChars) {
      text = text.slice(0, maxChars);
      break;
    }
  }

  return text.trim();
}

export default extractPdfText;
