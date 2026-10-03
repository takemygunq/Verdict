import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mockModel } from "@/lib/providers/mock";
import { ProviderError } from "@/lib/providers/types";
import { InvalidResponseError, askJson, extractJson, providerSchema } from "@/lib/trial/json";
import { participantAnswerSchema } from "@/lib/trial/schemas";

const schema = z.object({ score: z.number().min(0).max(100) }).meta({ title: "t" });
const req = { system: "s", messages: [{ role: "user" as const, content: "оцени" }] };
const fast = { retryDelayMs: 0 };

describe("извлечение JSON", () => {
  it("понимает чистый JSON, блок ```json и текст вокруг", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Вот ответ:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Конечно! {"a":3} Надеюсь, помог.')).toEqual({ a: 3 });
    expect(() => extractJson("нет тут JSON")).toThrow(SyntaxError);
  });
});

describe("схема для провайдеров", () => {
  it("убирает неподдерживаемые ограничения и сохраняет структуру", () => {
    const s = providerSchema(participantAnswerSchema) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/"(minimum|maximum|minLength|minItems|maxItems|\$schema)"/);
    expect(s.title).toBe("participant_response");
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toContain("emotion");
    expect(s.required).not.toContain("reacts_to");
  });
});

describe("askJson", () => {
  it("возвращает валидный ответ с первой попытки и передаёт схему", async () => {
    const m = mockModel("m", () => '{"score":42}');
    expect(await askJson(m, schema, req, fast)).toEqual({ score: 42 });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].jsonSchema).toMatchObject({ title: "t", type: "object" });
  });

  it("при невалидном ответе повторяет запрос с текстом ошибки", async () => {
    const m = mockModel("m", (_r, i) => (i === 0 ? '{"score":150}' : '{"score":99}'));
    expect(await askJson(m, schema, req, fast)).toEqual({ score: 99 });
    const retry = m.calls[1].messages;
    expect(retry[1]).toEqual({ role: "assistant", content: '{"score":150}' });
    expect(retry[2].content).toMatch(/score/);
    expect(retry[2].content).toMatch(/не прошёл проверку/);
  });

  it("после двух невалидных ответов бросает InvalidResponseError", async () => {
    const m = mockModel("m", () => "я не умею в JSON");
    await expect(askJson(m, schema, req, fast)).rejects.toBeInstanceOf(InvalidResponseError);
    expect(m.calls).toHaveLength(2);
  });

  it("повторяет при сетевой ошибке, но не при неверном ключе", async () => {
    let n = 0;
    const flaky = mockModel("m", () => {
      if (n++ === 0) throw new ProviderError("timeout", true);
      return '{"score":1}';
    });
    expect(await askJson(flaky, schema, req, fast)).toEqual({ score: 1 });

    const denied = mockModel("m", () => {
      throw new ProviderError("bad key", false);
    });
    await expect(askJson(denied, schema, req, fast)).rejects.toThrow("bad key");
    expect(denied.calls).toHaveLength(1);
  });
});
