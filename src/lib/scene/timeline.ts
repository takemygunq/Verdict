import type { DefendantMood, StoredEvent, TrialEvent } from "../trial/events";
import { isDebater, type Emotion, type Participant, type Verdict } from "../trial/schemas";

/**
 * Режиссёр: переводит события заседания в шаги сцены.
 * Чистые функции без PixiJS — сцена только исполняет шаги.
 * Длительности указаны для скорости 1x.
 */
export type Step =
  | { kind: "say"; who: string; text: string; ms: number; emotion?: Emotion; intensity?: 1 | 2 | 3; score?: number; delta?: number | null }
  | { kind: "walk"; who: string; to: "speak" | "seat"; ms: number }
  | { kind: "emotion"; who: string; emotion: Emotion; intensity: 1 | 2 | 3 }
  | { kind: "banner"; text: string; ms: number }
  | { kind: "judgeEnter"; ms: number }
  | { kind: "judgeLeave"; ms: number }
  | { kind: "judgeReturn"; ms: number }
  | { kind: "gavel"; ms: number }
  | { kind: "mood"; mood: DefendantMood; ms: number }
  | { kind: "absent"; who: string; present: boolean }
  | { kind: "drumroll"; ms: number }
  | { kind: "verdict"; verdict: Verdict; ms: number }
  | { kind: "parallel"; steps: Step[] }
  | { kind: "pause"; ms: number };

export interface DirectorContext {
  participants: Participant[];
  /** Предыдущая оценка участника — для стрелки ▲▼ */
  lastScore: Map<string, number>;
}

export function newContext(participants: Participant[]): DirectorContext {
  return { participants, lastScore: new Map() };
}

/** Длительность облачка: чтобы успеть прочитать. */
export function readingMs(text: string): number {
  return Math.min(7000, Math.max(2500, 1500 + text.length * 45));
}

/** Тезис для облачка: коротко, остальное — в протоколе. */
export function bubbleText(text: string, max = 170): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Как реагирует тот, к кому обратились. */
export function reactionEmotion(
  target: Participant,
  agree: boolean | undefined,
): { emotion: Emotion; intensity: 1 | 2 | 3 } {
  if (agree === true) return { emotion: "confident", intensity: 2 };
  if (agree === false) {
    // Стороны обвинения и защиты злятся, когда их опровергают; эксперты — сомневаются
    return target.role === "prosecutor" || target.role === "defense"
      ? { emotion: "angry", intensity: 3 }
      : { emotion: "skeptical", intensity: 2 };
  }
  return { emotion: "surprised", intensity: 1 };
}

export function stepsFor(event: TrialEvent, ctx: DirectorContext): Step[] {
  const byId = (id: string) => ctx.participants.find((p) => p.id === id);
  const secretary = ctx.participants.find((p) => p.role === "secretary");
  const sec = secretary?.id ?? "secretary";

  switch (event.type) {
    case "session_open":
      return [
        { kind: "say", who: sec, text: "Встать, суд идёт!", ms: 1800, emotion: "confident", intensity: 2 },
        { kind: "judgeEnter", ms: 1600 },
        { kind: "gavel", ms: 700 },
        { kind: "say", who: sec, text: bubbleText(event.text), ms: readingMs(event.text) },
      ];

    case "round_start":
      return [
        { kind: "banner", text: `Заседание №${event.round}`, ms: 1400 },
        { kind: "say", who: sec, text: bubbleText(event.text), ms: Math.min(3500, readingMs(event.text)) },
      ];

    case "speech": {
      const p = byId(event.participantId);
      if (!p) return [];
      const r = event.response;
      const prev = ctx.lastScore.get(p.id);
      ctx.lastScore.set(p.id, r.score);
      const target = r.reacts_to ? ctx.participants.find((x) => x.name === r.reacts_to) : undefined;
      const agree = target ? r.responses_to_others?.find((x) => x.participant === target.name)?.agree : undefined;

      const say: Step = {
        kind: "say",
        who: p.id,
        text: bubbleText(r.stance),
        ms: readingMs(bubbleText(r.stance)),
        emotion: r.emotion,
        intensity: r.intensity,
        score: r.score,
        delta: prev === undefined ? null : r.score - prev,
      };
      // Если в прошлом заседании участник отсутствовал — он вернулся
      const steps: Step[] = [{ kind: "absent", who: p.id, present: true }];
      if (p.role === "witness") {
        steps.push({ kind: "say", who: sec, text: "Суд вызывает свидетеля!", ms: 1500 });
      }
      steps.push({ kind: "walk", who: p.id, to: "speak", ms: 1000 });
      steps.push(
        target && target.id !== p.id
          ? { kind: "parallel", steps: [say, { kind: "emotion", who: target.id, ...reactionEmotion(target, agree) }] }
          : say,
      );
      steps.push({ kind: "walk", who: p.id, to: "seat", ms: 800 });
      return steps;
    }

    case "absent": {
      const p = byId(event.participantId);
      if (!p) return [];
      return [
        { kind: "absent", who: p.id, present: false },
        { kind: "say", who: sec, text: `${p.name} не явился на заседание.`, ms: 1800, emotion: "sad", intensity: 1 },
      ];
    }

    case "round_summary":
      return [{ kind: "mood", mood: event.defendantMood, ms: 1300 }];

    case "secretary_decision":
      return [
        {
          kind: "say",
          who: sec,
          text: bubbleText(`${event.decision === "close" ? "Слушания закрыты." : "Слушания продолжаются."} ${event.reason}`),
          ms: readingMs(event.reason),
          emotion: event.decision === "close" ? "confident" : "thinking",
          intensity: 1,
        },
      ];

    case "judge_start":
      return [
        { kind: "say", who: sec, text: bubbleText(event.text), ms: 2200 },
        { kind: "judgeLeave", ms: 1400 },
        { kind: "pause", ms: 600 },
      ];

    case "verdict": {
      const judge = ctx.participants.find((p) => p.role === "judge")?.id ?? "judge";
      const speech = bubbleText(event.verdict.verdict_speech, 260);
      return [
        { kind: "judgeReturn", ms: 1400 },
        { kind: "drumroll", ms: 2200 },
        { kind: "gavel", ms: 700 },
        { kind: "say", who: judge, text: speech, ms: Math.max(4500, readingMs(speech)), emotion: "confident", intensity: 3 },
        { kind: "verdict", verdict: event.verdict, ms: 6500 },
      ];
    }

    case "error":
      return [{ kind: "say", who: sec, text: bubbleText(`Заседание сорвано: ${event.message}`), ms: 3500, emotion: "sad", intensity: 2 }];

    case "trial_end":
      return [];
  }
}

/** Суммарная длительность шагов (параллельные — по самому длинному). */
export function stepsDuration(steps: Step[]): number {
  return steps.reduce((sum, s) => {
    if (s.kind === "parallel") return sum + Math.max(0, ...s.steps.map((x) => stepsDuration([x])));
    return sum + ("ms" in s ? s.ms : 0);
  }, 0);
}

/* ---------- Итоговое состояние: для «пропустить анимацию» и для открытия завершённого дела ---------- */

export interface SceneState {
  judgePresent: boolean;
  emotions: Record<string, { emotion: Emotion; intensity: 1 | 2 | 3 }>;
  absent: string[];
  scores: Record<string, number>;
  mood: DefendantMood;
  round: number;
  verdict: Verdict | null;
}

export function sceneStateAt(events: StoredEvent[] | TrialEvent[], participants: Participant[]): SceneState {
  const state: SceneState = { judgePresent: false, emotions: {}, absent: [], scores: {}, mood: "calm", round: 0, verdict: null };
  const debaters = new Set(participants.filter(isDebater).map((p) => p.id));
  for (const item of events) {
    const e = "event" in item ? item.event : item;
    switch (e.type) {
      case "session_open":
        state.judgePresent = true;
        break;
      case "round_start":
        state.round = e.round;
        break;
      case "speech":
        if (!debaters.has(e.participantId)) break;
        state.emotions[e.participantId] = { emotion: e.response.emotion, intensity: e.response.intensity };
        state.scores[e.participantId] = e.response.score;
        state.absent = state.absent.filter((id) => id !== e.participantId);
        break;
      case "absent":
        if (!state.absent.includes(e.participantId)) state.absent.push(e.participantId);
        break;
      case "round_summary":
        state.mood = e.defendantMood;
        break;
      case "judge_start":
        state.judgePresent = false;
        break;
      case "verdict":
        state.judgePresent = true;
        state.verdict = e.verdict;
        break;
    }
  }
  return state;
}
