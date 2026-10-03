import { ZodError } from "zod";
import { UploadError } from "./materials/files";
import { ProviderError } from "./providers/types";
import { NotFoundError } from "./store/providers";
import { InvalidResponseError } from "./trial/json";
import { NoModelsError } from "./trial/roster";
import { CaseStateError } from "./trial/runner";

/** Оборачивает обработчик route handler: ошибки превращаются в JSON с понятным статусом. */
export async function handle(fn: () => Promise<unknown> | unknown): Promise<Response> {
  try {
    const result = await fn();
    return Response.json(result ?? { ok: true });
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      return Response.json(
        { error: first ? `Некорректные данные: ${first.message}` : "Некорректные данные", issues: e.issues },
        { status: 400 },
      );
    }
    if (e instanceof NotFoundError) return Response.json({ error: e.message }, { status: 404 });
    if (e instanceof CaseStateError) return Response.json({ error: e.message }, { status: 409 });
    if (e instanceof NoModelsError || e instanceof UploadError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof ProviderError || e instanceof InvalidResponseError) {
      return Response.json({ error: e.message }, { status: 502 });
    }
    console.error("[api]", e instanceof Error ? e.message : e);
    return Response.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
