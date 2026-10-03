import fs from "node:fs";

/** Отдаёт файл с диска, поддерживает Range-запросы (перемотка видео). */
export function serveFile(request: Request, filePath: string, mime: string): Response {
  const size = fs.statSync(filePath).size;
  const range = request.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  const headers = { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(stream as unknown as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(fs.createReadStream(filePath) as unknown as ReadableStream, {
    headers: { ...headers, "Content-Length": String(size) },
  });
}
