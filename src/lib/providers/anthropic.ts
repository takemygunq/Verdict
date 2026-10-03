import Anthropic from "@anthropic-ai/sdk";
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
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

function client(config: ProviderConfig) {
  return new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
    timeout: TIMEOUT_MS,
    maxRetries: 2,
  });
}

function attachmentBlock(a: Attachment): Anthropic.ContentBlockParam | null {
  if (a.kind === "image" && (IMAGE_TYPES as readonly string[]).includes(a.mimeType)) {
    return { type: "image", source: { type: "base64", media_type: a.mimeType as ImageType, data: attachmentData(a) } };
  }
  if (a.kind === "pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: attachmentData(a) } };
  }
  // Видео и аудио Anthropic не принимает — их заменяет текстовая раскадровка в материалах дела.
  return null;
}

export function toAnthropicMessages(req: AskRequest): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
  const blocks = (req.attachments ?? []).map(attachmentBlock).filter((b) => b !== null);
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  if (blocks.length && lastUser >= 0) {
    const text = messages[lastUser].content as string;
    messages[lastUser] = { role: "user", content: [...blocks, { type: "text", text }] };
  }
  return messages;
}

export function mapAnthropicError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new ProviderError("Неверный API-ключ Anthropic", false, 401);
  if (e instanceof Anthropic.PermissionDeniedError) return new ProviderError("Нет доступа к модели или ресурсу Anthropic", false, 403);
  if (e instanceof Anthropic.NotFoundError) return new ProviderError("Модель не найдена у Anthropic", false, 404);
  if (e instanceof Anthropic.BadRequestError) return new ProviderError(`Anthropic отклонил запрос: ${e.message}`, false, 400);
  if (e instanceof Anthropic.RateLimitError) return new ProviderError("Лимит запросов Anthropic исчерпан", true, 429);
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError(`Нет связи с Anthropic: ${e.message}`, true);
  if (e instanceof Anthropic.APIError) {
    return new ProviderError(`Ошибка Anthropic ${e.status ?? ""}: ${e.message}`, (e.status ?? 500) >= 500, e.status);
  }
  return new ProviderError(e instanceof Error ? e.message : String(e), false);
}

async function healthCheck(config: ProviderConfig) {
  try {
    await client(config).models.list({ limit: 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapAnthropicError(e).message };
  }
}

export const anthropicAdapter: ProviderAdapter = {
  kind: "anthropic",
  title: "Anthropic API",
  capabilities: { images: true, video: false, pdf: true },

  createModel(config, modelId): ModelProvider {
    const api = client(config);
    return {
      id: `${config.id}:${modelId}`,
      label: `${config.label} · ${modelId}`,
      capabilities: this.capabilities,
      healthCheck: () => healthCheck(config),
      async ask(req) {
        try {
          const stream = api.messages.stream(
            {
              model: modelId,
              max_tokens: req.maxOutputTokens ?? 16000,
              // Метка кэша на системном промпте: следующие запросы с тем же началом читают его из кэша
              system: req.cacheSystem
                ? [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }]
                : req.system,
              messages: toAnthropicMessages(req),
              ...(req.jsonSchema
                ? { output_config: { format: { type: "json_schema", schema: req.jsonSchema as Record<string, unknown> } } }
                : {}),
            },
            { signal: req.signal },
          );
          const message = await stream.finalMessage();
          const u = message.usage;
          const cached = u.cache_read_input_tokens ?? 0;
          // input_tokens у Anthropic — только некэшированная часть; считаем весь вход
          req.onUsage?.({
            inputTokens: u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0),
            outputTokens: u.output_tokens,
            cachedInputTokens: cached,
          });
          if (message.stop_reason === "refusal") {
            throw new ProviderError("Модель отказалась отвечать на запрос", false);
          }
          if (message.stop_reason === "max_tokens") {
            throw new ProviderError("Ответ обрезан по лимиту max_tokens", false);
          }
          return message.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("");
        } catch (e) {
          throw mapAnthropicError(e);
        }
      },
    };
  },

  healthCheck,

  async listModels(config): Promise<ModelEntry[]> {
    try {
      const models: ModelEntry[] = [];
      for await (const m of client(config).models.list()) {
        models.push({ id: m.id, label: m.display_name });
      }
      return models;
    } catch (e) {
      throw mapAnthropicError(e);
    }
  },
};
