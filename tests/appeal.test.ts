import { describe, expect, it } from "vitest";
import { setupTempDataDir } from "./helpers";

setupTempDataDir();
process.env.VERDICT_DEMO_DELAY = "0";
const { createProvider } = await import("@/lib/store/providers");
const cases = await import("@/lib/store/cases");
const runner = await import("@/lib/trial/runner");
const { appealContext } = await import("@/lib/trial/appeal");
const { caseToMarkdown } = await import("@/lib/export/markdown");
const { caseDetails } = await import("@/lib/trial/case-details");

/** Ждёт конца заседания по журналу событий */
function finished(caseId: string) {
  return new Promise<void>((resolve) => {
    if (cases.getCase(caseId).status === "done") return resolve();
    const off = runner.subscribe(caseId, (s) => {
      if (s.event.type === "trial_end") {
        off();
        resolve();
      }
    });
  });
}

describe("апелляция, архив и экспорт", async () => {
  createProvider({ kind: "demo", label: "Демо", apiKey: "", models: [{ id: "demo" }] });
  const original = cases.createCase({ materialText: "Кофе, который будит лучше будильника. Первая чашка бесплатно.", comment: "Instagram" });
  await runner.prepare(original.id);
  const done = finished(original.id);
  runner.start(original.id);
  await done;

  it("апелляцию нельзя подать до вердикта", () => {
    const draft = cases.createCase({ materialText: "Черновик", comment: "" });
    expect(() => runner.startAppeal(draft.id, { segment: "Студенты", age_from: 18, age_to: 24, note: "" })).toThrow(runner.CaseStateError);
  });

  it("контекст апелляции: аудитория, прошлый вердикт и позиции участников", () => {
    const parent = cases.getCase(original.id);
    const ctx = appealContext({ segment: "Студенты", age_from: 18, age_to: 24, note: "Только Telegram" }, parent);
    expect(ctx).toContain("Студенты, 18–24 лет");
    expect(ctx).toContain("Только Telegram");
    expect(ctx).toContain(`${parent.verdict!.success_score}%`);
    expect(ctx).toMatch(/Антон Строгий \(Прокурор\): оценка \d+/);
  });

  it("апелляция — дочернее дело с коротким слушанием и свидетелем из выбранной аудитории", async () => {
    const child = runner.startAppeal(original.id, { segment: "Студенты", age_from: 18, age_to: 24, note: "" });
    expect(child).toMatchObject({ parentId: original.id, status: "running", appeal: { segment: "Студенты" } });
    expect(child.caseFile!.title).toContain("апелляция: Студенты");
    expect(child.participants!.find((p) => p.role === "witness")!.specialization).toBe("Студенты, 18–24 лет");
    await finished(child.id);

    const after = cases.getCase(child.id);
    expect(after.status).toBe("done");
    expect(after.rounds).toBeGreaterThanOrEqual(2);
    expect(after.rounds).toBeLessThanOrEqual(3);

    const details = caseDetails(original.id);
    expect(details.appeals.map((a) => a.id)).toEqual([child.id]);
    expect(caseDetails(child.id).parent?.id).toBe(original.id);
  });

  it("короткое слушание: 2–3 заседания, но не больше общего лимита", () => {
    expect(runner.appealSettings({ minRounds: 2, maxRounds: 5 }, true)).toEqual({ minRounds: 2, maxRounds: 3 });
    expect(runner.appealSettings({ minRounds: 1, maxRounds: 2 }, true)).toEqual({ minRounds: 2, maxRounds: 2 });
    expect(runner.appealSettings({ minRounds: 2, maxRounds: 5 }, false)).toEqual({ minRounds: 2, maxRounds: 5 });
  });

  it("архив: исходные дела с апелляциями внутри, поиск по тексту и аудитории апелляции", () => {
    const all = cases.searchCases();
    expect(all.every((c) => !c.parentId)).toBe(true);
    expect(all.find((c) => c.id === original.id)!.appeals).toHaveLength(1);
    expect(cases.searchCases("будильника").map((c) => c.id)).toContain(original.id);
    expect(cases.searchCases("студенты").map((c) => c.id)).toEqual([original.id]);
    expect(cases.searchCases("нет такого")).toEqual([]);
  });

  it("фактический результат сохраняется и попадает в экспорт", () => {
    cases.updateCase(original.id, { actualResult: { ctr: 1.8, conversion: 3.5, sales: null, note: "Сработал оффер" } });
    const c = cases.getCase(original.id);
    const md = caseToMarkdown({ case: c, events: cases.listEvents(original.id), appeals: cases.listAppeals(original.id) });
    expect(md).toContain(`**Вероятность успеха: ${c.verdict!.success_score}%**`);
    expect(md).toContain("## Целевые аудитории");
    expect(md).toContain("| Аудитория | Возраст | Соответствие | Почему |");
    expect(md).toContain("## Что улучшить");
    expect(md).toContain("- CTR: 1.8%");
    expect(md).toContain("- Заметка: Сработал оффер");
    expect(md).toContain("### Заседание №1");
    expect(md).toMatch(/## Апелляции\n\n- Студенты \(18–24 лет\): \d+%/);
  });

  it("удаление исходного дела удаляет и апелляции", () => {
    const appealId = cases.listAppeals(original.id)[0].id;
    cases.deleteCase(original.id);
    expect(() => cases.getCase(appealId)).toThrow();
  });
});
