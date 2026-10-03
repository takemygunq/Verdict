import type { ImplementationStatus, PriorPosition, Verdict } from "./schemas";

/** Названия приговоров для серверных текстов (экспорт, контекст апелляции). */
export const OUTCOME_TITLES_PLAIN: Record<Verdict["outcome"], string> = {
  acquitted: "оправдан",
  conditional: "условно, с доработками",
  guilty: "виновен в скучности",
};

export const CONFIDENCE_PLAIN: Record<Verdict["confidence"], string> = { low: "низкая", medium: "средняя", high: "высокая" };
export const LEVEL_PLAIN = { high: "высокое", medium: "среднее", low: "низкое" } as const;

/** Срочность совета. `blocking` нет у вердиктов, вынесенных до разделения советов по срочности. */
export const urgencyPlain = (blocking: boolean | undefined) =>
  blocking === undefined ? "—" : blocking ? "блокирует запуск" : "по ходу";

const RANK = { high: 3, medium: 2, low: 1 } as const;

/** Порядок советов: сначала блокирующие запуск, затем по влиянию, затем самые дешёвые. */
export function compareImprovements(a: Verdict["improvements"][number], b: Verdict["improvements"][number]): number {
  return (
    Number(b.blocking === true) - Number(a.blocking === true) ||
    RANK[b.impact] - RANK[a.impact] ||
    RANK[a.effort] - RANK[b.effort]
  );
}

/** Повторное рассмотрение: что секретарь установил о прошлом совете */
export const IMPLEMENTATION_PLAIN: Record<ImplementationStatus, string> = {
  implemented: "выполнен",
  partial: "частично",
  not_implemented: "не выполнен",
};

/** Повторное рассмотрение: позиция суда по прошлому совету */
export const PRIOR_POSITION_PLAIN: Record<PriorPosition, string> = {
  done: "выполнен, верно",
  kept: "остаётся в силе",
  revised: "суд изменил совет",
  withdrawn: "суд отменил совет",
};

/** Токены дела одной строкой: «12 345 (из кэша 8 000)» */
export function tokensLine(c: { inputTokens: number; outputTokens: number; cachedTokens: number }): string {
  const total = (c.inputTokens + c.outputTokens).toLocaleString("ru-RU");
  return c.cachedTokens ? `${total} (из кэша ${c.cachedTokens.toLocaleString("ru-RU")})` : total;
}
