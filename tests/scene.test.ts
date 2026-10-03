import { describe, expect, it } from "vitest";
import { SceneClock } from "@/components/courtroom/clock";
import { Director, type Stage } from "@/components/courtroom/director";
import { bubbleText, readingMs, sceneStateAt, stepsDuration, stepsFor, newContext, type SceneState, type Step } from "@/lib/scene/timeline";
import { defendantKind, seatOf, speakingSpot, SPOTS } from "@/lib/scene/layout";
import type { StoredEvent, TrialEvent } from "@/lib/trial/events";
import type { Participant, ParticipantResponse, Verdict } from "@/lib/trial/schemas";

const P = (id: string, role: Participant["role"], name: string): Participant => ({
  id,
  role,
  name,
  specialization: "",
  character: "",
  model: null,
});
const roster = [
  P("secretary", "secretary", "Секретарь"),
  P("judge", "judge", "Судья"),
  P("prosecutor", "prosecutor", "Прокуроров"),
  P("defense", "defense", "Адвокатова"),
  P("witness", "witness", "Свидетелев"),
  P("juror-1", "juror", "Присяжный"),
  P("juror-2", "juror", "Присяжная"),
];

const resp = (score: number, extra: Partial<ParticipantResponse> = {}): ParticipantResponse => ({
  score,
  stance: "Тезис",
  speech: "Речь",
  strengths: [],
  weaknesses: [],
  audience_guess: [],
  emotion: "confident",
  intensity: 2,
  ...extra,
});

const verdict: Verdict = {
  success_score: 64,
  score_range: [50, 80],
  confidence: "medium",
  outcome: "conditional",
  verdict_speech: "Именем маркетинга!",
  verdict: "Нужны правки.",
  audiences: [],
  improvements: [],
  risks: [],
  dissent: [],
};

const trial: TrialEvent[] = [
  { type: "session_open", text: "Встать, суд идёт!" },
  { type: "round_start", round: 1, text: "Заседание №1" },
  { type: "speech", round: 1, participantId: "prosecutor", response: resp(30, { emotion: "angry", intensity: 3 }) },
  { type: "absent", round: 1, participantId: "juror-2", reason: "timeout" },
  {
    type: "round_summary",
    round: 1,
    scores: { prosecutor: 30 },
    aggregate: { median: 30, mean: 30, std: 0, min: 30, max: 30 },
    defendantMood: "sweating",
    tokens: { input: 0, output: 0 },
  },
  { type: "secretary_decision", round: 1, decision: "continue", newArguments: true, reason: "Продолжаем" },
  { type: "round_start", round: 2, text: "Заседание №2" },
  {
    type: "speech",
    round: 2,
    participantId: "defense",
    response: resp(70, { reacts_to: "Прокуроров", responses_to_others: [{ participant: "Прокуроров", agree: false, argument: "Нет" }] }),
  },
  { type: "judge_start", text: "Суд удаляется" },
  { type: "verdict", verdict },
  { type: "trial_end", status: "done" },
];
const stored: StoredEvent[] = trial.map((event, i) => ({ seq: i + 1, event, at: 0 }));

describe("режиссёр: шаги сцены", () => {
  it("выступление: выход к трибуне, облачко с оценкой, реакция адресата, возврат", () => {
    const ctx = newContext(roster);
    stepsFor(trial[2], ctx); // прокурор выступил с 30
    const steps = stepsFor({ type: "speech", round: 2, participantId: "prosecutor", response: resp(45, { reacts_to: "Адвокатова" }) }, ctx);
    expect(steps.map((s) => s.kind)).toEqual(["absent", "walk", "parallel", "walk"]);
    const par = steps[2] as Extract<Step, { kind: "parallel" }>;
    expect(par.steps[0]).toMatchObject({ kind: "say", who: "prosecutor", score: 45, delta: 15 });
    expect(par.steps[1]).toMatchObject({ kind: "emotion", who: "defense", emotion: "surprised" });
  });

  it("опровергнутая сторона злится, свидетеля вызывают отдельно", () => {
    const steps = stepsFor(trial[7], newContext(roster));
    const par = steps.find((s) => s.kind === "parallel") as Extract<Step, { kind: "parallel" }>;
    expect(par.steps[1]).toMatchObject({ who: "prosecutor", emotion: "angry", intensity: 3 });

    const witness = stepsFor({ type: "speech", round: 1, participantId: "witness", response: resp(50) }, newContext(roster));
    expect(witness[1]).toMatchObject({ kind: "say", who: "secretary", text: "Суд вызывает свидетеля!" });
    expect(speakingSpot(roster[4])).toBe(SPOTS.witnessStand);
    expect(seatOf(roster[4], roster)).toBe(SPOTS.gallery);
  });

  it("открытие и вердикт: молоток, барабанная дробь, речь судьи, анимация приговора", () => {
    expect(stepsFor(trial[0], newContext(roster)).map((s) => s.kind)).toEqual(["say", "judgeEnter", "gavel", "say"]);
    const v = stepsFor(trial[9], newContext(roster));
    expect(v.map((s) => s.kind)).toEqual(["judgeReturn", "drumroll", "gavel", "say", "verdict"]);
    expect(v[3]).toMatchObject({ who: "judge", text: "Именем маркетинга!" });
  });

  it("длительности: облачко успевают прочитать, длинный текст обрезается", () => {
    expect(readingMs("коротко")).toBe(2500);
    expect(readingMs("x".repeat(1000))).toBe(7000);
    expect(bubbleText("а ".repeat(200)).length).toBeLessThanOrEqual(170);
    expect(stepsDuration([{ kind: "parallel", steps: [{ kind: "pause", ms: 100 }, { kind: "pause", ms: 300 }] }, { kind: "pause", ms: 50 }])).toBe(350);
  });

  it("тип подсудимого по типу материала", () => {
    expect(defendantKind("video_ad")).toBe("film");
    expect(defendantKind("image_ad")).toBe("frame");
    expect(defendantKind("media_plan")).toBe("folder");
    expect(defendantKind("text_ad")).toBe("scroll");
  });
});

describe("итоговое состояние сцены", () => {
  it("эмоции, отсутствующие, настроение подсудимого и вердикт", () => {
    const s = sceneStateAt(stored, roster);
    expect(s).toMatchObject({ judgePresent: true, mood: "sweating", round: 2, absent: ["juror-2"], verdict });
    expect(s.emotions.prosecutor).toEqual({ emotion: "angry", intensity: 3 });
    expect(s.scores).toEqual({ prosecutor: 30, defense: 70 });
  });

  it("пока судья совещается, его нет в зале", () => {
    expect(sceneStateAt(stored.slice(0, 9), roster).judgePresent).toBe(false);
  });
});

/** Сцена-заглушка: шаги «длятся» по часам SceneClock, которые тест двигает вручную. */
function fakeStage() {
  const clock = new SceneClock();
  const log: string[] = [];
  const stage: Stage & { applied: SceneState[] } = {
    applied: [],
    async run(step) {
      log.push(step.kind);
      if (step.kind === "parallel") await Promise.all(step.steps.map((s) => stage.run(s)));
      else if ("ms" in step) await clock.wait(step.ms);
    },
    applyState(state) {
      stage.applied.push(state);
    },
    reset() {
      clock.flush();
      log.push("reset");
    },
    setFastForward(on) {
      clock.fastForward = on;
      if (on) clock.flush();
    },
  };
  return { stage, clock, log };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

async function runClock(clock: SceneClock, ms: number) {
  for (let t = 0; t < ms; t += 100) {
    clock.advance(100);
    await flushMicrotasks();
  }
}

describe("Director", () => {
  it("проигрывает события по очереди и открывает их протоколу по мере показа", async () => {
    const { stage, clock } = fakeStage();
    const revealed: number[] = [];
    const played: number[] = [];
    const d = new Director(stage, roster, { onReveal: (s) => revealed.push(s), onPlayed: (s) => played.push(s) });
    d.push(stored.slice(0, 3));
    await flushMicrotasks();
    expect(revealed).toEqual([1]);
    await runClock(clock, 60_000);
    expect(revealed).toEqual([1, 2, 3]);
    expect(played).toEqual([1, 2, 3]);
    expect(d.busy).toBe(false);
  });

  it("пропуск: мгновенно догоняет очередь и применяет итоговое состояние", async () => {
    const { stage } = fakeStage();
    const played: number[] = [];
    const d = new Director(stage, roster, { onReveal: () => {}, onPlayed: (s) => played.push(s) });
    d.push(stored);
    await flushMicrotasks();
    d.skip();
    for (let i = 0; i < 20; i++) await flushMicrotasks();
    expect(played).toEqual(stored.map((e) => e.seq));
    expect(stage.applied.at(-1)?.verdict).toEqual(verdict);
    expect(d.busy).toBe(false);
  });

  it("догоняние при открытии страницы — без анимации; новые события — с анимацией", async () => {
    const { stage, clock, log } = fakeStage();
    const d = new Director(stage, roster, { onReveal: () => {}, onPlayed: () => {} });
    d.push(stored.slice(0, 5), true);
    expect(log).toEqual([]);
    expect(stage.applied).toHaveLength(1);
    d.push(stored.slice(0, 6));
    await flushMicrotasks();
    expect(log).toEqual(["say"]); // решение секретаря анимируется
    await runClock(clock, 10_000);
  });

  it("повторный просмотр начинает с начала", async () => {
    const { stage, clock, log } = fakeStage();
    const revealed: number[] = [];
    const d = new Director(stage, roster, { onReveal: (s) => revealed.push(s), onPlayed: () => {} });
    d.push(stored.slice(0, 2), true);
    d.replay();
    await flushMicrotasks();
    expect(log[0]).toBe("reset");
    await runClock(clock, 30_000);
    expect(revealed).toEqual([1, 2, 1, 2]);
  });
});

describe("подбор спрайтов по полу", async () => {
  const { guessGender } = await import("@/lib/scene/gender");
  const { assetKey } = await import("@/lib/scene/layout");

  it("угадывает пол по русскому имени", () => {
    expect(guessGender("Ольга Покупаева")).toBe("female");
    expect(guessGender("Антон Строгий")).toBe("male");
    expect(guessGender("Илья Копирайтов")).toBe("male");
    expect(guessGender("Мария Брендова")).toBe("female");
    expect(guessGender("Никита")).toBe("male");
    expect(guessGender("Глеб Конверсин")).toBe("male");
    expect(guessGender("")).toBeNull();
  });

  it("присяжным достаются спрайты своего пола, свидетельнице — женский, если есть", () => {
    const jurors = ["Мария Брендова", "Глеб Конверсин", "Анна Цифрова", "Илья Копирайтов"].map((name, i) => ({
      ...P(`juror-${i + 1}`, "juror", name),
    }));
    const keys = jurors.map((j) => assetKey(j, jurors));
    expect(keys).toEqual(["juror-2", "juror-1", "juror-3", "juror-4"]);
    const witness = P("witness", "witness", "Ольга Покупаева");
    expect(assetKey(witness, [witness])).toBe("witness");
    expect(assetKey(witness, [witness], new Set(["witness-female"]))).toBe("witness-female");
  });
});
