import { notFound } from "next/navigation";
import { getCase, listAppeals, listEvents, type CaseView } from "@/lib/store/cases";
import { NotFoundError } from "@/lib/store/providers";
import { actualResultLines } from "@/lib/export/markdown";
import { CONFIDENCE_PLAIN, LEVEL_PLAIN, OUTCOME_TITLES_PLAIN, compareImprovements, urgencyPlain } from "@/lib/trial/labels";
import { MATERIAL_TYPE_TITLES, ROLE_TITLES, hasActualResult } from "@/lib/trial/schemas";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/** Печатная версия отчёта: «Печать → Сохранить как PDF». Светлая тема, без шапки сайта. ?preview=1 — без автопечати. */
export default async function PrintPage({ params, searchParams }: PageProps<"/cases/[id]/print">) {
  const { id } = await params;
  // ?preview=1 — просмотр без автоматического диалога печати
  const { preview } = await searchParams;
  let c: CaseView;
  try {
    c = getCase(id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const parent = c.parentId ? getCase(c.parentId) : null;
  const appeals = listAppeals(id);
  const v = c.verdict;
  const f = c.caseFile;
  const byId = new Map((c.participants ?? []).map((p) => [p.id, p]));
  const rounds = new Map<number, { name: string; role: string; score: number; stance: string }[]>();
  for (const { event: e } of listEvents(id)) {
    if (e.type !== "speech") continue;
    const p = byId.get(e.participantId);
    rounds.set(e.round, [...(rounds.get(e.round) ?? []), { name: p?.name ?? "?", role: p ? ROLE_TITLES[p.role] : "", score: e.response.score, stance: e.response.stance }]);
  }

  return (
    <div className="print-page min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-3xl px-8 py-10 text-[13px] leading-relaxed">
        <PrintButton auto={preview !== "1"} />
        <header className="border-b-2 border-neutral-800 pb-4">
          <div className="text-xs uppercase tracking-[0.3em] text-neutral-500">Verdict · отчёт суда</div>
          <h1 className="mt-1 font-display text-3xl font-bold">{f?.title ?? "Дело"}</h1>
          <div className="text-neutral-500">{new Date(c.createdAt).toLocaleString("ru-RU")}</div>
          {c.appeal && (
            <p className="mt-2">
              Апелляция по делу «{parent?.caseFile?.title}». Аудитория:{" "}
              <b>
                {c.appeal.segment}, {c.appeal.age_from}–{c.appeal.age_to} лет
              </b>
            </p>
          )}
        </header>

        {v && (
          <section className="mt-6 flex gap-6 break-inside-avoid">
            <div className="w-40 shrink-0 text-center">
              <div className="text-xs uppercase text-neutral-500">Вероятность успеха</div>
              <div className="font-display text-6xl font-bold">{v.success_score}%</div>
              <div className="text-neutral-600">
                разброс {v.score_range[0]}–{v.score_range[1]}
                <br />
                уверенность {CONFIDENCE_PLAIN[v.confidence]}
              </div>
              {v.plan_quality !== undefined && (
                <div className="mt-2 text-neutral-600">
                  качество плана <b className="text-black">{v.plan_quality}%</b>
                  <br />
                  разброс {v.plan_quality_range![0]}–{v.plan_quality_range![1]}
                </div>
              )}
            </div>
            <div>
              <div className="font-bold uppercase">Приговор: {OUTCOME_TITLES_PLAIN[v.outcome]}</div>
              <blockquote className="mt-2 border-l-4 border-neutral-400 pl-3 font-display italic">{v.verdict_speech}</blockquote>
              <p className="mt-2">{v.verdict}</p>
              <p className="mt-2 text-xs text-neutral-500">Оценка — экспертное мнение суда, а не статистический прогноз.</p>
            </div>
          </section>
        )}

        {f && (
          <section className="mt-6 break-inside-avoid">
            <h2 className="font-display text-xl font-bold">Материалы дела</h2>
            <p>
              <b>Тип:</b> {MATERIAL_TYPE_TITLES[f.material_type]}
              {f.media.length > 0 && (
                <>
                  {" "}
                  · <b>вложения:</b> {f.media.map((m) => m.name).join(", ")}
                </>
              )}
            </p>
            {f.summary && <p className="mt-1">{f.summary}</p>}
            {f.comment && (
              <p className="mt-1">
                <b>Показания к делу:</b> {f.comment}
              </p>
            )}
          </section>
        )}

        {v && v.audiences.length > 0 && (
          <section className="mt-6 break-inside-avoid">
            <h2 className="font-display text-xl font-bold">Целевые аудитории</h2>
            <table className="mt-2 w-full border-collapse">
              <thead>
                <tr className="border-b border-neutral-400 text-left">
                  <th className="py-1 pr-2">Аудитория</th>
                  <th className="pr-2">Возраст</th>
                  <th className="pr-2">Соотв.</th>
                  <th>Почему</th>
                </tr>
              </thead>
              <tbody>
                {[...v.audiences]
                  .sort((a, b) => b.fit - a.fit)
                  .map((a, i) => (
                    <tr key={i} className="border-b border-neutral-200 align-top">
                      <td className="py-1 pr-2 font-medium">{a.segment}</td>
                      <td className="pr-2 whitespace-nowrap">
                        {a.age_from}–{a.age_to}
                      </td>
                      <td className="pr-2">{a.fit}%</td>
                      <td>{a.why}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )}

        {v && v.improvements.length > 0 && (
          <section className="mt-6">
            <h2 className="font-display text-xl font-bold">Что улучшить</h2>
            <table className="mt-2 w-full border-collapse">
              <thead>
                <tr className="border-b border-neutral-400 text-left">
                  <th className="py-1 pr-2">Изменение</th>
                  <th className="pr-2">Срочность</th>
                  <th className="pr-2">Влияние</th>
                  <th>Трудозатраты</th>
                </tr>
              </thead>
              <tbody>
                {[...v.improvements]
                  .sort(compareImprovements)
                  .map((imp, i) => (
                    <tr key={i} className="break-inside-avoid border-b border-neutral-200 align-top">
                      <td className="py-1 pr-2">
                        <b>{imp.change}</b>
                        <div className="text-neutral-600">{imp.why}</div>
                      </td>
                      <td className="pr-2">{urgencyPlain(imp.blocking)}</td>
                      <td className="pr-2">{LEVEL_PLAIN[imp.impact]}</td>
                      <td>{LEVEL_PLAIN[imp.effort]}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )}

        {v && (
          <section className="mt-6 grid grid-cols-2 gap-6 break-inside-avoid">
            <div>
              <h2 className="font-display text-xl font-bold">Риски</h2>
              <ul className="mt-1 list-disc pl-5">{v.risks.length ? v.risks.map((r, i) => <li key={i}>{r}</li>) : <li>не выявлены</li>}</ul>
            </div>
            <div>
              <h2 className="font-display text-xl font-bold">Особые мнения</h2>
              <ul className="mt-1 list-disc pl-5">
                {v.dissent.length ? v.dissent.map((d, i) => <li key={i}>{d}</li>) : <li>Суд был единодушен.</li>}
              </ul>
            </div>
          </section>
        )}

        {hasActualResult(c.actualResult) && (
          <section className="mt-6 break-inside-avoid">
            <h2 className="font-display text-xl font-bold">Фактический результат</h2>
            <ul className="mt-1">
              {actualResultLines(c.actualResult!).map((l, i) => (
                <li key={i}>{l.replace(/^- /, "")}</li>
              ))}
            </ul>
          </section>
        )}

        {appeals.length > 0 && (
          <section className="mt-6 break-inside-avoid">
            <h2 className="font-display text-xl font-bold">Апелляции</h2>
            <ul className="mt-1 list-disc pl-5">
              {appeals.map((a) => (
                <li key={a.id}>
                  {a.appeal?.segment} ({a.appeal?.age_from}–{a.appeal?.age_to} лет):{" "}
                  {a.verdict ? `${a.verdict.success_score}%, ${OUTCOME_TITLES_PLAIN[a.verdict.outcome]}` : "без вердикта"}
                </li>
              ))}
            </ul>
          </section>
        )}

        {rounds.size > 0 && (
          <section className="mt-6">
            <h2 className="font-display text-xl font-bold">Протокол</h2>
            {[...rounds].map(([n, items]) => (
              <div key={n} className="mt-2 break-inside-avoid">
                <h3 className="font-bold">Заседание №{n}</h3>
                <ul className="list-disc pl-5">
                  {items.map((it, i) => (
                    <li key={i}>
                      <b>{it.name}</b> ({it.role}) — {it.score}: {it.stance}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
