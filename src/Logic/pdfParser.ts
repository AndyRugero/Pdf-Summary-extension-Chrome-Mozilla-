import * as pdfjsLib from 'pdfjs-dist';

// Load the matching worker version (6.3.289) from our public assets folder
if (typeof window !== 'undefined' && pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = window.location.origin + '/pdf.worker.min.mjs';
}

/**
 * Helper to parse a page range string (e.g. "1-3, 5, 7-10") into an array of page numbers.
 */
export function parsePageRange(rangeStr: string, totalPages: number): number[] {
  const pages = new Set<number>();
  const cleaned = rangeStr.replace(/\s+/g, '').trim();
  
  if (!cleaned || cleaned.toLowerCase() === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  
  const parts = cleaned.split(',');
  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const s = Math.max(1, Math.min(start, totalPages));
        const e = Math.max(1, Math.min(end, totalPages));
        const min = Math.min(s, e);
        const max = Math.max(s, e);
        for (let i = min; i <= max; i++) {
          pages.add(i);
        }
      }
    } else {
      const page = parseInt(part, 10);
      if (!isNaN(page) && page >= 1 && page <= totalPages) {
        pages.add(page);
      }
    }
  }
  
  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Extracts plain text from a PDF's ArrayBuffer page-by-page.
 */
export async function extractTextFromPdf(
  arrayBuffer: ArrayBuffer,
  onProgress?: (percent: number) => void,
  pageRange?: string
): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  
  if (onProgress) {
    loadingTask.onProgress = (progressData: { loaded: number, total: number }) => {
      if (progressData.total > 0) {
        const percent = Math.round((progressData.loaded / progressData.total) * 50); // first 50% for loading
        onProgress(percent);
      }
    };
  }

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const pagesToParse = parsePageRange(pageRange || 'all', numPages);
  
  let fullText = '';

  for (let index = 0; index < pagesToParse.length; index++) {
    const i = pagesToParse[index];
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    const pageText = textContent.items
      .map((item: any) => item.str || '')
      .join(' ');
      
    fullText += `[Page ${i}]\n${pageText}\n\n`;
    
    if (onProgress) {
      // Second 50% is parsing pages (scaled from 50 to 100)
      const parsePercent = 50 + Math.round(((index + 1) / pagesToParse.length) * 50);
      onProgress(parsePercent);
    }
  }

  return fullText.trim();
}

/**
 * Downloads a PDF from a URL and extracts its text.
 * Bypasses CORS in the extension background/popup environment.
 */
export async function fetchPdfAndExtractText(
  url: string,
  onProgress?: (stage: string, percent: number) => void,
  pageRange?: string
): Promise<{ text: string; title: string }> {
  if (onProgress) onProgress('Downloading PDF...', 5);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download PDF from ${url} (Status ${response.status})`);
  }
  
  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  
  const reader = response.body?.getReader();
  if (!reader) {
    if (onProgress) onProgress('Downloading PDF...', 30);
    const buffer = await response.arrayBuffer();
    if (onProgress) onProgress('Parsing PDF...', 50);
    const text = await extractTextFromPdf(buffer, (percent) => {
      if (onProgress) onProgress('Parsing PDF...', percent);
    }, pageRange);
    const title = getFileNameFromUrl(url);
    return { text, title };
  }
  
  let loadedBytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loadedBytes += value.length;
      if (totalBytes > 0 && onProgress) {
        const percent = Math.round((loadedBytes / totalBytes) * 40); // 0 to 40%
        onProgress('Downloading PDF...', 5 + percent);
      }
    }
  }
  
  if (onProgress) onProgress('Assembling PDF...', 48);
  const totalLength = chunks.reduce((acc, val) => acc + val.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  
  if (onProgress) onProgress('Parsing PDF...', 50);
  const text = await extractTextFromPdf(combined.buffer, (percent) => {
    if (onProgress) onProgress('Parsing PDF...', percent);
  }, pageRange);
  
  const title = getFileNameFromUrl(url);
  return { text, title };
}

/**
 * Extracts a filename from a URL.
 */
export function getFileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const lastPart = pathname.substring(pathname.lastIndexOf('/') + 1);
    if (lastPart && lastPart.toLowerCase().endsWith('.pdf')) {
      return decodeURIComponent(lastPart);
    }
  } catch (e) {
    // Ignore error
  }
  return 'Document.pdf';
}
