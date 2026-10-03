"use client";

import { useState } from "react";
import type { CaseView } from "@/lib/store/cases";
import type { Verdict } from "@/lib/trial/schemas";
import { compareImprovements, tokensLine } from "@/lib/trial/labels";
import { CONFIDENCE_TITLES, EFFORT_TITLES, LEVEL_TITLES, OUTCOME_STYLES, OUTCOME_TITLES } from "./labels";
import { PriorRecommendations } from "./revision";

const RANK = { high: 3, medium: 2, low: 1 } as const;
type SortKey = "urgency" | "effort";

/** Отчёт по вердикту: оценка, аудитории, улучшения, риски, особые мнения. */
export function Report({ caseView }: { caseView: CaseView }) {
  const v = caseView.verdict!;
  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-6 rounded-2xl border border-brass-500/40 bg-wood-900 p-6 md:grid-cols-[260px_1fr]">
        <ScoreDial verdict={v} />
        <div className="flex flex-col gap-4">
          <span className={`self-start rounded-full border px-3 py-1 text-sm font-medium ${OUTCOME_STYLES[v.outcome]}`}>
            {OUTCOME_TITLES[v.outcome]}
          </span>
          <blockquote className="border-l-4 border-brass-500 pl-4 font-display text-lg italic">{v.verdict_speech}</blockquote>
          <p className="text-parchment/90">{v.verdict}</p>
          <p className="text-xs text-parchment/40">
            Заседаний: {caseView.rounds} · токенов: {tokensLine(caseView)} ·
            оценка — экспертное мнение суда, а не статистический прогноз
          </p>
        </div>
      </section>

      <PriorRecommendations caseView={caseView} />

      {v.audiences.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-xl font-bold">Целевые аудитории</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...v.audiences]
              .sort((a, b) => b.fit - a.fit)
              .map((a, i) => (
                <div key={i} className="rounded-xl border border-wood-700 bg-wood-900 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{a.segment}</span>
                    <span className="font-display text-xl font-bold text-brass-300">{a.fit}%</span>
                  </div>
                  <div className="text-sm text-parchment/60">
                    {a.age_from}–{a.age_to} лет
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-wood-700">
                    <div className="h-full rounded-full bg-brass-500" style={{ width: `${Math.max(0, Math.min(100, a.fit))}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-parchment/80">{a.why}</p>
                </div>
              ))}
          </div>
        </section>
      )}

      {v.improvements.length > 0 && <Improvements items={v.improvements} />}

      <div className="grid gap-6 md:grid-cols-2">
        {v.risks.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-xl font-bold">Риски</h2>
            <ul className="flex flex-col gap-2">
              {v.risks.map((r, i) => (
                <li key={i} className="rounded-lg border border-verdict-red/30 bg-verdict-red/5 px-3 py-2 text-sm">
                  ⚠️ {r}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2 className="mb-3 font-display text-xl font-bold">Особые мнения</h2>
          {v.dissent.length ? (
            <ul className="flex flex-col gap-2">
              {v.dissent.map((d, i) => (
                <li key={i} className="rounded-lg border border-wood-700 bg-wood-900 px-3 py-2 text-sm">
                  ✋ {d}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-parchment/60">Суд был единодушен.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function ScoreDial({ verdict: v }: { verdict: Verdict }) {
  const [lo, hi] = v.score_range;
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center">
      <div className="text-sm uppercase tracking-widest text-parchment/50">Вероятность успеха</div>
      <div className="font-display text-7xl font-bold text-brass-400">{v.success_score}%</div>
      {/* Шкала 0–100: полоса — разброс мнений суда, метка — итоговая оценка */}
      <div className="relative mt-1 h-2 w-full rounded-full bg-wood-700" aria-label={`Разброс оценок ${lo}–${hi}`}>
        <div className="absolute h-full rounded-full bg-brass-500/40" style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }} />
        <div className="absolute -top-1 h-4 w-1 rounded bg-brass-300" style={{ left: `calc(${v.success_score}% - 2px)` }} />
      </div>
      <div className="text-sm text-parchment/70">
        разброс мнений {lo}–{hi} · уверенность {CONFIDENCE_TITLES[v.confidence]}
      </div>
      {v.plan_quality !== undefined && (
        <div className="mt-2 border-t border-wood-700 pt-2 text-sm text-parchment/70" title="Насколько продуман сам план — отдельно от рыночных рисков">
          Качество плана <b className="font-display text-lg text-brass-300">{v.plan_quality}%</b>
          <br />
          разброс {v.plan_quality_range![0]}–{v.plan_quality_range![1]}
        </div>
      )}
    </div>
  );
}

function Improvements({ items }: { items: Verdict["improvements"] }) {
  const [sort, setSort] = useState<SortKey>("urgency");
  // По срочности — сначала блокирующие запуск, затем самое сильное; по трудозатратам — сначала самое дешёвое.
  const sorted = [...items].sort((a, b) =>
    sort === "urgency" ? compareImprovements(a, b) : RANK[a.effort] - RANK[b.effort] || RANK[b.impact] - RANK[a.impact],
  );
  const blocking = items.filter((i) => i.blocking === true).length;
  const graded = items.some((i) => i.blocking !== undefined);
  const th = (key: SortKey, label: string) => (
    <th className="w-32 px-3 py-2 text-left font-normal">
      <button className={`hover:text-brass-300 ${sort === key ? "text-brass-300" : ""}`} onClick={() => setSort(key)}>
        {label} {sort === key ? "↓" : ""}
      </button>
    </th>
  );
  const badge = (level: keyof typeof RANK, good: boolean) =>
    `rounded px-2 py-0.5 text-xs ${
      level === "medium" ? "bg-brass-500/20 text-brass-300" : (level === "high") === good ? "bg-verdict-green/20 text-verdict-green" : "bg-verdict-red/20 text-verdict-red"
    }`;

  return (
    <section>
      <h2 className="mb-1 font-display text-xl font-bold">Что улучшить</h2>
      {graded && (
        <p className="mb-3 text-sm text-parchment/60">
          {blocking
            ? `До запуска: ${blocking} из ${items.length}. Остальное можно доработать по ходу кампании.`
            : "Блокирующих запуск правок нет: материал можно запускать, остальное — доработки по ходу."}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-wood-700">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-wood-800 text-xs text-parchment/60">
            <tr>
              <th className="px-3 py-2 text-left font-normal">Изменение</th>
              {th("urgency", "Влияние")}
              {th("effort", "Трудозатраты")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((imp, i) => (
              <tr key={i} className="border-t border-wood-700 align-top">
                <td className="px-3 py-2">
                  {imp.blocking && (
                    <span className="mb-1 inline-block rounded bg-verdict-red/20 px-2 py-0.5 text-xs text-verdict-red">блокирует запуск</span>
                  )}
                  <div className="font-medium">{imp.change}</div>
                  <div className="text-parchment/60">{imp.why}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={badge(imp.impact, true)}>{LEVEL_TITLES[imp.impact]}</span>
                </td>
                <td className="px-3 py-2">
                  <span className={badge(imp.effort, false)}>{EFFORT_TITLES[imp.effort]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
