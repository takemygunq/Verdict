export type Role = "user" | "assistant";

export interface Msg {
  role: Role;
  content: string;
}

export interface Attachment {
  kind: "image" | "pdf" | "video" | "audio";
  mimeType: string;
  /** base64 без префикса data: — или filePath, тогда адаптер прочитает файл сам */
  data?: string;
  /** Локальный файл (большие видео Gemini загружает через Files API) */
  filePath?: string;
  filename?: string;
}

export interface Usage {
  /** Все входные токены, включая прочитанные из кэша */
  inputTokens: number;
  outputTokens: number;
  /** Сколько из inputTokens прочитано из кэша провайдера (дешевле обычного входа) */
  cachedInputTokens?: number;
}

export interface AskRequest {
  system: string;
  messages: Msg[];
  /** Прикрепляются к последнему сообщению пользователя */
  attachments?: Attachment[];
  /**
   * Системный промпт повторяется в других запросах (общие правила и материалы дела) —
   * провайдерам с явным кэшем (Anthropic) пометить его для кэширования. Остальные кэшируют общее начало сами.
   */
  cacheSystem?: boolean;
  /** JSON Schema ожидаемого ответа. Если задана — провайдер просит модель вернуть строго JSON. */
  jsonSchema?: object;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /** Колбэк для учёта токенов и стоимости */
  onUsage?: (usage: Usage) => void;
}

export interface Capabilities {
  images: boolean;
  video: boolean;
  pdf: boolean;
}

/** Модель конкретного провайдера, готовая отвечать. Логика заседания знает только этот интерфейс. */
export interface ModelProvider {
  /** `${providerId}:${modelId}` */
  id: string;
  label: string;
  capabilities: Capabilities;
  ask(req: AskRequest): Promise<string>;
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}

export interface ModelEntry {
  id: string;
  label?: string;
}

export const PROVIDER_KINDS = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "ollama",
  "claude-cli",
  "codex-cli",
  "gemini-cli",
  "demo",
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Расшифрованная конфигурация провайдера (только на сервере). */
export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  apiKey: string;
  baseUrl?: string;
}

/** Адаптер типа провайдера: создаёт модели, проверяет подключение и подтягивает список моделей. */
export interface ProviderAdapter {
  kind: ProviderKind;
  title: string;
  capabilities: Capabilities;
  createModel(config: ProviderConfig, modelId: string): ModelProvider;
  healthCheck(config: ProviderConfig): Promise<{ ok: boolean; error?: string }>;
  listModels(config: ProviderConfig): Promise<ModelEntry[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
