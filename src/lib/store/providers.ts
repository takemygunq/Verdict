import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { decryptSecret, encryptSecret, maskSecret } from "../crypto";
import { db, schema } from "../db";
import type { ProviderRow } from "../db/schema";
import { adapterFor } from "../providers/registry";
import type { ModelEntry, ModelProvider, ProviderConfig, ProviderKind } from "../providers/types";

const modelsSchema = z.array(z.object({ id: z.string(), label: z.string().optional() }));
const checkSchema = z.object({ ok: z.boolean(), error: z.string().optional(), at: z.number() });

/** То, что можно отдавать на фронт: без ключа. */
export interface ProviderView {
  id: string;
  kind: ProviderKind;
  label: string;
  apiKeyHint: string | null;
  baseUrl: string | null;
  models: ModelEntry[];
  /** Модель по умолчанию для участников заседания */
  defaultModel: string | null;
  enabled: boolean;
  lastCheck: z.infer<typeof checkSchema> | null;
}

function toView(row: ProviderRow): ProviderView {
  return {
    id: row.id,
    kind: row.kind as ProviderKind,
    label: row.label,
    apiKeyHint: row.apiKeyHint,
    baseUrl: row.baseUrl,
    models: modelsSchema.parse(JSON.parse(row.models)),
    defaultModel: row.defaultModel,
    enabled: row.enabled,
    lastCheck: row.lastCheck ? checkSchema.parse(JSON.parse(row.lastCheck)) : null,
  };
}

function getRow(id: string): ProviderRow {
  const row = db().select().from(schema.providers).where(eq(schema.providers.id, id)).get();
  if (!row) throw new NotFoundError(`Провайдер ${id} не найден`);
  return row;
}

export class NotFoundError extends Error {}

export function listProviders(): ProviderView[] {
  return db().select().from(schema.providers).orderBy(schema.providers.createdAt).all().map(toView);
}

export function getProvider(id: string): ProviderView {
  return toView(getRow(id));
}

export function createProvider(input: {
  kind: ProviderKind;
  label: string;
  /** Пустой для провайдеров без ключа (демо) */
  apiKey: string;
  baseUrl?: string;
  models?: ModelEntry[];
}): ProviderView {
  const row: ProviderRow = {
    id: crypto.randomUUID().slice(0, 8),
    kind: input.kind,
    label: input.label,
    apiKeyEnc: input.apiKey ? encryptSecret(input.apiKey) : null,
    apiKeyHint: input.apiKey ? maskSecret(input.apiKey) : null,
    baseUrl: input.baseUrl || null,
    models: JSON.stringify(input.models ?? []),
    enabled: true,
    lastCheck: null,
    createdAt: Date.now(),
    defaultModel: null,
  };
  db().insert(schema.providers).values(row).run();
  return toView(row);
}

export function updateProvider(
  id: string,
  patch: {
    label?: string;
    apiKey?: string;
    baseUrl?: string | null;
    models?: ModelEntry[];
    defaultModel?: string | null;
    enabled?: boolean;
  },
): ProviderView {
  const row = getRow(id);
  const values: Partial<ProviderRow> = {};
  if (patch.label !== undefined) values.label = patch.label;
  if (patch.apiKey) {
    values.apiKeyEnc = encryptSecret(patch.apiKey);
    values.apiKeyHint = maskSecret(patch.apiKey);
    values.lastCheck = null;
  }
  if (patch.baseUrl !== undefined) values.baseUrl = patch.baseUrl || null;
  if (patch.models !== undefined) values.models = JSON.stringify(patch.models);
  if (patch.defaultModel !== undefined) values.defaultModel = patch.defaultModel;
  // Модель по умолчанию должна оставаться в списке моделей
  const models = patch.models ?? modelsSchema.parse(JSON.parse(row.models));
  const def = values.defaultModel !== undefined ? values.defaultModel : row.defaultModel;
  if (def && !models.some((m) => m.id === def)) values.defaultModel = null;
  if (patch.enabled !== undefined) values.enabled = patch.enabled;
  if (Object.keys(values).length) {
    db().update(schema.providers).set(values).where(eq(schema.providers.id, id)).run();
  }
  return getProvider(id);
}

export function deleteProvider(id: string) {
  getRow(id);
  db().delete(schema.providers).where(eq(schema.providers.id, id)).run();
}

/** Расшифрованная конфигурация — только для серверного кода. */
export function providerConfig(id: string): ProviderConfig {
  const row = getRow(id);
  return {
    id: row.id,
    kind: row.kind as ProviderKind,
    label: row.label,
    apiKey: row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : "",
    baseUrl: row.baseUrl ?? undefined,
  };
}

export async function checkProvider(id: string): Promise<ProviderView> {
  const config = providerConfig(id);
  const result = await adapterFor(config.kind).healthCheck(config);
  db()
    .update(schema.providers)
    .set({ lastCheck: JSON.stringify({ ...result, at: Date.now() }) })
    .where(eq(schema.providers.id, id))
    .run();
  return getProvider(id);
}

/** Подтягивает список моделей у провайдера и сохраняет его. */
export async function refreshModels(id: string): Promise<ProviderView> {
  const config = providerConfig(id);
  const models = await adapterFor(config.kind).listModels(config);
  return updateProvider(id, { models });
}

export function modelProvider(providerId: string, modelId: string): ModelProvider {
  const config = providerConfig(providerId);
  return adapterFor(config.kind).createModel(config, modelId);
}
