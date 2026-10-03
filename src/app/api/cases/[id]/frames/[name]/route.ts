import { derivedFilePath } from "@/lib/materials/files";
import { serveFile } from "@/lib/http";
import { rootCaseId } from "@/lib/store/cases";

/** Ключевой кадр видео или уменьшенная копия картинки. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  let file: string | null;
  try {
    file = derivedFilePath(rootCaseId(id), name);
  } catch {
    file = null;
  }
  if (!file) return new Response("Кадр не найден", { status: 404 });
  return serveFile(request, file, "image/jpeg");
}
