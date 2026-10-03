import { describe, expect, it } from "vitest";
import { setupTempDataDir } from "./helpers";

setupTempDataDir();
process.env.VERDICT_DEMO_DELAY = "0";
const { createProvider } = await import("@/lib/store/providers");
const { createCase, getCase, listEvents } = await import("@/lib/store/cases");
const runner = await import("@/lib/trial/runner");
const { patchCase } = await import("@/lib/trial/case-details");

describe("полный цикл на демо-провайдере (БД + журнал событий)", () => {
  it("подготовка → правка → заседание → вердикт", async () => {
    createProvider({ kind: "demo", label: "Демо", apiKey: "", models: [{ id: "demo" }] });
    const c = createCase({ materialText: "Скидка 20% на первый заказ пиццы!", comment: "Таргет ВК" });

    const prepared = await runner.prepare(c.id);
    expect(prepared.status).toBe("ready");
    expect(prepared.caseFile?.material_text).toBe("Скидка 20% на первый заказ пиццы!");
    expect(prepared.participants?.map((p) => p.role)).toEqual([
      "secretary", "judge", "prosecutor", "defense", "witness", "juror", "juror", "juror",
    ]);
    await expect(runner.prepare(c.id)).rejects.toBeInstanceOf(runner.CaseStateError);

    // Пользователь убирает одного присяжного
    const roster = prepared.participants!.filter((p) => p.id !== "juror-3");
    expect(patchCase(c.id, { participants: roster }).case.participants).toHaveLength(7);
    expect(() => patchCase(c.id, { participants: roster.filter((p) => p.role !== "juror") })).toThrow(/Присяжных/);

    const done = new Promise<void>((resolve) =>
      runner.subscribe(c.id, (s) => s.event.type === "trial_end" && resolve()),
    );
    runner.start(c.id);
    expect(() => runner.start(c.id)).toThrow(runner.CaseStateError);
    await done;

    const final = getCase(c.id);
    expect(final.status).toBe("done");
    expect(final.verdict?.success_score).toBeGreaterThan(0);
    expect(final.rounds).toBeGreaterThanOrEqual(2);
    expect(final.inputTokens).toBeGreaterThan(0);

    const events = listEvents(c.id);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events[0].event.type).toBe("session_open");
    expect(events.at(-1)!.event).toEqual({ type: "trial_end", status: "done" });
    expect(listEvents(c.id, events.length - 2)).toHaveLength(2);
  });

  it("без провайдеров подготовка падает с понятной ошибкой и дело можно подготовить снова", async () => {
    // Демо-провайдер из прошлого теста включён — выключаем всех
    const { listProviders, updateProvider } = await import("@/lib/store/providers");
    for (const p of listProviders()) updateProvider(p.id, { enabled: false });
    const c = createCase({ materialText: "Текст", comment: "" });
    await expect(runner.prepare(c.id)).rejects.toThrow(/Нет ни одного/);
    expect(getCase(c.id)).toMatchObject({ status: "draft", error: expect.stringMatching(/Нет ни одного/) });
  });
});
