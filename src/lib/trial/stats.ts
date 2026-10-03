import type { Aggregate, DefendantMood } from "./events";

export interface WeightedScore {
  score: number;
  weight: number;
}

/** Взвешенная медиана: наименьшая оценка, на которой накопленный вес достигает половины суммы. */
export function weightedMedian(items: WeightedScore[]): number {
  const valid = items.filter((i) => i.weight > 0);
  if (!valid.length) throw new Error("Нет оценок для агрегации");
  const sorted = [...valid].sort((a, b) => a.score - b.score);
  const total = sorted.reduce((s, i) => s + i.weight, 0);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i].weight;
    // Ровно половина — середина между соседями, как у обычной медианы чётной длины
    if (Math.abs(acc - total / 2) < 1e-9 && i + 1 < sorted.length) {
      return (sorted[i].score + sorted[i + 1].score) / 2;
    }
    if (acc > total / 2) return sorted[i].score;
  }
  return sorted[sorted.length - 1].score;
}

export function aggregate(items: WeightedScore[]): Aggregate {
  const scores = items.map((i) => i.score);
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
  const std = Math.sqrt(scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length);
  return {
    median: round1(weightedMedian(items)),
    mean: round1(mean),
    std: round1(std),
    min: Math.min(...scores),
    max: Math.max(...scores),
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Реакция подсудимого: по изменению средней оценки, а в первом заседании — по её уровню. */
export function defendantMood(mean: number, prevMean: number | null): DefendantMood {
  if (prevMean !== null) {
    const delta = mean - prevMean;
    if (delta >= 10) return "ecstatic";
    if (delta >= 3) return "happy";
    if (delta <= -10) return "sweating";
    if (delta <= -3) return "nervous";
  }
  if (mean >= 75) return "happy";
  if (mean < 35) return "sweating";
  if (mean < 50) return "nervous";
  return "calm";
}

export interface StopInput {
  round: number;
  minRounds: number;
  maxRounds: number;
  std: number;
  spreadThreshold: number;
  /** null — неизвестно: секретарь не ответил или это первое заседание (там все доводы новые по определению) */
  newArguments: boolean | null;
  /** Разброс был ниже порога и в прошлом заседании */
  consensusBefore?: boolean;
}

export interface StopDecision {
  stop: boolean;
  /** Почему код принял такое решение (дополняет обоснование секретаря) */
  rule: "min_rounds" | "max_rounds" | "consensus" | "no_new_arguments" | "new_arguments" | "continue";
}

/** Правила остановки слушаний из спецификации. Код — последняя инстанция, секретарь даёт обоснование. */
export function decideStop(i: StopInput): StopDecision {
  if (i.round < i.minRounds) return { stop: false, rule: "min_rounds" };
  if (i.round >= i.maxRounds) return { stop: true, rule: "max_rounds" };
  if (i.newArguments === false) return { stop: true, rule: "no_new_arguments" };
  // Сближение оценок не повод закрываться, пока звучат новые доводы: их нужно обсудить
  // (но если оценки сошлись второй раз подряд, новые доводы их уже не двигают — закрываемся)
  if (i.std < i.spreadThreshold) {
    return i.newArguments && !i.consensusBefore ? { stop: false, rule: "new_arguments" } : { stop: true, rule: "consensus" };
  }
  return { stop: false, rule: "continue" };
}

/**
 * Уверенность судьи не может быть выше, чем позволяет разброс мнений.
 * Границы фиксированы и не зависят от порога остановки: порог решает, сколько спорить, а не насколько верить итогу.
 */
export const CONFIDENCE_SPREAD = { medium: 10, low: 20 } as const;

export function capConfidence(confidence: "low" | "medium" | "high", std: number): "low" | "medium" | "high" {
  const order = ["low", "medium", "high"] as const;
  const max = std >= CONFIDENCE_SPREAD.low ? "low" : std >= CONFIDENCE_SPREAD.medium ? "medium" : "high";
  return order[Math.min(order.indexOf(confidence), order.indexOf(max))];
}
