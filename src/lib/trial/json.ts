import { z } from "zod";
import { ProviderError, type AskRequest, type ModelProvider } from "../providers/types";

/** Ключевые слова JSON Schema, которые не поддерживают structured outputs провайдеров. Проверяет их zod. */
const UNSUPPORTED = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([k]) => !UNSUPPORTED.has(k))
        .map(([k, v]) => [k, strip(v)]),
    );
  }
  return node;
}

const cache = new WeakMap<z.ZodType, object>();

/** JSON Schema для провайдера: без неподдерживаемых ограничений. */
export function providerSchema(schema: z.ZodType): object {
  let s = cache.get(schema);
  if (!s) {
    s = strip(z.toJSONSchema(schema)) as object;
    cache.set(schema, s);
  }
  return s;
}

/** Достаёт JSON из ответа: модели без structured outputs любят обёртки ```json и пояснения вокруг. */
export function extractJson(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      throw new SyntaxError("Ответ не является корректным JSON");
    }
  }
}

function describe(e: unknown): string {
  if (e instanceof z.ZodError) {
    return e.issues.map((i) => `${i.path.join(".") || "(корень)"}: ${i.message}`).join("; ");
  }
  return e instanceof Error ? e.message : String(e);
}

export class InvalidResponseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "InvalidResponseError";
  }
}

export interface AskJsonOptions {
  /** Пауза перед повтором при сетевой ошибке, мс */
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Спрашивает модель и валидирует ответ по zod-схеме.
 * Невалидный ответ — одна повторная попытка с текстом ошибки; затем InvalidResponseError.
 * Сетевые (retryable) ошибки — ещё одна попытка поверх ретраев SDK.
 */
export async function askJson<T>(
  model: ModelProvider,
  schema: z.ZodType<T>,
  req: Omit<AskRequest, "jsonSchema">,
  opts: AskJsonOptions = {},
): Promise<T> {
  const ask = async (r: AskRequest) => {
    try {
      return await model.ask(r);
    } catch (e) {
      if (e instanceof ProviderError && e.retryable) {
        await sleep(opts.retryDelayMs ?? 2000);
        return model.ask(r);
      }
      throw e;
    }
  };

  const jsonSchema = providerSchema(schema);
  const raw = await ask({ ...req, jsonSchema });
  try {
    return schema.parse(extractJson(raw));
  } catch (first) {
    const retryReq: AskRequest = {
      ...req,
      jsonSchema,
      messages: [
        ...req.messages,
        { role: "assistant", content: raw.trim() || "(пустой ответ)" },
        {
          role: "user",
          content: `Твой ответ не прошёл проверку: ${describe(first)}. Верни исправленный ответ — только JSON строго по схеме, без пояснений.`,
        },
      ],
    };
    const raw2 = await ask(retryReq);
    try {
      return schema.parse(extractJson(raw2));
    } catch (second) {
      throw new InvalidResponseError(`Ответ дважды не прошёл проверку: ${describe(second)}`, raw2);
    }
  }
}
