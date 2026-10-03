import fs from "node:fs";
import OpenAI, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { attachmentData } from "./attachments";
import {
  ProviderError,
  type AskRequest,
  type Attachment,
  type Capabilities,
  type ModelEntry,
  type ModelProvider,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderKind,
} from "./types";

const TIMEOUT_MS = 5 * 60_000;
/** Модели, которые не умеют в чат (эмбеддинги, речь, картинки) — скрываем из списка. */
const NON_CHAT = /embedding|tts|whisper|dall-e|gpt-image|moderation|transcribe|realtime|audio|davinci|babbage|search/i;

/** Настройки OpenAI-совместимого API: сам OpenAI, OpenRouter, Ollama. */
interface CompatibleOptions {
  kind: ProviderKind;
  title: string;
  /** Название в сообщениях об ошибках */
  name: string;
  /** Строка или функция — функция читает переопределение из окружения в момент запроса */
  defaultBaseUrl?: string | (() => string);
  capabilities: Capabilities;
  headers?: Record<string, string>;
  /** Ключ не нужен (Ollama) — SDK всё равно требует непустую строку */
  keyless?: boolean;
  /** Проверка подключения; по умолчанию — список моделей */
  healthCheck?: (config: ProviderConfig, baseUrl: string) => Promise<void>;
  /** Что сказать, если сервер недоступен */
  connectionHint?: string;
  filterModel?: (id: string) => boolean;
}

function attachmentPart(a: Attachment): ChatCompletionContentPart | null {
  if (a.kind === "image") {
    return { type: "image_url", image_url: { url: `data:${a.mimeType};base64,${attachmentData(a)}` } };
  }
  if (a.kind === "pdf") {
    return {
      type: "file",
      file: { filename: a.filename ?? "document.pdf", file_data: `data:application/pdf;base64,${attachmentData(a)}` },
    };
  }
  return null;
}

export function toOpenAIMessages(req: AskRequest): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: req.system },
    ...req.messages.map((m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam),
  ];
  const parts = (req.attachments ?? []).map(attachmentPart).filter((p) => p !== null);
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  if (parts.length && lastUser >= 0) {
    const text = messages[lastUser].content as string;
    messages[lastUser] = { role: "user", content: [...parts, { type: "text", text }] };
  }
  return messages;
}

export function mapOpenAIError(e: unknown, name = "OpenAI", connectionHint = ""): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof AuthenticationError) return new ProviderError(`Неверный API-ключ ${name}`, false, 401);
  if (e instanceof PermissionDeniedError) return new ProviderError(`Нет доступа к модели или ресурсу ${name}`, false, 403);
  if (e instanceof NotFoundError) return new ProviderError(`Модель не найдена у ${name}`, false, 404);
  if (e instanceof BadRequestError) return new ProviderError(`${name} отклонил запрос: ${e.message}`, false, 400);
  if (e instanceof RateLimitError) return new ProviderError(`Лимит запросов ${name} исчерпан (или закончились средства)`, true, 429);
  if (e instanceof APIConnectionError) return new ProviderError(`Нет связи с ${name}: ${e.message.replace(/\.$/, "")}${connectionHint ? `. ${connectionHint}` : ""}`, true);
  if (e instanceof APIError) {
    return new ProviderError(`Ошибка ${name} ${e.status ?? ""}: ${e.message}`, (e.status ?? 500) >= 500, e.status);
  }
  return new ProviderError(e instanceof Error ? e.message : String(e), false);
}

export function createOpenAICompatibleAdapter(o: CompatibleOptions) {
  const baseUrl = (config: ProviderConfig) =>
    config.baseUrl || (typeof o.defaultBaseUrl === "function" ? o.defaultBaseUrl() : o.defaultBaseUrl);
  const client = (config: ProviderConfig) =>
    new OpenAI({
      apiKey: config.apiKey || (o.keyless ? "local" : ""),
      baseURL: baseUrl(config),
      timeout: TIMEOUT_MS,
      maxRetries: 2,
      defaultHeaders: o.headers,
    });
  const mapError = (e: unknown) => mapOpenAIError(e, o.name, o.connectionHint);

  async function healthCheck(config: ProviderConfig) {
    try {
      if (o.healthCheck) await o.healthCheck(config, baseUrl(config) ?? "");
      else await client(config).models.list();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: mapError(e).message };
    }
  }

  const adapter: ProviderAdapter & { client: typeof client } = {
    kind: o.kind,
    title: o.title,
    capabilities: o.capabilities,
    client,

    createModel(config, modelId): ModelProvider {
      const api = client(config);
      return {
        id: `${config.id}:${modelId}`,
        label: `${config.label} · ${modelId}`,
        capabilities: o.capabilities,
        healthCheck: () => healthCheck(config),
        async ask(req) {
          try {
            const res = await api.chat.completions.create(
              {
                model: modelId,
                messages: toOpenAIMessages(req),
                max_completion_tokens: req.maxOutputTokens ?? 16000,
                ...(req.jsonSchema
                  ? {
                      response_format: {
                        type: "json_schema",
                        // strict: false — наши схемы содержат необязательные поля, а strict-режим требует все поля обязательными.
                        json_schema: { name: "response", schema: req.jsonSchema as Record<string, unknown>, strict: false },
                      },
                    }
                  : {}),
              },
              { signal: req.signal },
            );
            if (res.usage) {
              // Автоматический кэш OpenAI-совместимых API: cached_tokens входят в prompt_tokens
              req.onUsage?.({
                inputTokens: res.usage.prompt_tokens,
                outputTokens: res.usage.completion_tokens,
                cachedInputTokens: res.usage.prompt_tokens_details?.cached_tokens ?? 0,
              });
            }
            const choice = res.choices[0];
            if (!choice) throw new ProviderError(`${o.name} вернул пустой ответ`, true);
            if (choice.message.refusal) throw new ProviderError(`Модель отказалась: ${choice.message.refusal}`, false);
            if (choice.finish_reason === "length") throw new ProviderError("Ответ обрезан по лимиту токенов", false);
            return choice.message.content ?? "";
          } catch (e) {
            throw mapError(e);
          }
        },
      };
    },

    healthCheck,

    async listModels(config): Promise<ModelEntry[]> {
      try {
        const models: ModelEntry[] = [];
        for await (const m of client(config).models.list()) {
          if (o.filterModel && !o.filterModel(m.id)) continue;
          const name = (m as { name?: string }).name;
          models.push(name && name !== m.id ? { id: m.id, label: name } : { id: m.id });
        }
        return models.sort((a, b) => a.id.localeCompare(b.id));
      } catch (e) {
        throw mapError(e);
      }
    },
  };
  return adapter;
}

export const openaiAdapter = createOpenAICompatibleAdapter({
  kind: "openai",
  title: "OpenAI API",
  name: "OpenAI",
  capabilities: { images: true, video: false, pdf: true },
  filterModel: (id) => !NON_CHAT.test(id),
});

/** Расшифровка аудио (Whisper и совместимые модели). */
export async function transcribeAudio(config: ProviderConfig, model: string, audioPath: string): Promise<string> {
  try {
    const res = await openaiAdapter.client(config).audio.transcriptions.create({ file: fs.createReadStream(audioPath), model });
    return res.text;
  } catch (e) {
    throw mapOpenAIError(e);
  }
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** OpenRouter: доступ к сотням моделей по одному ключу (OpenAI-совместимый API). */
export const openrouterAdapter = createOpenAICompatibleAdapter({
  kind: "openrouter",
  title: "OpenRouter",
  name: "OpenRouter",
  defaultBaseUrl: () => process.env.OPENROUTER_BASE_URL ?? OPENROUTER_BASE_URL,
  capabilities: { images: true, video: false, pdf: true },
  // Атрибуция приложения в OpenRouter
  headers: { "HTTP-Referer": "http://localhost:3000", "X-Title": "Verdict" },
  // Список моделей у OpenRouter открытый — ключ проверяем отдельным запросом
  async healthCheck(config, base) {
    const res = await fetch(`${base}/key`, { headers: { Authorization: `Bearer ${config.apiKey}` } });
    if (res.status === 401 || res.status === 403) throw new ProviderError("Неверный API-ключ OpenRouter", false, res.status);
    if (!res.ok) throw new ProviderError(`OpenRouter ответил ${res.status}`, res.status >= 500, res.status);
  },
});

export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** Ollama: локальные модели на этом компьютере (OpenAI-совместимый API). */
export const ollamaAdapter = createOpenAICompatibleAdapter({
  kind: "ollama",
  title: "Ollama (локальные модели)",
  name: "Ollama",
  defaultBaseUrl: OLLAMA_BASE_URL,
  capabilities: { images: true, video: false, pdf: false },
  keyless: true,
  connectionHint: "Ollama запущена? Выполните в терминале: ollama serve",
});
