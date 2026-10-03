import type { ParticipantResponse, Verdict } from "./schemas";

export type DefendantMood = "ecstatic" | "happy" | "calm" | "nervous" | "sweating";

export interface Aggregate {
  /** Взвешенная медиана последних оценок */
  median: number;
  mean: number;
  /** Стандартное отклонение — мера разброса мнений */
  std: number;
  min: number;
  max: number;
}

/** Всё, что происходит на заседании. Пишется в БД и транслируется в UI через SSE. */
export type TrialEvent =
  | { type: "session_open"; text: string }
  | { type: "round_start"; round: number; text: string }
  | { type: "speech"; round: number; participantId: string; response: ParticipantResponse }
  | { type: "absent"; round: number; participantId: string; reason: string }
  | {
      type: "round_summary";
      round: number;
      /** Последняя известная оценка каждого участника */
      scores: Record<string, number>;
      aggregate: Aggregate;
      defendantMood: DefendantMood;
      /** cached — сколько входных токенов прочитано из кэша провайдера */
      tokens: { input: number; output: number; cached?: number };
    }
  | { type: "secretary_decision"; round: number; decision: "continue" | "close"; newArguments: boolean; reason: string }
  | { type: "judge_start"; text: string }
  | { type: "verdict"; verdict: Verdict }
  | { type: "error"; message: string }
  | { type: "trial_end"; status: "done" | "failed" };

export interface StoredEvent {
  seq: number;
  event: TrialEvent;
  at: number;
}
