import { describe, expect, it } from "vitest";
import { setupTempDataDir } from "./helpers";

setupTempDataDir();
const providers = await import("@/lib/store/providers");
const settings = await import("@/lib/store/settings");
const { db, schema } = await import("@/lib/db");

describe("хранилище провайдеров", () => {
  it("создаёт провайдера и не отдаёт ключ наружу", () => {
    const p = providers.createProvider({ kind: "openai", label: "Мой OpenAI", apiKey: "sk-secret-value-9999" });
    expect(p.apiKeyHint).toBe("••••9999");
    expect(JSON.stringify(p)).not.toContain("sk-secret");
    expect(providers.listProviders().map((x) => x.id)).toContain(p.id);

    const row = db().select().from(schema.providers).all().find((r) => r.id === p.id)!;
    expect(row.apiKeyEnc).not.toContain("sk-secret");
    expect(providers.providerConfig(p.id).apiKey).toBe("sk-secret-value-9999");
  });

  it("обновляет модели, ключ и флаг включения", () => {
    const p = providers.createProvider({ kind: "gemini", label: "G", apiKey: "key-aaaa-1111" });
    const u = providers.updateProvider(p.id, { models: [{ id: "m1" }], enabled: false, apiKey: "key-bbbb-2222" });
    expect(u.models).toEqual([{ id: "m1" }]);
    expect(u.enabled).toBe(false);
    expect(u.apiKeyHint).toBe("••••2222");
    expect(providers.providerConfig(p.id).apiKey).toBe("key-bbbb-2222");
  });

  it("удаляет провайдера и бросает NotFound для неизвестного id", () => {
    const p = providers.createProvider({ kind: "anthropic", label: "A", apiKey: "k-123456789" });
    providers.deleteProvider(p.id);
    expect(() => providers.getProvider(p.id)).toThrow(providers.NotFoundError);
  });
});

describe("настройки", () => {
  it("возвращает значения по умолчанию", () => {
    const s = settings.getSettings();
    expect(s).toMatchObject({ minRounds: 2, maxRounds: 5, spreadThreshold: 6, budgetUsd: 2 });
    expect(s.roleWeights).toEqual({ prosecutor: 0.75, defense: 0.75, witness: 1, juror: 1 });
  });

  it("частичное сохранение не сбрасывает остальные поля", () => {
    settings.saveSettings({ budgetUsd: 5 });
    settings.saveSettings({ maxRounds: 4 });
    expect(settings.getSettings()).toMatchObject({ budgetUsd: 5, maxRounds: 4, minRounds: 2 });
  });

  it("отклоняет минимум заседаний больше максимума", () => {
    expect(() => settings.saveSettings({ minRounds: 5, maxRounds: 3 })).toThrow();
  });
});
