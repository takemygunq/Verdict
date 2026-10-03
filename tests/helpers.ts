import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

/** Отдельный временный ./data для каждого тестового файла. Вызывать до импорта модулей с БД. */
export function setupTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verdict-test-"));
  process.env.VERDICT_DATA_DIR = dir;
  return dir;
}

export interface Captured {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

type Handler = (req: Captured, res: http.ServerResponse) => void;

/** Локальный HTTP-стаб вместо настоящего API провайдера. */
export async function stubServer(handler: Handler) {
  const requests: Captured[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const captured: Captured = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: raw ? JSON.parse(raw) : undefined,
      };
      requests.push(captured);
      handler(captured, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function sse(res: http.ServerResponse, events: { event: string; data: unknown }[]) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const e of events) res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
  res.end();
}
