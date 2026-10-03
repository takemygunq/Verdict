import { describe, expect, it } from "vitest";
import { mockModel, schemaTitle, type MockHandler } from "@/lib/providers/mock";
import { ProviderError, type AskRequest } from "@/lib/providers/types";
import { runTrial, TrialError, type TrialSettings } from "@/lib/trial/engine";
import type { TrialEvent } from "@/lib/trial/events";
import { loadPrompt } from "@/lib/trial/prompts";
import type { CaseFile, Participant } from "@/lib/trial/schemas";

const caseFile: CaseFile = {
  title: "Дело о скучном баннере",
  material_type: "text_ad",
  summary: "Реклама кофейни",
  key_facts: ["Instagram"],
  material_text: "Лучший кофе в городе! Заходи.",
  comment: "Бюджет 50 000 ₽",
  media: [],
};

const ref = (modelId: string) => ({ providerId: "p", modelId });
const P = (id: string, role: Participant["role"], name: string, model = "debater"): Participant => ({
  id,
  role,
  name,
  specialization: role === "juror" ? "Маркетолог" : "",
  character: "Въедливый",
  model: ref(model),
});

const roster: Participant[] = [
  P("secretary", "secretary", "Секретарь", "secretary"),
  P("judge", "judge", "Судья", "judge"),
  P("prosecutor", "prosecutor", "Прокуроров"),
  P("defense", "defense", "Адвокатова"),
  P("witness", "witness", "Свидетелев"),
  P("juror-1", "juror", "Присяжный Один"),
  P("juror-2", "juror", "Присяжная Два"),
];

const settings: TrialSettings = {
  minRounds: 2,
  maxRounds: 5,
  spreadThreshold: 10,
  roleWeights: { prosecutor: 0.75, defense: 0.75, witness: 1, juror: 1 },
};

// Роль и имя — в сообщении участника; системный промпт общий для всех (кэшируется)
const nameOf = (req: AskRequest) => req.messages[0].content.match(/\*\*Имя:\*\* (.+)/)![1];
const roundOf = (req: AskRequest) => Number(req.messages[0].content.match(/заседание №(\d+)/i)![1]);

function speech(score: number, extra: object = {}) {
  return JSON.stringify({
    score,
    plan_quality: score,
    stance: `Оценка ${score}`,
    speech: `Ваша честь, моя оценка ${score}.`,
    strengths: ["Коротко"],
    weaknesses: ["Без оффера"],
    audience_guess: [{ segment: "Студенты", age_from: 18, age_to: 25 }],
    emotion: "calm",
    intensity: 2,
    ...extra,
  });
}

const judgeAnswer = JSON.stringify({
  confidence: "high",
  outcome: "conditional",
  verdict_speech: "Именем маркетинга!",
  verdict: "Нужны правки.",
  audiences: [{ segment: "Студенты", age_from: 18, age_to: 25, fit: 70, why: "Цена" }],
  improvements: [{ change: "Добавить цену", why: "Конкретика", impact: "high", effort: "low", blocking: true }],
  risks: ["Слабый охват"],
  dissent: [],
});

/** Сценарий: scores[имя][раунд-1] — оценка участника; decisions — new_arguments секретаря по раундам. */
function setup(opts: {
  scores: Record<string, number[]>;
  newArguments?: boolean[];
  debater?: MockHandler;
  judge?: MockHandler;
}) {
  const debater = mockModel(
    "debater",
    opts.debater ??
      ((req) => {
        const r = roundOf(req);
        const list = opts.scores[nameOf(req)];
        return speech(list[Math.min(r, list.length) - 1], r > 1 ? { reacts_to: "прокуроров", changed_score_because: "Убедили" } : {});
      }),
  );
  const secretary = mockModel("secretary", (req) => {
    if (schemaTitle(req) === "judge_verdict") return judgeAnswer; // замена судьи
    const r = Number(req.system.match(/заседание №(\d+)/)![1]);
    const fresh = opts.newArguments?.[r - 1] ?? true;
    return JSON.stringify({ new_arguments: fresh, reason: `Решение ${r}`, established_facts: [`Факт ${r}`] });
  });
  const judge = mockModel("judge", opts.judge ?? (() => judgeAnswer));
  const models = { debater, secretary, judge };
  const events: TrialEvent[] = [];
  const deps = {
    getModel: (r: { modelId: string }) => models[r.modelId as keyof typeof models],
    emit: (e: TrialEvent) => events.push(e),
    json: { retryDelayMs: 0 },
  };
  return { deps, events, models };
}

const of = <T extends TrialEvent["type"]>(events: TrialEvent[], type: T) =>
  events.filter((e): e is Extract<TrialEvent, { type: T }> => e.type === type);

describe("заседание", () => {
  it("закрывается при консенсусе без новых доводов и считает вердикт кодом", async () => {
    const { deps, events, models } = setup({
      newArguments: [true, false],
      scores: {
        Прокуроров: [20, 55],
        Адвокатова: [90, 65],
        Свидетелев: [60, 60],
        "Присяжный Один": [50, 58],
        "Присяжная Два": [70, 62],
      },
    });
    const { verdict, rounds } = await runTrial({ caseFile, participants: roster, settings }, deps);

    expect(rounds).toBe(2);
    expect(of(events, "round_start").map((e) => e.round)).toEqual([1, 2]);
    expect(of(events, "speech")).toHaveLength(10);
    const decisions = of(events, "secretary_decision");
    expect(decisions.map((d) => d.decision)).toEqual(["continue", "close"]);

    // Итог — взвешенная медиана последних оценок [55, 65, 60, 58, 62]
    expect(verdict.success_score).toBe(60);
    expect(verdict.score_range).toEqual([55, 65]);
    expect(verdict.outcome).toBe("conditional");
    // Судья получил рассчитанную оценку, а не считал сам
    expect(models.judge.calls[0].system).toContain("**60**");
    expect(events.at(-1)).toMatchObject({ type: "verdict" });
    // reacts_to нормализован к точному имени; реакция на самого себя отброшена
    const r2 = of(events, "speech").filter((s) => s.round === 2);
    expect(r2.find((s) => s.participantId === "defense")!.response.reacts_to).toBe("Прокуроров");
    expect(r2.find((s) => s.participantId === "prosecutor")!.response.reacts_to).toBeUndefined();
  });

  it("в слепом заседании участники не видят друг друга, в дебатах — видят", async () => {
    const scores = { Прокуроров: [10, 10, 10], Адвокатова: [90, 90, 90], Свидетелев: [50, 50, 50], "Присяжный Один": [50, 50, 50], "Присяжная Два": [50, 50, 50] };
    const { deps, models } = setup({ scores, newArguments: [true, true, false] });
    await runTrial({ caseFile, participants: roster, settings }, deps);

    const r1 = models.debater.calls.filter((c) => roundOf(c) === 1);
    const r2 = models.debater.calls.filter((c) => roundOf(c) === 2);
    expect(r1.every((c) => !c.messages[0].content.includes("Позиции остальных"))).toBe(true);
    const prosecutorR2 = r2.find((c) => nameOf(c) === "Прокуроров")!;
    expect(prosecutorR2.messages[0].content).toContain("Адвокатова");
    expect(prosecutorR2.messages[0].content).toContain("Оценка: 90");
    expect(prosecutorR2.messages[0].content).toMatch(/Твоя позиция[\s\S]*Оценка: 10/);
  });

  it("оценки сблизились, но прозвучали новые доводы — прения продолжаются, пока консенсус не повторится", async () => {
    const scores = { Прокуроров: [20, 55, 57], Адвокатова: [90, 65, 63], Свидетелев: [60, 60, 60], "Присяжный Один": [50, 58, 59], "Присяжная Два": [70, 62, 61] };
    const { deps, events } = setup({ scores, newArguments: [true, true, true] });
    const { rounds } = await runTrial({ caseFile, participants: roster, settings }, deps);
    expect(rounds).toBe(3);
    const decisions = of(events, "secretary_decision");
    expect(decisions.map((d) => d.decision)).toEqual(["continue", "continue", "close"]);
  });

  it("закрывается без новых аргументов, хотя разброс большой", async () => {
    const scores = { Прокуроров: [10], Адвокатова: [90], Свидетелев: [50], "Присяжный Один": [40], "Присяжная Два": [60] };
    const { deps, events } = setup({ scores, newArguments: [true, true, false] });
    const { rounds } = await runTrial({ caseFile, participants: roster, settings }, deps);
    expect(rounds).toBe(3);
    expect(of(events, "secretary_decision").at(-1)).toMatchObject({ decision: "close", newArguments: false });
  });

  it("останавливается на лимите заседаний и снижает уверенность при разбросе", async () => {
    const scores = { Прокуроров: [10], Адвокатова: [90], Свидетелев: [50], "Присяжный Один": [30], "Присяжная Два": [70] };
    const { models, events, verdict } = await (async () => {
      const s = setup({ scores, newArguments: [true, true, true, true, true] });
      const r = await runTrial({ caseFile, participants: roster, settings: { ...settings, maxRounds: 4 } }, s.deps);
      return { ...s, verdict: r.verdict };
    })();
    expect(of(events, "round_start")).toHaveLength(4);
    expect(of(events, "secretary_decision").at(-1)!.decision).toBe("close");
    // Исход по регламенту секретарь узнаёт до того, как пишет обоснование, и не может ему противоречить
    const lastAsk = models.secretary.calls.at(-1)!;
    expect(lastAsk.system).toMatch(/уже принято: слушания закрываются\. Достигнут лимит/);
    expect(of(events, "secretary_decision").at(-1)!.reason).not.toMatch(/Однако/);
    expect(verdict.confidence).toBe("low"); // std ≈ 27 при пороге 10
  });

  it("секретарь видит оба возможных исхода, когда решение зависит от новизны доводов", async () => {
    const scores = { Прокуроров: [10], Адвокатова: [90], Свидетелев: [50], "Присяжный Один": [40], "Присяжная Два": [60] };
    const { deps, models } = setup({ scores, newArguments: [true, false] });
    await runTrial({ caseFile, participants: roster, settings: { ...settings, minRounds: 1 } }, deps);
    const round2 = models.secretary.calls.find((c) => /заседание №2/.test(c.system))!;
    expect(round2.system).toContain("`new_arguments` = true), слушания продолжаются");
    expect(round2.system).toContain("`new_arguments` = false), слушания закрываются");
  });

  it("установленные факты секретаря уходят участникам и судье, расчёты считает код", async () => {
    const { deps, events, models } = setup({
      scores: {},
      newArguments: [true, false],
      debater: (req) =>
        speech(50, {
          plan_quality: nameOf(req) === "Прокуроров" ? 40 : 80,
          calculations: [
            { label: "Розница", expression: "(120*20+700*30+380*14)*26", assumptions: "все точки на норме" },
            { label: "Сломанный", expression: "2,90*3", assumptions: "" },
          ],
        }),
    });
    const { verdict } = await runTrial({ caseFile, participants: roster, settings }, deps);

    const speech1 = of(events, "speech")[0].response;
    expect(speech1.calculations![0]).toMatchObject({ result: 746720 });
    expect(speech1.calculations![1]).toMatchObject({ result: null, error: expect.stringMatching(/через точку/) });

    const debateR2 = models.debater.calls.find((c) => roundOf(c) === 2)!;
    expect(debateR2.messages[0].content).toMatch(/## Установленные факты\n- Факт 1/);
    expect(debateR2.messages[0].content).toContain("Розница: (120*20+700*30+380*14)*26 = 746 720 (допущения: все точки на норме)");
    const judgeAsk = models.judge.calls.at(-1)!;
    expect(judgeAsk.messages[0].content).toContain("# Установленные факты (итог секретаря)\n\n- Факт 2");

    // Качество плана — отдельная взвешенная медиана
    expect(verdict.plan_quality).toBe(80);
    expect(verdict.plan_quality_range).toEqual([40, 80]);
    expect(judgeAsk.system).toContain("**80** из 100, разброс от 40 до 80");
  });

  it("участник с невалидным ответом отсутствует, заседание продолжается", async () => {
    const { deps, events } = setup({
      scores: {},
      debater: (req) => (nameOf(req) === "Свидетелев" ? "{ сломанный json" : speech(50)),
    });
    const { verdict } = await runTrial({ caseFile, participants: roster, settings }, deps);
    const absent = of(events, "absent");
    expect(absent.map((a) => [a.round, a.participantId])).toEqual([
      [1, "witness"],
      [2, "witness"],
    ]);
    expect(absent[0].reason).toMatch(/не прошёл проверку/);
    expect(verdict.success_score).toBe(50);
    expect(Object.keys(of(events, "round_summary")[0].scores)).not.toContain("witness");
  });

  it("если судья не справился, вердикт выносит секретарь", async () => {
    const { deps, events, models } = setup({
      scores: { Прокуроров: [50], Адвокатова: [50], Свидетелев: [50], "Присяжный Один": [50], "Присяжная Два": [50] },
      judge: () => {
        throw new ProviderError("Модель не найдена", false);
      },
    });
    await runTrial({ caseFile, participants: roster, settings }, deps);
    expect(of(events, "verdict")).toHaveLength(1);
    expect(models.secretary.calls.some((c) => schemaTitle(c) === "judge_verdict")).toBe(true);
  });

  it("если никто не явился, заседание падает с понятной ошибкой", async () => {
    const { deps } = setup({
      scores: {},
      debater: () => {
        throw new ProviderError("Неверный API-ключ", false);
      },
    });
    await expect(runTrial({ caseFile, participants: roster, settings }, deps)).rejects.toBeInstanceOf(TrialError);
  });

  it("при молчании секретаря решение принимает код", async () => {
    const s = setup({ scores: { Прокуроров: [50], Адвокатова: [52], Свидетелев: [51], "Присяжный Один": [49], "Присяжная Два": [50] } });
    s.models.secretary.calls.length = 0;
    const silent = mockModel("secretary", () => {
      throw new ProviderError("Сервер недоступен", false);
    });
    const deps = { ...s.deps, getModel: (r: { modelId: string }) => (r.modelId === "secretary" ? silent : s.deps.getModel(r)) };
    const { rounds } = await runTrial({ caseFile, participants: roster, settings }, deps);
    expect(rounds).toBe(2);
    expect(of(s.events, "secretary_decision").map((d) => d.reason)).toEqual([
      "Минимальное число заседаний ещё не проведено.",
      "Мнения сторон сблизились: разброс оценок ниже порога.",
    ]);
  });
});

describe("промпты", () => {
  it("все шаблоны загружаются с подстановками, которые передаёт код", () => {
    expect(() => loadPrompt("secretary-prepare")).not.toThrow();
    expect(loadPrompt("secretary-decision", { round: 2, std: 12, threshold: 10, outcome_rules: "R", max_facts: 10 })).toContain("№2");
    expect(loadPrompt("round-blind", { round: 1 })).toContain("№1");
    expect(loadPrompt("round-debate", { round: 2, facts: "F", own_position: "A", others: "B" })).toContain("B");
    expect(loadPrompt("judge", { success_score: 61, score_min: 40, score_max: 80, std: 12, plan_quality: "**70** из 100", revision_rules: "" })).toContain("**61**");
    expect(loadPrompt("judge-revision", { count: 3 })).toContain("**каждый** из 3");
    expect(loadPrompt("participant", { roster: "R", case: "C" })).toContain("C");
    expect(loadPrompt("participant-persona", { role_title: "Прокурор", name: "Н", specialization: "—", character: "—", role_instructions: "I" })).toContain("**Имя:** Н");
    expect(() => loadPrompt("secretary-revision")).not.toThrow();
    expect(
      loadPrompt("revision", { version: 2, previous_date: "1 мая", previous_verdict: "V", recommendations: "R", changes: "C", positions: "P" }),
    ).toContain("версия 2");
    for (const r of ["prosecutor", "defense", "witness", "juror"]) expect(loadPrompt(`role-${r}`)).not.toBe("");
  });

  it("сообщает о непереданной подстановке", () => {
    expect(() => loadPrompt("judge", {})).toThrow(/success_score/);
  });
});

describe("картинки для моделей со зрением", () => {
  it("передаются участникам и судье; если модель их не принимает — повтор без них", async () => {
    const image = { kind: "image" as const, mimeType: "image/jpeg", data: "AAAA" };
    const { deps, models } = setup({
      scores: {},
      debater: (req) => {
        // Модель без зрения: 400 на запрос с картинкой
        if (req.attachments?.length && nameOf(req) === "Свидетелев") throw new ProviderError("image input not supported", false, 400);
        return speech(50);
      },
    });
    const { verdict } = await runTrial({ caseFile, participants: roster, settings, attachments: [image] }, deps);
    expect(verdict.success_score).toBe(50);
    const witnessCalls = models.debater.calls.filter((c) => nameOf(c) === "Свидетелев");
    expect(witnessCalls.some((c) => c.attachments?.length)).toBe(true);
    expect(witnessCalls.some((c) => !c.attachments?.length)).toBe(true);
    expect(models.judge.calls[0].attachments).toEqual([image]);
  });
});

describe("дополнительный контекст (апелляция)", () => {
  it("виден участникам и судье", async () => {
    const { deps, models } = setup({ scores: { Прокуроров: [50], Адвокатова: [50], Свидетелев: [50], "Присяжный Один": [50], "Присяжная Два": [50] } });
    await runTrial({ caseFile, participants: roster, settings, context: "# Апелляция: студенты 18–24" }, deps);
    expect(models.debater.calls.every((c) => c.system.includes("# Апелляция: студенты 18–24"))).toBe(true);
    expect(models.judge.calls[0].messages[0].content).toContain("# Апелляция: студенты 18–24");
  });
});

describe("кэширование промптов", () => {
  it("системный промпт у всех выступающих одинаковый и содержит материалы, роль — в сообщении", async () => {
    const { deps, models } = setup({ scores: { Прокуроров: [50], Адвокатова: [50], Свидетелев: [50], "Присяжный Один": [50], "Присяжная Два": [50] } });
    await runTrial({ caseFile, participants: roster, settings }, deps);
    const calls = models.debater.calls;
    expect(new Set(calls.map((c) => c.system)).size).toBe(1);
    expect(calls[0].system).toContain("Лучший кофе в городе");
    expect(calls[0].system).not.toContain("**Имя:**");
    expect(calls.every((c) => c.cacheSystem)).toBe(true);
    expect(new Set(calls.map(nameOf)).size).toBe(5);
  });

  it("в первом заседании один участник на модели отвечает первым, остальные — после него", async () => {
    let firstDone = false;
    const startedBeforeFirst: string[] = [];
    const { deps } = setup({
      scores: {},
      debater: async (req, i) => {
        if (roundOf(req) === 1) {
          if (i === 0) {
            await new Promise((r) => setTimeout(r, 20));
            firstDone = true;
          } else if (!firstDone) startedBeforeFirst.push(nameOf(req));
        }
        return speech(50);
      },
    });
    await runTrial({ caseFile, participants: roster, settings }, deps);
    expect(startedBeforeFirst).toEqual([]);
  });

  it("секретарь видит тезисы прошлых заседаний, чтобы отличать новые доводы", async () => {
    const { deps, models } = setup({ scores: { Прокуроров: [10, 20], Адвокатова: [90, 80], Свидетелев: [50], "Присяжный Один": [50], "Присяжная Два": [50] }, newArguments: [true, false] });
    await runTrial({ caseFile, participants: roster, settings }, deps);
    const decisions = models.secretary.calls.filter((c) => schemaTitle(c) === "secretary_decision");
    expect(decisions[0].messages[0].content).not.toContain("Тезисы прошлых заседаний");
    expect(decisions[1].messages[0].content).toMatch(/Тезисы прошлых заседаний[\s\S]*Прокуроров: 10/);
  });
});

describe("повторное рассмотрение", () => {
  const prior = ["Поставить банку к протеиновым коктейлям", "Убрать скидку", "Считать повторные покупки"];
  const revision = { version: 2, previousRecommendations: prior };
  const withPrior = (items: object[]) => JSON.stringify({ ...JSON.parse(judgeAnswer), prior_recommendations: items });
  const scores = { Прокуроров: [50], Адвокатова: [50], Свидетелев: [50], "Присяжный Один": [50], "Присяжная Два": [50] };

  it("судья отчитывается по каждому прошлому совету; ответ без пункта отклоняется и запрашивается снова", async () => {
    const full = [
      { index: 2, position: "done", explanation: "Скидку убрали — верно." },
      { index: 1, position: "revised", explanation: "В прошлый раз суд советовал полку у коктейлей; теперь — холодильник, потому что…" },
      { index: 3, position: "kept", explanation: "Пока не считают." },
    ];
    const { deps, events, models } = setup({
      scores,
      judge: (_req, i) => (i === 0 ? withPrior(full.slice(0, 2)) : withPrior(full)),
    });
    const { verdict } = await runTrial({ caseFile, participants: roster, settings, revision }, deps);

    expect(models.judge.calls).toHaveLength(2);
    expect(models.judge.calls[1].messages.at(-1)!.content).toMatch(/index от 1 до 3/);
    expect(models.judge.calls[0].system).toContain("**каждый** из 3");
    expect(verdict.prior_recommendations).toEqual([
      { change: prior[0], position: "revised", explanation: full[1].explanation },
      { change: prior[1], position: "done", explanation: full[0].explanation },
      { change: prior[2], position: "kept", explanation: full[2].explanation },
    ]);
    expect(of(events, "session_open")[0].text).toMatch(/Повторно.*версия 2/);
  });

  it("без повторного рассмотрения судья о прошлых советах не спрашивается", async () => {
    const { deps, models } = setup({ scores });
    const { verdict } = await runTrial({ caseFile, participants: roster, settings }, deps);
    expect(models.judge.calls[0].system).not.toContain("prior_recommendations");
    expect(verdict.prior_recommendations).toBeUndefined();
  });
});
