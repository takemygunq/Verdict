/* eslint-disable @typescript-eslint/no-explicit-any -- в тестах разбираем произвольные тела запросов */
import { afterEach, describe, expect, it } from "vitest";
import { anthropicAdapter } from "@/lib/providers/anthropic";
import { geminiAdapter } from "@/lib/providers/gemini";
import { openaiAdapter } from "@/lib/providers/openai";
import { ProviderError, type ProviderConfig, type Usage } from "@/lib/providers/types";
import { json, sse, stubServer } from "./helpers";

type Stub = Awaited<ReturnType<typeof stubServer>>;
let stub: Stub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

const schema = { type: "object", properties: { score: { type: "number" } }, required: ["score"], additionalProperties: false };
const png = { kind: "image" as const, mimeType: "image/png", data: "iVBORw0KGgo=" };

function config(kind: ProviderConfig["kind"], baseUrl: string): ProviderConfig {
  return { id: "p1", kind, label: "Тест", apiKey: "test-key", baseUrl };
}

describe("Anthropic", () => {
  it("отправляет system, картинку и JSON-схему, собирает текст и usage", async () => {
    stub = await stubServer((req, res) => {
      if (req.url.startsWith("/v1/messages")) {
        sse(res, [
          {
            event: "message_start",
            data: {
              type: "message_start",
              message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 42, output_tokens: 1, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 } },
            },
          },
          { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
          { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"score":' } } },
          { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "73}" } } },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
          { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 7 } } },
          { event: "message_stop", data: { type: "message_stop" } },
        ]);
      } else json(res, 404, {});
    });
    const model = anthropicAdapter.createModel(config("anthropic", stub.url), "some-model");
    let usage: Usage | undefined;
    const out = await model.ask({
      system: "Ты прокурор",
      messages: [{ role: "user", content: "Оцени" }],
      attachments: [png],
      jsonSchema: schema,
      onUsage: (u) => (usage = u),
    });

    expect(out).toBe('{"score":73}');
    // input_tokens у Anthropic без кэша — к ним прибавляются прочитанные из кэша
    expect(usage).toEqual({ inputTokens: 342, outputTokens: 7, cachedInputTokens: 300 });
    const body = stub.requests[0].body as Record<string, any>;
    expect(stub.requests[0].headers["x-api-key"]).toBe("test-key");
    expect(body.model).toBe("some-model");
    expect(body.system).toBe("Ты прокурор");
    expect(body.output_config).toEqual({ format: { type: "json_schema", schema } });
    expect(body.messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/png" } });
    expect(body.messages[0].content[1]).toEqual({ type: "text", text: "Оцени" });
  });

  it("cacheSystem: системный промпт помечается для кэша", async () => {
    stub = await stubServer((_req, res) =>
      sse(res, [
        {
          event: "message_start",
          data: { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } },
        },
        { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "{}" } } },
        { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
        { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } } },
        { event: "message_stop", data: { type: "message_stop" } },
      ]),
    );
    const model = anthropicAdapter.createModel(config("anthropic", stub.url), "some-model");
    await model.ask({ system: "Правила и материалы дела", cacheSystem: true, messages: [{ role: "user", content: "Ты прокурор" }] });
    const body = stub.requests[0].body as Record<string, any>;
    expect(body.system).toEqual([{ type: "text", text: "Правила и материалы дела", cache_control: { type: "ephemeral" } }]);
  });

  it("healthCheck и список моделей", async () => {
    stub = await stubServer((req, res) =>
      json(res, 200, {
        data: [{ id: "model-a", display_name: "Model A", type: "model", created_at: "2026-01-01T00:00:00Z" }],
        has_more: false,
        first_id: "model-a",
        last_id: "model-a",
      }),
    );
    const cfg = config("anthropic", stub.url);
    expect(await anthropicAdapter.healthCheck(cfg)).toEqual({ ok: true });
    expect(await anthropicAdapter.listModels(cfg)).toEqual([{ id: "model-a", label: "Model A" }]);
  });

  it("неверный ключ — понятная ошибка без ретраев", async () => {
    stub = await stubServer((_req, res) =>
      json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
    );
    expect(await anthropicAdapter.healthCheck(config("anthropic", stub.url))).toEqual({
      ok: false,
      error: "Неверный API-ключ Anthropic",
    });
    expect(stub.requests).toHaveLength(1);
  });
});

describe("OpenAI", () => {
  it("отправляет system, картинку и response_format, возвращает текст и usage", async () => {
    stub = await stubServer((req, res) =>
      json(res, 200, {
        id: "c",
        object: "chat.completion",
        created: 0,
        model: "gpt-x",
        choices: [{ index: 0, message: { role: "assistant", content: '{"score":55}', refusal: null }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16, prompt_tokens_details: { cached_tokens: 8 } },
      }),
    );
    const model = openaiAdapter.createModel(config("openai", `${stub.url}/v1`), "gpt-x");
    let usage: Usage | undefined;
    const out = await model.ask({
      system: "Ты адвокат",
      messages: [{ role: "user", content: "Защищай" }],
      attachments: [png],
      jsonSchema: schema,
      onUsage: (u) => (usage = u),
    });

    expect(out).toBe('{"score":55}');
    expect(usage).toEqual({ inputTokens: 11, outputTokens: 5, cachedInputTokens: 8 });
    const req = stub.requests[0];
    expect(req.url).toBe("/v1/chat/completions");
    expect(req.headers.authorization).toBe("Bearer test-key");
    const body = req.body as Record<string, any>;
    expect(body.messages[0]).toEqual({ role: "system", content: "Ты адвокат" });
    expect(body.messages[1].content[0].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(body.response_format.json_schema.schema).toEqual(schema);
  });

  it("список моделей без эмбеддингов и TTS", async () => {
    stub = await stubServer((_req, res) =>
      json(res, 200, {
        object: "list",
        data: ["gpt-b", "text-embedding-3-small", "tts-1", "gpt-a"].map((id) => ({ id, object: "model", created: 0, owned_by: "x" })),
      }),
    );
    expect(await openaiAdapter.listModels(config("openai", `${stub.url}/v1`))).toEqual([{ id: "gpt-a" }, { id: "gpt-b" }]);
  });

  it("отказ модели превращается в ProviderError", async () => {
    stub = await stubServer((_req, res) =>
      json(res, 200, {
        id: "c",
        object: "chat.completion",
        created: 0,
        model: "gpt-x",
        choices: [{ index: 0, message: { role: "assistant", content: null, refusal: "Не могу" }, finish_reason: "stop" }],
      }),
    );
    const model = openaiAdapter.createModel(config("openai", `${stub.url}/v1`), "gpt-x");
    await expect(model.ask({ system: "", messages: [{ role: "user", content: "?" }] })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("Gemini", () => {
  it("отправляет systemInstruction, вложение и JSON-схему", async () => {
    stub = await stubServer((_req, res) =>
      json(res, 200, {
        candidates: [{ content: { role: "model", parts: [{ text: '{"score":81}' }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4, cachedContentTokenCount: 16 },
      }),
    );
    const model = geminiAdapter.createModel(config("gemini", stub.url), "gemini-x");
    let usage: Usage | undefined;
    const out = await model.ask({
      system: "Ты свидетель",
      messages: [{ role: "user", content: "Расскажи" }],
      attachments: [{ kind: "video", mimeType: "video/mp4", data: "AAAA" }],
      jsonSchema: schema,
      onUsage: (u) => (usage = u),
    });

    expect(out).toBe('{"score":81}');
    expect(usage).toEqual({ inputTokens: 20, outputTokens: 4, cachedInputTokens: 16 });
    const req = stub.requests[0];
    expect(req.url).toContain("models/gemini-x:generateContent");
    expect(req.headers["x-goog-api-key"]).toBe("test-key");
    const body = req.body as Record<string, any>;
    expect(body.systemInstruction.parts[0].text).toBe("Ты свидетель");
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: "video/mp4", data: "AAAA" });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema).toEqual(schema);
  });

  it("список моделей — только умеющие generateContent", async () => {
    stub = await stubServer((_req, res) =>
      json(res, 200, {
        models: [
          { name: "models/gemini-x", displayName: "Gemini X", supportedGenerationMethods: ["generateContent"] },
          { name: "models/embedding-1", displayName: "Emb", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    );
    expect(await geminiAdapter.listModels(config("gemini", stub.url))).toEqual([{ id: "gemini-x", label: "Gemini X" }]);
  });

  it("неверный ключ — понятная ошибка", async () => {
    stub = await stubServer((_req, res) =>
      json(res, 400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }),
    );
    expect(await geminiAdapter.healthCheck(config("gemini", stub.url))).toEqual({ ok: false, error: "Неверный API-ключ Gemini" });
  });
});
