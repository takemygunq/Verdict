import { anthropicAdapter } from "./anthropic";
import { claudeCliAdapter, codexCliAdapter, geminiCliAdapter } from "./cli";
import { geminiAdapter } from "./gemini";
import { demoAdapter } from "./mock";
import { ollamaAdapter, openaiAdapter, openrouterAdapter } from "./openai";
import type { ProviderAdapter, ProviderKind } from "./types";

export const ADAPTERS: Record<ProviderKind, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  openrouter: openrouterAdapter,
  ollama: ollamaAdapter,
  "claude-cli": claudeCliAdapter,
  "codex-cli": codexCliAdapter,
  "gemini-cli": geminiCliAdapter,
  demo: demoAdapter,
};

/** Провайдеры, которым не нужен API-ключ. */
export const KEYLESS_KINDS: ProviderKind[] = ["demo", "ollama", "claude-cli", "codex-cli", "gemini-cli"];

/** CLI-мосты к подпискам: поле «адрес» у них — путь к программе. */
export const CLI_KINDS: ProviderKind[] = ["claude-cli", "codex-cli", "gemini-cli"];

export function isProviderKind(kind: string): kind is ProviderKind {
  return kind in ADAPTERS;
}

export function adapterFor(kind: string): ProviderAdapter {
  if (!isProviderKind(kind)) throw new Error(`Неизвестный тип провайдера: ${kind}`);
  return ADAPTERS[kind];
}
