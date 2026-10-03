import fs from "node:fs";
import { serveFile } from "@/lib/http";
import { rootCaseId } from "@/lib/store/cases";
import { caseFilePath } from "@/lib/materials/files";

/** Исходный файл дела — для превью на экране материалов (поддерживает Range для видео). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  let found;
  try {
    found = caseFilePath(rootCaseId(id), fileId);
  } catch {
    found = null;
  }
  if (!found || !fs.existsSync(found.path)) return new Response("Файл не найден", { status: 404 });
  return serveFile(request, found.path, found.file.mime);
}
