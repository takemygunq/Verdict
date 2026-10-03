"use client";

import Link from "next/link";
import { useState } from "react";
import { btnCls, primaryBtnCls } from "@/components/ui";
import { api, errorText } from "@/lib/client/api";
import type { CaseView } from "@/lib/store/cases";
import type { CaseDetails } from "@/lib/trial/case-details";
import { IMPLEMENTATION_PLAIN, PRIOR_POSITION_PLAIN } from "@/lib/trial/labels";
import type { ImplementationStatus, LinkedRevision, PriorPosition, Verdict } from "@/lib/trial/schemas";

const date = (ms: number) => new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const linkedOf = (c: CaseView): LinkedRevision | null => (c.revision?.status === "linked" ? c.revision : null);

const IMPLEMENTATION_STYLES: Record<ImplementationStatus, string> = {
  implemented: "bg-verdict-green/20 text-verdict-green",
  partial: "bg-brass-500/20 text-brass-300",
  not_implemented: "bg-wood-700 text-parchment/70",
};

const POSITION_STYLES: Record<PriorPosition, string> = {
  done: "bg-verdict-green/20 text-verdict-green",
  kept: "bg-brass-500/20 text-brass-300",
  revised: "bg-verdict-red/15 text-parchment border border-brass-500/60",
  withdrawn: "bg-verdict-red/20 text-verdict-red",
};

const chip = (cls: string, text: string) => <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${cls}`}>{text}</span>;

/**
 * Экран подготовки: похожее дело из архива — предложить повторное рассмотрение,
 * а для уже связанного дела — показать, что суд узнал о прошлой версии.
 */
export function RevisionPrep({ details, onChange }: { details: CaseDetails; onChange: (d: CaseDetails) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = details.case;
  const linked = linkedOf(c);
  const candidate = details.revisionCandidate;

  async function call(method: "POST" | "DELETE", body?: object) {
    setBusy(true);
    setError(null);
    try {
      onChange(await api<CaseDetails>(`/api/cases/${c.id}/revision`, { method, body: body && JSON.stringify(body) }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const failure = error ?? (c.error?.startsWith("Не удалось связать версии") ? c.error : null);

  if (linked) {
    return (
      <section className="rounded-2xl border border-brass-500/40 bg-brass-500/5 p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-xl font-bold">🔁 Повторное рассмотрение · версия {linked.version}</h2>
          <span className="text-sm text-parchment/60">
            прошлая версия:{" "}
            {details.previous ? (
              <Link href={`/cases/${details.previous.id}`} className="underline hover:text-brass-300">
                «{linked.previous.title}»
              </Link>
            ) : (
              <>«{linked.previous.title}» (удалено)</>
            )}
            , {date(linked.previous.createdAt)}
            {linked.previous.score !== null && <>, оценка {linked.previous.score}%</>}
          </span>
        </div>
        <p className="mt-2 text-sm text-parchment/70">
          Суд получит свой прошлый вердикт и должен будет по каждому совету сказать: остаётся ли он в силе, а если суд передумал — почему.
          Состав суда тот же, что и в прошлый раз.
        </p>
        {linked.changes.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-medium">Что изменилось, по сравнению секретаря</div>
            <ul className="mt-1 list-disc pl-5 text-sm text-parchment/80">
              {linked.changes.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {linked.recommendations.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-medium">Прошлые советы суда</div>
            <ul className="mt-2 flex flex-col gap-2">
              {linked.recommendations.map((r, i) => (
                <li key={i} className="flex items-start gap-3 rounded-lg border border-wood-700 bg-wood-900 px-3 py-2 text-sm">
                  <span className="text-parchment/40">{i + 1}.</span>
                  <span className="flex-1">
                    {r.change}
                    {r.evidence && <span className="block text-xs text-parchment/50">{r.evidence}</span>}
                  </span>
                  {r.status ? chip(IMPLEMENTATION_STYLES[r.status], IMPLEMENTATION_PLAIN[r.status]) : chip("bg-wood-700 text-parchment/50", "не сверено")}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className={btnCls} disabled={busy} onClick={() => void call("DELETE")}>
            Это не новая версия — рассматривать как отдельное дело
          </button>
          {failure && <span className="text-sm text-verdict-red">{failure}</span>}
        </div>
      </section>
    );
  }

  if (!candidate) return failure ? <p className="text-sm text-verdict-red">{failure}</p> : null;

  return (
    <section className="rounded-2xl border border-brass-500/60 bg-brass-500/10 p-5">
      <h2 className="font-display text-xl font-bold">Похоже, это новая версия уже рассмотренного дела</h2>
      <p className="mt-1 text-sm text-parchment/80">
        В архиве есть дело{" "}
        <Link href={`/cases/${candidate.id}`} className="underline hover:text-brass-300" target="_blank">
          «{candidate.title}»
        </Link>{" "}
        от {date(candidate.createdAt)}
        {candidate.score !== null && <> с оценкой {candidate.score}%</>}. Материалы совпадают на {Math.round(candidate.similarity * 100)}%.
      </p>
      <p className="mt-2 text-sm text-parchment/70">
        При повторном рассмотрении суд получит свой прошлый вердикт и будет обязан либо придерживаться прошлых советов, либо прямо
        сказать: «в прошлый раз мы советовали X, теперь меняем мнение, потому что Y». Состав суда будет тот же.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className={primaryBtnCls} disabled={busy} onClick={() => void call("POST", { previousId: candidate.id })}>
          🔁 Да, повторное рассмотрение
        </button>
        <button className={btnCls} disabled={busy} onClick={() => void call("DELETE")}>
          Нет, это другое дело
        </button>
        {failure && <span className="text-sm text-verdict-red">{failure}</span>}
      </div>
    </section>
  );
}

/** Шапка заседания и отчёта: это повторное рассмотрение, ссылка на прошлую версию и более новые версии. */
export function RevisionBanner({ details }: { details: CaseDetails }) {
  const linked = linkedOf(details.case);
  const newer = details.newerVersions;
  if (!linked && !newer.length) return null;
  const v = details.case.verdict;
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-brass-500/40 bg-brass-500/10 px-4 py-3 text-sm">
      {linked && (
        <div>
          🔁 <b>Повторное рассмотрение</b>, версия {linked.version}. Прошлая версия:{" "}
          {details.previous ? (
            <Link href={`/cases/${details.previous.id}`} className="underline hover:text-brass-300">
              «{linked.previous.title}»
            </Link>
          ) : (
            <>«{linked.previous.title}» (удалено)</>
          )}
          {linked.previous.score !== null && (
            <span className="text-parchment/70">
              {" "}
              — {linked.previous.score}%{v && <> → <b className="text-brass-300">{v.success_score}%</b></>}
            </span>
          )}
          {linked.previous.planQuality != null && v?.plan_quality !== undefined && (
            <span className="text-parchment/70">
              {" "}
              · качество плана {linked.previous.planQuality}% → <b className="text-brass-300">{v.plan_quality}%</b>
            </span>
          )}
        </div>
      )}
      {newer.map((n) => (
        <div key={n.id}>
          📝 Есть новая версия:{" "}
          <Link href={`/cases/${n.id}`} className="underline hover:text-brass-300">
            «{n.title}»
          </Link>
          {n.score !== null && <span className="text-parchment/70"> — {n.score}%</span>}
        </div>
      ))}
    </div>
  );
}

/** Раздел отчёта: что суд думает о своих прошлых советах. */
export function PriorRecommendations({ caseView }: { caseView: CaseView }) {
  const linked = linkedOf(caseView);
  const v: Verdict | null = caseView.verdict;
  if (!linked || !v || !linked.recommendations.length) return null;
  const review = new Map((v.prior_recommendations ?? []).map((r) => [r.change, r]));
  const changedMind = (v.prior_recommendations ?? []).filter((r) => r.position === "revised" || r.position === "withdrawn").length;
  return (
    <section>
      <h2 className="font-display text-xl font-bold">Прошлые советы суда</h2>
      <p className="mb-3 mt-1 text-sm text-parchment/60">
        {changedMind
          ? `Суд изменил позицию по ${changedMind} из ${linked.recommendations.length} советов — причины указаны ниже.`
          : "Суд придерживается своих прошлых советов."}
      </p>
      <div className="overflow-x-auto rounded-xl border border-wood-700">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-wood-800 text-xs text-parchment/60">
            <tr>
              <th className="px-3 py-2 text-left font-normal">Совет в прошлый раз</th>
              <th className="w-28 px-3 py-2 text-left font-normal">Выполнен</th>
              <th className="px-3 py-2 text-left font-normal">Позиция суда сейчас</th>
            </tr>
          </thead>
          <tbody>
            {linked.recommendations.map((r, i) => {
              const j = review.get(r.change);
              return (
                <tr key={i} className="border-t border-wood-700 align-top">
                  <td className="px-3 py-2">{r.change}</td>
                  <td className="px-3 py-2">{r.status ? chip(IMPLEMENTATION_STYLES[r.status], IMPLEMENTATION_PLAIN[r.status]) : "—"}</td>
                  <td className="px-3 py-2">
                    {j ? (
                      <>
                        {chip(POSITION_STYLES[j.position], PRIOR_POSITION_PLAIN[j.position])}
                        <div className="mt-1 text-parchment/80">{j.explanation}</div>
                      </>
                    ) : (
                      <span className="text-parchment/50">суд не высказался</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {linked.changes.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-parchment/70 hover:text-brass-300">Что изменилось в этой версии</summary>
          <ul className="mt-2 list-disc pl-5 text-parchment/80">
            {linked.changes.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
