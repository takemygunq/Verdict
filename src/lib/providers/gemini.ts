import fs from "node:fs";
import { ApiError, FileState, FinishReason, GoogleGenAI, createPartFromUri, type Content, type Part } from "@google/genai";
import { attachmentData } from "./attachments";
import {
  ProviderError,
  type AskRequest,
  type Attachment,
  type ModelEntry,
  type ModelProvider,
  type ProviderAdapter,
  type ProviderConfig,
} from "./types";

const TIMEOUT_MS = 5 * 60_000;

function client(config: ProviderConfig) {
  return new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: { timeout: TIMEOUT_MS, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}) },
  });
}

/** Больше этого — через Files API: у inline-запроса лимит ~20 МБ. */
const INLINE_LIMIT = 15 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
const uploaded = new Map<string, Promise<Part>>();

/** Большой файл загружается в Gemini Files API один раз за процесс и ждёт обработки. */
async function uploadPart(api: GoogleGenAI, a: Attachment): Promise<Part> {
  const key = `${a.filePath}:${fs.statSync(a.filePath!).mtimeMs}`;
  if (!uploaded.has(key)) {
    const job = (async () => {
      let file = await api.files.upload({ file: a.filePath!, config: { mimeType: a.mimeType } });
      const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
      while (file.state === FileState.PROCESSING && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        file = await api.files.get({ name: file.name! });
      }
      if (file.state !== FileState.ACTIVE || !file.uri) {
        throw new ProviderError(`Gemini не смог обработать файл ${a.filename ?? ""} (${file.state})`, false);
      }
      return createPartFromUri(file.uri, a.mimeType);
    })();
    job.catch(() => uploaded.delete(key));
    uploaded.set(key, job);
  }
  return uploaded.get(key)!;
}

export async function geminiParts(api: GoogleGenAI, attachments: Attachment[] = []): Promise<Part[]> {
  return Promise.all(
    attachments.map((a) =>
      a.filePath && fs.statSync(a.filePath).size > INLINE_LIMIT
        ? uploadPart(api, a)
        : Promise.resolve({ inlineData: { mimeType: a.mimeType, data: attachmentData(a) } }),
    ),
  );
}

export function toGeminiContents(req: AskRequest, parts: Part[] = []): Content[] {
  const contents: Content[] = req.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  // Gemini принимает картинки, PDF, видео и аудио нативно.
  const lastUser = contents.findLastIndex((c) => c.role === "user");
  if (parts.length && lastUser >= 0) {
    contents[lastUser] = { role: "user", parts: [...parts, ...(contents[lastUser].parts ?? [])] };
  }
  return contents;
}

export function mapGeminiError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof ApiError) {
    const s = e.status;
    if (s === 400 && /api key/i.test(e.message)) return new ProviderError("Неверный API-ключ Gemini", false, s);
    if (s === 401 || s === 403) return new ProviderError("Неверный API-ключ Gemini или нет доступа", false, s);
    if (s === 404) return new ProviderError("Модель не найдена у Gemini", false, s);
    if (s === 429) return new ProviderError("Лимит запросов Gemini исчерпан", true, s);
    if (s >= 500) return new ProviderError(`Ошибка Gemini ${s}: ${e.message}`, true, s);
    return new ProviderError(`Gemini отклонил запрос: ${e.message}`, false, s);
  }
  const msg = e instanceof Error ? e.message : String(e);
  // Сетевые ошибки fetch приходят как TypeError
  return new ProviderError(`Нет связи с Gemini: ${msg}`, e instanceof TypeError);
}

async function healthCheck(config: ProviderConfig) {
  try {
    await client(config).models.list({ config: { pageSize: 1 } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapGeminiError(e).message };
  }
}

export const geminiAdapter: ProviderAdapter = {
  kind: "gemini",
  title: "Google Gemini API",
  capabilities: { images: true, video: true, pdf: true },

  createModel(config, modelId): ModelProvider {
    const api = client(config);
    return {
      id: `${config.id}:${modelId}`,
      label: `${config.label} · ${modelId}`,
      capabilities: this.capabilities,
      healthCheck: () => healthCheck(config),
      async ask(req) {
        try {
          const res = await api.models.generateContent({
            model: modelId,
            contents: toGeminiContents(req, await geminiParts(api, req.attachments)),
            config: {
              systemInstruction: req.system,
              maxOutputTokens: req.maxOutputTokens ?? 16000,
              abortSignal: req.signal,
              ...(req.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: req.jsonSchema } : {}),
            },
          });
          const u = res.usageMetadata;
          if (u) {
            // Неявный кэш Gemini: cachedContentTokenCount входит в promptTokenCount
            req.onUsage?.({
              inputTokens: u.promptTokenCount ?? 0,
              outputTokens: u.candidatesTokenCount ?? 0,
              cachedInputTokens: u.cachedContentTokenCount ?? 0,
            });
          }
          if (res.promptFeedback?.blockReason) {
            throw new ProviderError(`Gemini заблокировал запрос: ${res.promptFeedback.blockReason}`, false);
          }
          const finish = res.candidates?.[0]?.finishReason;
          if (finish === FinishReason.MAX_TOKENS) throw new ProviderError("Ответ обрезан по лимиту токенов", false);
          const text = res.text;
          if (!text) throw new ProviderError(`Gemini вернул пустой ответ (${finish ?? "без причины"})`, true);
          return text;
        } catch (e) {
          throw mapGeminiError(e);
        }
      },
    };
  },

  healthCheck,

  async listModels(config): Promise<ModelEntry[]> {
    try {
      const models: ModelEntry[] = [];
      for await (const m of await client(config).models.list()) {
        if (!m.name || !m.supportedActions?.includes("generateContent")) continue;
        models.push({ id: m.name.replace(/^models\//, ""), label: m.displayName });
      }
      return models;
    } catch (e) {
      throw mapGeminiError(e);
    }
  },
};
