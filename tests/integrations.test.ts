/* eslint-disable @typescript-eslint/no-explicit-any -- в тестах разбираем произвольные тела запросов */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { json, setupTempDataDir, stubServer } from "./helpers";

const dataDir = setupTempDataDir();

type Stub = Awaited<ReturnType<typeof stubServer>>;
let stub: Stub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

const schema = { type: "object", properties: { score: { type: "number" } }, required: ["score"] };
const req = { system: "Ты присяжный", messages: [{ role: "user" as const, content: "Оцени рекламу" }], jsonSchema: schema };

/* ---------------- OAuth PKCE ---------------- */

describe("OpenRouter OAuth PKCE", () => {
  it("verifier по RFC 7636 и challenge = base64url(sha256)", async () => {
    const { challengeFor, createVerifier, authorizeUrl } = await import("@/lib/oauth/openrouter");
    const v = createVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(createVerifier()).not.toBe(v);
    // Пример из приложения B RFC 7636
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");

    const url = new URL(authorizeUrl("http://localhost:3000/api/openrouter/callback", v, "st"));
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(url.searchParams.get("callback_url")).toBe("http://localhost:3000/api/openrouter/callback");
    expect(url.searchParams.get("code_challenge")).toBe(challengeFor(v));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
  });

  describe("маршруты", () => {
    let or: Stub;
    beforeAll(async () => {
      or = await stubServer((r, res) => {
        if (r.url === "/api/v1/auth/keys") {
          const b = r.body as any;
          return b.code === "good" ? json(res, 200, { key: "sk-or-v1-test" }) : json(res, 403, { error: { message: "bad code" } });
        }
        if (r.url === "/api/v1/key") return json(res, 200, { data: { label: "Verdict" } });
        if (r.url.startsWith("/api/v1/models")) return json(res, 200, { data: [{ id: "anthropic/claude-x", name: "Claude X" }] });
        json(res, 404, {});
      });
      process.env.OPENROUTER_KEYS_URL = `${or.url}/api/v1/auth/keys`;
      process.env.OPENROUTER_BASE_URL = `${or.url}/api/v1`;
    });
    afterAll(() => or.close());

    async function login() {
      const { GET } = await import("@/app/api/openrouter/login/route");
      const res = await GET(new Request("http://localhost:3000/api/openrouter/login"));
      const cookie = res.headers.get("set-cookie") ?? "";
      expect(cookie).toMatch(/HttpOnly/i);
      const location = new URL(res.headers.get("location")!);
      return { cookie: cookie.split(";")[0], state: location.searchParams.get("state")!, challenge: location.searchParams.get("code_challenge")! };
    }

    async function callback(query: string, cookie: string) {
      const { NextRequest } = await import("next/server");
      const { GET } = await import("@/app/api/openrouter/callback/route");
      const res = await GET(new NextRequest(`http://localhost:3000/api/openrouter/callback?${query}`, { headers: { cookie } }));
      return new URL(res.headers.get("location")!);
    }

    it("код меняется на ключ, провайдер создаётся с моделями", async () => {
      const { cookie, state, challenge } = await login();
      const back = await callback(`code=good&state=${state}`, cookie);
      expect(back.pathname).toBe("/settings");
      expect(back.searchParams.get("openrouter")).toBe("connected");

      const exchange = or.requests.find((r) => r.url === "/api/v1/auth/keys")!.body as any;
      expect(exchange.code).toBe("good");
      expect(exchange.code_challenge_method).toBe("S256");
      // verifier из cookie соответствует challenge, отправленному в OpenRouter
      const hash = crypto.createHash("sha256").update(exchange.code_verifier).digest("base64url");
      expect(hash).toBe(challenge);

      const { listProviders } = await import("@/lib/store/providers");
      const p = listProviders().find((x) => x.kind === "openrouter")!;
      expect(p.apiKeyHint).toContain("test");
      expect(p.lastCheck?.ok).toBe(true);
      expect(p.models.map((m) => m.id)).toEqual(["anthropic/claude-x"]);
    });

    it("подменённый state и плохой код — ошибка без провайдера", async () => {
      const { listProviders } = await import("@/lib/store/providers");
      const before = listProviders().length;
      const { cookie, state } = await login();
      expect((await callback(`code=good&state=evil`, cookie)).searchParams.get("openrouter")).toBe("error");
      expect((await callback(`code=good&state=${state}`, "")).searchParams.get("openrouter")).toBe("error");
      const bad = await callback(`code=bad&state=${state}`, cookie);
      expect(bad.searchParams.get("message")).toContain("bad code");
      expect(listProviders().length).toBe(before);
    });
  });
});

/* ---------------- OpenRouter и Ollama на HTTP-стабе ---------------- */

const completion = (content: string) => ({
  id: "c",
  object: "chat.completion",
  created: 0,
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content, refusal: null }, finish_reason: "stop" }],
  usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
});

describe("OpenRouter и Ollama", () => {
  it("OpenRouter: Bearer-ключ и заголовки атрибуции", async () => {
    const { openrouterAdapter } = await import("@/lib/providers/openai");
    stub = await stubServer((_r, res) => json(res, 200, completion('{"score":40}')));
    const model = openrouterAdapter.createModel({ id: "p", kind: "openrouter", label: "OR", apiKey: "sk-or", baseUrl: stub.url }, "openai/gpt-x");
    expect(await model.ask(req)).toBe('{"score":40}');
    const r = stub.requests[0];
    expect(r.headers.authorization).toBe("Bearer sk-or");
    expect(r.headers["x-title"]).toBe("Verdict");
    expect((r.body as any).model).toBe("openai/gpt-x");
  });

  it("OpenRouter: неверный ключ при проверке", async () => {
    const { openrouterAdapter } = await import("@/lib/providers/openai");
    stub = await stubServer((_r, res) => json(res, 401, { error: { message: "No auth" } }));
    const check = await openrouterAdapter.healthCheck({ id: "p", kind: "openrouter", label: "OR", apiKey: "bad", baseUrl: stub.url });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("ключ");
  });

  it("Ollama: работает без ключа, список моделей из /models", async () => {
    const { ollamaAdapter } = await import("@/lib/providers/openai");
    stub = await stubServer((r, res) =>
      r.url.endsWith("/models")
        ? json(res, 200, { object: "list", data: [{ id: "llama3.2", object: "model", created: 0, owned_by: "library" }] })
        : json(res, 200, completion('{"score":61}')),
    );
    const cfg = { id: "o", kind: "ollama" as const, label: "Ollama", apiKey: "", baseUrl: `${stub.url}/v1` };
    expect(await ollamaAdapter.listModels(cfg)).toEqual([{ id: "llama3.2" }]);
    expect(await ollamaAdapter.createModel(cfg, "llama3.2").ask(req)).toBe('{"score":61}');
  });

  it("Ollama не запущена — подсказка про ollama serve", async () => {
    const { ollamaAdapter } = await import("@/lib/providers/openai");
    const check = await ollamaAdapter.healthCheck({ id: "o", kind: "ollama", label: "Ollama", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("ollama serve");
  });
});

/* ---------------- CLI-мосты на фейковых исполняемых файлах ---------------- */

const binDir = path.join(dataDir, "fake-bin");
const logFile = path.join(dataDir, "cli-log.json");

/** Фейковая программа: пишет argv и stdin в лог и отвечает по сценарию. */
function fakeCli(name: string, body: string): string {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, name);
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
let input = "";
const done = () => {
  if (args[0] !== "--version") fs.writeFileSync(${JSON.stringify(logFile)}, JSON.stringify({ args, input }));
  ${body}
};
if (process.stdin.isTTY) done(); else { process.stdin.on("data", (c) => (input += c)); process.stdin.on("end", done); }
`,
  );
  fs.chmodSync(file, 0o755);
  return file;
}
const lastCall = () => JSON.parse(fs.readFileSync(logFile, "utf8")) as { args: string[]; input: string };
const cliConfig = (kind: "claude-cli" | "codex-cli" | "gemini-cli", baseUrl: string) => ({ id: "c", kind, label: "CLI", apiKey: "", baseUrl });

describe("CLI-мосты", () => {
  it("Claude Code: флаги изоляции, схема, structured_output и usage", async () => {
    const { claudeCliAdapter } = await import("@/lib/providers/cli");
    const bin = fakeCli(
      "claude",
      `if (args[0] === "--version") return console.log("2.1.288 (Claude Code)");
       if (args[0] === "auth") return console.log(JSON.stringify({ loggedIn: true }));
       console.log(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: { score: 77 },
         usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 4 } }));`,
    );
    const cfg = cliConfig("claude-cli", bin);
    expect(await claudeCliAdapter.healthCheck(cfg)).toEqual({ ok: true });
    let usage: unknown;
    const out = await claudeCliAdapter.createModel(cfg, "sonnet").ask({ ...req, onUsage: (u) => (usage = u) });
    expect(JSON.parse(out)).toEqual({ score: 77 });
    expect(usage).toEqual({ inputTokens: 15, outputTokens: 4, cachedInputTokens: 5 });
    const { args, input } = lastCall();
    expect(args).toEqual(expect.arrayContaining(["-p", "--no-session-persistence", "--strict-mcp-config"]));
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("Ты присяжный");
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1])).toEqual(schema);
    expect(input).toContain("Оцени рекламу");
  });

  it("Claude Code: не залогинен и ошибка входа при запросе", async () => {
    const { claudeCliAdapter } = await import("@/lib/providers/cli");
    const { ProviderError } = await import("@/lib/providers/types");
    const bin = fakeCli(
      "claude-out",
      `if (args[0] === "--version") return console.log("2.1.288");
       if (args[0] === "auth") return console.log(JSON.stringify({ loggedIn: false }));
       console.log(JSON.stringify({ is_error: true, result: "Invalid API key · Please run /login" }));`,
    );
    const cfg = cliConfig("claude-cli", bin);
    const check = await claudeCliAdapter.healthCheck(cfg);
    expect(check.ok).toBe(false);
    expect(check.error).toContain("claude auth login");
    const err = await claudeCliAdapter.createModel(cfg, "default").ask(req).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(401);
    expect(lastCall().args).not.toContain("--model");
  });

  it("Codex: ответ из файла -o, схема в промпте, картинка через -i, usage из JSONL", async () => {
    const { codexCliAdapter } = await import("@/lib/providers/cli");
    const bin = fakeCli(
      "codex",
      `if (args[0] === "--version") return console.log("codex-cli 0.160.0");
       if (args[0] === "login") return console.log("Logged in using ChatGPT");
       fs.writeFileSync(args[args.indexOf("-o") + 1], '{"score":33}');
       console.log(JSON.stringify({ type: "thread.started" }));
       console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 120, cached_input_tokens: 100, output_tokens: 8 } }));`,
    );
    const cfg = cliConfig("codex-cli", bin);
    expect(await codexCliAdapter.healthCheck(cfg)).toEqual({ ok: true });
    let usage: unknown;
    const out = await codexCliAdapter
      .createModel(cfg, "gpt-5-codex")
      .ask({ ...req, attachments: [{ kind: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }], onUsage: (u) => (usage = u) });
    expect(out).toBe('{"score":33}');
    expect(usage).toEqual({ inputTokens: 120, outputTokens: 8, cachedInputTokens: 100 });
    const { args, input } = lastCall();
    expect(args.slice(0, 2)).toEqual(["exec", "--skip-git-repo-check"]);
    expect(args).toEqual(expect.arrayContaining(["--ephemeral", "--sandbox", "read-only", "-m", "gpt-5-codex", "-"]));
    const image = args[args.indexOf("-i") + 1];
    expect(image).toMatch(/\.png$/);
    expect(fs.existsSync(image)).toBe(false); // временные файлы убраны
    expect(input).toContain("Ты присяжный");
    expect(input).toContain('"score"');
  });

  it("Codex: «Not logged in» с кодом 0 — не залогинен", async () => {
    const { codexCliAdapter } = await import("@/lib/providers/cli");
    const bin = fakeCli("codex-out", `if (args[0] === "--version") return console.log("0.160"); console.log("Not logged in");`);
    const check = await codexCliAdapter.healthCheck(cliConfig("codex-cli", bin));
    expect(check.ok).toBe(false);
    expect(check.error).toContain("codex login");
  });

  it("Gemini CLI: JSON-ответ с шумом перед ним, usage из stats", async () => {
    const { geminiCliAdapter } = await import("@/lib/providers/cli");
    process.env.GEMINI_API_KEY = "test";
    const bin = fakeCli(
      "gemini",
      `if (args[0] === "--version") return console.log("0.62.0");
       console.log("Loaded cached credentials.");
       console.log(JSON.stringify({ response: '{"score":58}', stats: { models: { "gemini-2.5-pro": { tokens: { prompt: 200, candidates: 12, cached: 150 } } } } }));`,
    );
    const cfg = cliConfig("gemini-cli", bin);
    expect(await geminiCliAdapter.healthCheck(cfg)).toEqual({ ok: true });
    let usage: unknown;
    expect(await geminiCliAdapter.createModel(cfg, "default").ask({ ...req, onUsage: (u) => (usage = u) })).toBe('{"score":58}');
    expect(usage).toEqual({ inputTokens: 200, outputTokens: 12, cachedInputTokens: 150 });
    const { args, input } = lastCall();
    expect(args).toEqual(expect.arrayContaining(["-o", "json", "--approval-mode", "plan"]));
    expect(args).not.toContain("-m");
    expect(input).toContain("Оцени рекламу");
    delete process.env.GEMINI_API_KEY;
  });

  it("программа не установлена — инструкция по установке", async () => {
    const { claudeCliAdapter } = await import("@/lib/providers/cli");
    const check = await claudeCliAdapter.healthCheck(cliConfig("claude-cli", path.join(binDir, "nope")));
    expect(check.ok).toBe(false);
    expect(check.error).toContain("npm install -g @anthropic-ai/claude-code");
  });

  it("список моделей из config/cli-models.json", async () => {
    const { claudeCliAdapter } = await import("@/lib/providers/cli");
    const ids = (await claudeCliAdapter.listModels(cliConfig("claude-cli", ""))).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["default", "opus", "sonnet"]));
  });
});
