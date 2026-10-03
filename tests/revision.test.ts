import { describe, expect, it } from "vitest";
import { setupTempDataDir } from "./helpers";

setupTempDataDir();
process.env.VERDICT_DEMO_DELAY = "0";
const { createProvider } = await import("@/lib/store/providers");
const cases = await import("@/lib/store/cases");
const runner = await import("@/lib/trial/runner");
const { caseDetails } = await import("@/lib/trial/case-details");
const { textSimilarity, REVISION_SIMILARITY, revisionFor } = await import("@/lib/trial/revision");
const { caseToMarkdown } = await import("@/lib/export/markdown");

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

/** Ждёт, пока фоновая подготовка или связывание версий закончатся */
async function settled(caseId: string) {
  for (let i = 0; i < 200 && cases.getCase(caseId).status === "preparing"; i++) await new Promise((r) => setTimeout(r, 10));
  return cases.getCase(caseId);
}

const V1 =
  "OATBOOST — холодный кофе на овсяном молоке с 15 г горохового белка, банка 250 мл за $2,90. " +
  "Кампания на 6 месяцев, бюджет $420 000, цель 500 000 банок. Выкладка на полке рядом с протеиновыми коктейлями. " +
  "Сэмплинг в фитнес-клубах, блогеры, ТВ-флайты, билборды, скидка 20% на старте.";
const V2 =
  "OATBOOST — холодный кофе на овсяном молоке с 15 г горохового белка, банка 250 мл за $2,90. " +
  "Кампания на 6 месяцев, бюджет $420 000, цель 500 000 банок. Основная выкладка — на полке рядом с протеиновыми коктейлями. " +
  "Сэмплинг в 120 фитнес-клубах с QR-купоном, блогеры, ТВ — только гео-тест, без скидки на старте. Панель чеков для повторных покупок.";

describe("сходство версий", () => {
  it("версии одного материала похожи, разные материалы — нет", () => {
    expect(textSimilarity(V1, V2)).toBeGreaterThan(REVISION_SIMILARITY);
    expect(textSimilarity(V1, "Курсы английского для детей 7–12 лет: первое занятие бесплатно, группы до 6 человек.")).toBeLessThan(0.2);
  });
});

describe("повторное рассмотрение", async () => {
  createProvider({ kind: "demo", label: "Демо", apiKey: "", models: [{ id: "demo" }] });
  const v1 = cases.createCase({ materialText: V1, comment: "" });
  await runner.prepare(v1.id);
  const doneV1 = finished(v1.id);
  runner.start(v1.id);
  await doneV1;
  const first = cases.getCase(v1.id);

  it("новую версию можно подать только к делу с вердиктом", () => {
    const draft = cases.createCase({ materialText: "Черновик", comment: "" });
    const v = cases.createCase({ materialText: V2, comment: "", previousId: draft.id });
    expect(() => runner.startLinkRevision(v.id, draft.id)).toThrow(runner.CaseStateError);
  });

  it("кнопка «новая версия»: тот же состав суда, сравнение версий, отчёт судьи по прошлым советам", async () => {
    const v2 = cases.createCase({ materialText: V2, comment: "", previousId: v1.id });
    const prepared = await runner.prepare(v2.id);

    // Тот же суд — те же люди, что в первый раз
    expect(prepared.participants!.map((p) => p.name)).toEqual(first.participants!.map((p) => p.name));
    expect(prepared.revision).toMatchObject({ status: "linked", previousId: v1.id, version: 2, previous: { score: first.verdict!.success_score } });
    const rev = prepared.revision!.status === "linked" ? prepared.revision! : null;
    expect(rev!.changes.length).toBeGreaterThan(0);
    expect(rev!.recommendations.map((r) => r.change)).toEqual(first.verdict!.improvements.map((i) => i.change));
    expect(rev!.recommendations[0].status).toBe("implemented");

    // Суд получает прошлый вердикт, статусы советов и изменения
    const ctx = revisionFor(prepared)!.context;
    expect(ctx).toContain("версия 2");
    expect(ctx).toContain(first.verdict!.improvements[0].change);
    expect(ctx).toContain("**выполнен**");
    expect(ctx).toContain(`${first.verdict!.success_score}%`);

    const done = finished(v2.id);
    runner.start(v2.id);
    await done;
    const after = cases.getCase(v2.id);
    expect(after.verdict!.prior_recommendations).toHaveLength(first.verdict!.improvements.length);
    expect(after.verdict!.prior_recommendations![0].change).toBe(first.verdict!.improvements[0].change);
    expect(cases.listEvents(v2.id)[0].event).toMatchObject({ type: "session_open", text: expect.stringContaining("версия 2") });

    // Связи видны с обеих сторон, а в экспорте есть раздел о прошлых советах
    expect(caseDetails(v2.id).previous!.id).toBe(v1.id);
    expect(caseDetails(v1.id).newerVersions.map((c) => c.id)).toContain(v2.id);
    const md = caseToMarkdown({ case: cases.getCase(v2.id), events: cases.listEvents(v2.id) });
    expect(md).toContain("## Повторное рассмотрение");
    expect(md).toContain(first.verdict!.improvements[0].change);
  });

  it("автоподсказка: похожее дело из архива предлагается, связывается или отклоняется", async () => {
    const v3 = cases.createCase({ materialText: V2, comment: "Третья версия" });
    await runner.prepare(v3.id);
    const candidate = caseDetails(v3.id).revisionCandidate;
    expect(candidate).not.toBeNull();
    expect(candidate!.similarity).toBeGreaterThanOrEqual(REVISION_SIMILARITY);

    runner.startLinkRevision(v3.id, candidate!.id);
    const linked = await settled(v3.id);
    expect(linked.status).toBe("ready");
    expect(linked.revision).toMatchObject({ status: "linked", previousId: candidate!.id });
    expect(caseDetails(v3.id).revisionCandidate).toBeNull();

    // Передумали: отвязываем — и больше не предлагаем
    runner.dismissRevision(v3.id);
    const details = caseDetails(v3.id);
    expect(details.case.revision).toEqual({ status: "dismissed" });
    expect(details.case.previousId).toBeNull();
    expect(details.revisionCandidate).toBeNull();
  });

  it("непохожее дело связь не предлагает", async () => {
    const other = cases.createCase({ materialText: "Курсы английского для детей 7–12 лет: первое занятие бесплатно.", comment: "" });
    await runner.prepare(other.id);
    expect(caseDetails(other.id).revisionCandidate).toBeNull();
  });

  it("если прошлое дело удалено, связь обнуляется, а снимок остаётся", async () => {
    const base = cases.createCase({ materialText: V1, comment: "" });
    await runner.prepare(base.id);
    const d = finished(base.id);
    runner.start(base.id);
    await d;
    const next = cases.createCase({ materialText: V2, comment: "", previousId: base.id });
    await runner.prepare(next.id);
    cases.deleteCase(base.id);
    const after = cases.getCase(next.id);
    expect(after.previousId).toBeNull();
    expect(after.revision).toMatchObject({ status: "linked", previousId: base.id });
    expect(revisionFor(after)!.context).toContain("дело удалено");
  });
});
