import { getCase, listEvents } from "@/lib/store/cases";
import { NotFoundError } from "@/lib/store/providers";
import type { StoredEvent } from "@/lib/trial/events";
import { ensureRecovered, subscribe } from "@/lib/trial/runner";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

/**
 * SSE-поток хода заседания. Сначала отдаёт сохранённые события (после Last-Event-ID),
 * затем живые. Поток закрывается после события trial_end.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  ensureRecovered();
  let status;
  try {
    status = getCase(id).status;
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }

  const url = new URL(request.url);
  const after = Number(request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastSeq = after;
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // уже закрыт клиентом
        }
      };
      const send = (s: StoredEvent) => {
        if (closed || s.seq <= lastSeq) return;
        lastSeq = s.seq;
        controller.enqueue(encoder.encode(`id: ${s.seq}\ndata: ${JSON.stringify(s)}\n\n`));
        if (s.event.type === "trial_end") close();
      };

      // Подписка и чтение журнала синхронны (better-sqlite3), поэтому живое событие не может вклиниться между ними.
      const unsubscribe = subscribe(id, send);
      const heartbeat = setInterval(() => !closed && controller.enqueue(encoder.encode(": ping\n\n")), HEARTBEAT_MS);
      cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
      };
      request.signal.addEventListener("abort", close);

      for (const s of listEvents(id, after)) send(s);
      // Заседание не идёт и не начнётся само — живых событий не будет.
      if (!closed && status !== "running") close();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
