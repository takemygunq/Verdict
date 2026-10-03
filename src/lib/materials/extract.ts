import fs from "node:fs";

/** Слишком длинный документ обрезается: модели всё равно не прочтут сотни страниц внимательно. */
export const MAX_DOCUMENT_CHARS = 60_000;

export function truncate(text: string, max = MAX_DOCUMENT_CHARS): { text: string; truncated: boolean } {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > max ? { text: `${clean.slice(0, max)}\n…`, truncated: true } : { text: clean, truncated: false };
}

export async function extractPdfText(filePath: string): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(filePath)) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

export async function extractDocxText(filePath: string): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: fs.readFileSync(filePath) });
  return result.value;
}

export function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}
