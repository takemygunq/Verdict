import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "../paths";
import { attachmentData } from "./attachments";
import { ProviderError, type AskRequest, type ModelEntry, type ModelProvider, type ProviderAdapter, type ProviderConfig, type ProviderKind, type Usage } from "./types";

/**
 * CLI-мосты: Claude Code, Codex, Gemini CLI вызываются как подпроцессы в неинтерактивном режиме —
 * так можно пользоваться подпиской, залогинившись в CLI через браузер.
 * Флаги сверены с `--help` (Claude Code 2.1, Codex 0.160, Gemini CLI 0.62).
 */

const TIMEOUT_MS = 6 * 60_000;
const MAX_OUTPUT = 32 * 1024 * 1024;

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export class CliMissingError extends ProviderError {}

/** Запуск CLI: stdin → stdout, с таймаутом и отменой. Нет программы → CliMissingError. */
export function runCli(
  command: string,
  args: string[],
  opts: { input?: string; cwd?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let size = 0;
    const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs ?? TIMEOUT_MS);
    const onAbort = () => child.kill("SIGTERM");
    opts.signal?.addEventListener("abort", onAbort);
    const collect = (append: (s: string) => void) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) child.kill("SIGTERM");
      else append(chunk.toString("utf8"));
    };
    child.stdout.on("data", collect((s) => (stdout += s)));
    child.stderr.on("data", collect((s) => (stderr += s)));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new CliMissingError(`Программа «${command}» не найдена`, false) : e);
    });
    child.on("close", (code, sig) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (sig && !opts.signal?.aborted) {
        reject(new ProviderError(`${command} не ответил за отведённое время`, true));
        return;
      }
      resolve({ stdout, stderr, code });
    });
    child.stdin.on("error", () => {}); // процесс мог завершиться раньше, чем мы дописали stdin
    child.stdin.end(opts.input ?? "");
  });
}

/** Пустой рабочий каталог: агентам в CLI нечего читать и негде что-то сломать. */
function sandboxDir(): string {
  const dir = path.join(dataDir(), "cli-sandbox");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Системный промпт, диалог и формат ответа — одним текстом (у Codex и Gemini CLI нет отдельного system). */
export function renderCliPrompt(req: AskRequest, opts: { includeSystem: boolean; includeSchema: boolean }): string {
  const parts: string[] = [];
  if (opts.includeSystem && req.system.trim()) parts.push("# Инструкции", req.system, "");
  if (req.messages.length > 1) {
    parts.push("# Диалог");
    for (const m of req.messages) parts.push(`## ${m.role === "user" ? "Пользователь" : "Ты (предыдущий ответ)"}`, m.content, "");
  } else if (req.messages[0]) {
    parts.push("# Задание", req.messages[0].content, "");
  }
  if (opts.includeSchema && req.jsonSchema) {
    parts.push(
      "# Формат ответа",
      "Ответь ТОЛЬКО одним JSON-объектом, без пояснений и без обёртки ```, строго по этой JSON Schema:",
      JSON.stringify(req.jsonSchema),
    );
  }
  return parts.join("\n");
}

const modelsConfig = (): Record<string, ModelEntry[]> => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "cli-models.json"), "utf8"));
  } catch {
    return {};
  }
};

interface CliSpec {
  kind: ProviderKind;
  title: string;
  /** Имя программы по умолчанию (путь можно переопределить в поле «Путь к CLI») */
  command: string;
  install: string;
  login: string;
  images: boolean;
  /** Проверка входа: null — всё хорошо, иначе текст проблемы */
  checkLogin(command: string): Promise<string | null>;
  ask(command: string, model: string, req: AskRequest): Promise<string>;
}

function createCliAdapter(spec: CliSpec): ProviderAdapter {
  const command = (config: ProviderConfig) => config.baseUrl?.trim() || spec.command;
  const notInstalled = () => `${spec.title} не установлен. Установите: ${spec.install}. Затем войдите: ${spec.login}`;

  async function healthCheck(config: ProviderConfig) {
    try {
      const v = await runCli(command(config), ["--version"], { timeoutMs: 30_000 });
      if (v.code !== 0) return { ok: false, error: `${spec.title} не запускается: ${(v.stderr || v.stdout).trim().slice(0, 300)}` };
      const problem = await spec.checkLogin(command(config));
      return problem ? { ok: false, error: `${problem} Войдите через браузер — выполните в терминале: ${spec.login}` } : { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof CliMissingError ? notInstalled() : e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    kind: spec.kind,
    title: spec.title,
    capabilities: { images: spec.images, video: false, pdf: false },
    createModel(config, modelId): ModelProvider {
      return {
        id: `${config.id}:${modelId}`,
        label: `${config.label} · ${modelId}`,
        capabilities: this.capabilities,
        healthCheck: () => healthCheck(config),
        async ask(req) {
          try {
            return await spec.ask(command(config), modelId, req);
          } catch (e) {
            if (e instanceof CliMissingError) throw new ProviderError(notInstalled(), false);
            throw e;
          }
        },
      };
    },
    healthCheck,
    async listModels() {
      return modelsConfig()[spec.kind] ?? [{ id: "default", label: "Модель по умолчанию в CLI" }];
    },
  };
}

/** Похоже ли сообщение CLI на «не залогинен» */
const looksUnauthorized = (text: string) => /log ?in|logged|auth|unauthori[sz]ed|401|credential|api key/i.test(text);

function failure(title: string, text: string, login: string): ProviderError {
  const clean = text.trim().slice(0, 500) || "без сообщения";
  return looksUnauthorized(clean)
    ? new ProviderError(`${title}: нужен вход (${clean}). Выполните в терминале: ${login}`, false, 401)
    : new ProviderError(`${title}: ${clean}`, /rate|limit|overload|timeout|503|529/i.test(clean));
}

/* ---------------- Claude Code ---------------- */

export interface ClaudeResult {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

export function parseClaudeOutput(stdout: string): ClaudeResult {
  const line = stdout.trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
  if (!line) throw new ProviderError(`Claude Code вернул неожиданный ответ: ${stdout.slice(0, 300)}`, false);
  return JSON.parse(line) as ClaudeResult;
}

export const claudeCliAdapter = createCliAdapter({
  kind: "claude-cli",
  title: "Claude Code CLI",
  command: "claude",
  install: "npm install -g @anthropic-ai/claude-code",
  login: "claude auth login",
  images: false,
  async checkLogin(command) {
    const r = await runCli(command, ["auth", "status", "--json"], { timeoutMs: 30_000 });
    try {
      return (JSON.parse(r.stdout) as { loggedIn?: boolean }).loggedIn ? null : "Claude Code не залогинен.";
    } catch {
      return r.code === 0 ? null : "Не удалось проверить вход в Claude Code.";
    }
  },
  async ask(command, model, req) {
    const args = [
      "-p",
      "--output-format", "json",
      // Без инструментов, настроек, MCP и сохранения сессий: чистый вызов модели
      "--tools", "",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--system-prompt", req.system,
    ];
    if (model !== "default") args.push("--model", model);
    if (req.jsonSchema) args.push("--json-schema", JSON.stringify(req.jsonSchema));
    const r = await runCli(command, args, {
      input: renderCliPrompt(req, { includeSystem: false, includeSchema: false }),
      cwd: sandboxDir(),
      signal: req.signal,
    });
    let out: ClaudeResult;
    try {
      out = parseClaudeOutput(r.stdout);
    } catch {
      throw failure("Claude Code", r.stderr || r.stdout, "claude auth login");
    }
    if (out.is_error) throw failure("Claude Code", out.result ?? r.stderr, "claude auth login");
    const u = out.usage;
    if (u) {
      req.onUsage?.({
        inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        cachedInputTokens: u.cache_read_input_tokens ?? 0,
      });
    }
    return out.structured_output !== undefined && out.structured_output !== null ? JSON.stringify(out.structured_output) : (out.result ?? "");
  },
});

/* ---------------- Codex CLI ---------------- */

/** Токены из JSONL-событий Codex (`--json`): берём последнее событие с usage. */
export function parseCodexUsage(stdout: string): Usage | null {
  let found: Usage | null = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const usage = findKey(JSON.parse(line), "usage") as
        | { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number }
        | undefined;
      if (usage && typeof usage.input_tokens === "number") {
        found = { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens ?? 0, cachedInputTokens: usage.cached_input_tokens ?? 0 };
      }
    } catch {
      // не JSON — пропускаем
    }
  }
  return found;
}

function findKey(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  if (key in obj) return (obj as Record<string, unknown>)[key];
  for (const v of Object.values(obj)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

export const codexCliAdapter = createCliAdapter({
  kind: "codex-cli",
  title: "Codex CLI",
  command: "codex",
  install: "npm install -g @openai/codex",
  login: "codex login",
  images: true,
  async checkLogin(command) {
    const r = await runCli(command, ["login", "status"], { timeoutMs: 30_000 });
    const text = `${r.stdout}\n${r.stderr}`;
    return /not logged in/i.test(text) || r.code !== 0 ? "Codex не залогинен." : null;
  },
  async ask(command, model, req) {
    const dir = sandboxDir();
    const id = crypto.randomUUID();
    const outFile = path.join(dir, `codex-${id}.txt`);
    const images: string[] = [];
    try {
      const args = ["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--color", "never", "--json", "-C", dir, "-o", outFile];
      if (model !== "default") args.push("-m", model);
      for (const [i, a] of (req.attachments ?? []).entries()) {
        if (a.kind !== "image") continue;
        const file = a.filePath ?? path.join(dir, `codex-${id}-${i}.${a.mimeType.split("/")[1] ?? "png"}`);
        if (!a.filePath) fs.writeFileSync(file, Buffer.from(attachmentData(a), "base64"));
        if (!a.filePath) images.push(file);
        args.push("-i", file);
      }
      args.push("-"); // промпт — из stdin
      const r = await runCli(command, args, {
        input: renderCliPrompt(req, { includeSystem: true, includeSchema: true }),
        cwd: dir,
        signal: req.signal,
      });
      const usage = parseCodexUsage(r.stdout);
      if (usage) req.onUsage?.(usage);
      const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
      if (r.code !== 0 || !text.trim()) throw failure("Codex", r.stderr || r.stdout, "codex login");
      return text;
    } finally {
      for (const f of [outFile, ...images]) fs.rmSync(f, { force: true });
    }
  },
});

/* ---------------- Gemini CLI ---------------- */

export interface GeminiCliResult {
  response?: string;
  error?: { message?: string };
  stats?: { models?: Record<string, { tokens?: { prompt?: number; candidates?: number; cached?: number } }> };
}

export function parseGeminiOutput(stdout: string): GeminiCliResult {
  const start = stdout.indexOf("{");
  if (start < 0) throw new ProviderError(`Gemini CLI вернул неожиданный ответ: ${stdout.slice(0, 300)}`, false);
  return JSON.parse(stdout.slice(start)) as GeminiCliResult;
}

export const geminiCliAdapter = createCliAdapter({
  kind: "gemini-cli",
  title: "Gemini CLI",
  command: "gemini",
  install: "npm install -g @google/gemini-cli",
  login: "gemini (и выберите «Login with Google»)",
  images: false,
  async checkLogin() {
    // У Gemini CLI нет команды статуса: вход — это сохранённые OAuth-данные или ключ в окружении
    const creds = path.join(os.homedir(), ".gemini", "oauth_creds.json");
    return fs.existsSync(creds) || process.env.GEMINI_API_KEY ? null : "Gemini CLI не залогинен.";
  },
  async ask(command, model, req) {
    const args = ["-p", "Выполни задание, описанное выше.", "-o", "json", "--approval-mode", "plan"];
    if (model !== "default") args.push("-m", model);
    const r = await runCli(command, args, {
      input: renderCliPrompt(req, { includeSystem: true, includeSchema: true }),
      cwd: sandboxDir(),
      signal: req.signal,
    });
    let out: GeminiCliResult;
    try {
      out = parseGeminiOutput(r.stdout);
    } catch {
      throw failure("Gemini CLI", r.stderr || r.stdout, "gemini");
    }
    if (out.error?.message || r.code !== 0) throw failure("Gemini CLI", out.error?.message ?? r.stderr, "gemini");
    const tokens = Object.values(out.stats?.models ?? {}).reduce<Required<Usage>>(
      (acc, m) => ({
        inputTokens: acc.inputTokens + (m.tokens?.prompt ?? 0),
        outputTokens: acc.outputTokens + (m.tokens?.candidates ?? 0),
        cachedInputTokens: acc.cachedInputTokens + (m.tokens?.cached ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    );
    if (tokens.inputTokens || tokens.outputTokens) req.onUsage?.(tokens);
    return out.response ?? "";
  },
});
