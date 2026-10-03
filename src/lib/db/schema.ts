import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  /** Тип адаптера: anthropic | openai | gemini (позже: openrouter, cli-*, ollama) */
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  /** Зашифрованный AES-GCM API-ключ. Никогда не отдаётся на фронт. */
  apiKeyEnc: text("api_key_enc"),
  /** Хвост ключа для отображения ("••••abcd") */
  apiKeyHint: text("api_key_hint"),
  baseUrl: text("base_url"),
  /** JSON: ModelEntry[] — список моделей, подтянутый у провайдера или введённый вручную */
  models: text("models").notNull().default("[]"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** JSON: { ok, error?, at } последней проверки подключения */
  lastCheck: text("last_check"),
  createdAt: integer("created_at").notNull(),
  /** Модель по умолчанию для участников заседания */
  defaultModel: text("default_model"),
});

export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  /** Для апелляций — исходное дело */
  parentId: text("parent_id"),
  /** draft → preparing → ready → running → done | failed */
  status: text("status").notNull(),
  materialText: text("material_text").notNull(),
  comment: text("comment").notNull().default(""),
  /** JSON: CaseFile */
  caseFile: text("case_file"),
  /** JSON: Participant[] */
  participants: text("participants"),
  /** JSON: Verdict */
  verdict: text("verdict"),
  error: text("error"),
  rounds: integer("rounds").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  /** Что сейчас происходит на подготовке (для экрана ожидания) */
  progress: text("progress"),
  /** JSON: Appeal — для дел-апелляций */
  appeal: text("appeal"),
  /** JSON: ActualResult — фактический результат кампании */
  actualResult: text("actual_result"),
  /** Повторное рассмотрение: прошлая версия материала */
  previousId: text("previous_id"),
  revision: text("revision"),
  /** Сколько из inputTokens прочитано из кэша провайдера */
  cachedTokens: integer("cached_tokens").notNull().default(0),
});

/** Загруженные файлы дела. Сами файлы лежат в data/uploads/<caseId>/. */
export const caseFiles = sqliteTable("case_files", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  /** image | video | pdf | docx | text */
  kind: text("kind").notNull(),
  size: integer("size").notNull(),
  /** Путь относительно каталога данных */
  path: text("path").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const caseEvents = sqliteTable("case_events", {
  caseId: text("case_id").notNull(),
  seq: integer("seq").notNull(),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type ProviderRow = typeof providers.$inferSelect;
export type CaseRow = typeof cases.$inferSelect;
export type CaseFileRow = typeof caseFiles.$inferSelect;
