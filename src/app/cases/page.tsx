import Link from "next/link";
import { inputCls, primaryBtnCls } from "@/components/ui";
import { searchCases, type CaseView } from "@/lib/store/cases";
import { hasActualResult } from "@/lib/trial/schemas";
import { OUTCOME_STYLES, OUTCOME_TITLES, STATUS_TITLES } from "./[id]/labels";

export const dynamic = "force-dynamic";

const date = (ms: number) => new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });

function Score({ c }: { c: CaseView }) {
  if (!c.verdict) return <span className="text-sm text-parchment/50">{STATUS_TITLES[c.status]}</span>;
  return (
    <span className="flex items-center gap-2">
      <span className={`rounded-full border px-2 py-0.5 text-xs ${OUTCOME_STYLES[c.verdict.outcome]}`}>{OUTCOME_TITLES[c.verdict.outcome]}</span>
      <b className="w-12 text-right font-display text-lg text-brass-300">{c.verdict.success_score}%</b>
    </span>
  );
}

/** Прогноз рядом с реальностью — главное, ради чего записывают фактический результат. */
function Actual({ c }: { c: CaseView }) {
  const r = c.actualResult;
  if (!hasActualResult(r)) return null;
  const parts = [r!.ctr !== null && `CTR ${r!.ctr}%`, r!.conversion !== null && `конверсия ${r!.conversion}%`, r!.sales !== null && `продажи ${r!.sales!.toLocaleString("ru-RU")}`].filter(Boolean);
  return (
    <div className="mt-1 text-xs text-verdict-green" title={r!.note}>
      📈 Факт: {parts.join(" · ") || r!.note}
    </div>
  );
}

export default async function ArchivePage({ searchParams }: PageProps<"/cases">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const cases = searchCases(query);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <h1 className="font-display text-3xl font-bold text-brass-400">Архив дел</h1>
      <form className="flex gap-2" action="/cases">
        <input name="q" defaultValue={query} placeholder="Поиск по названию, тексту, комментарию, аудитории апелляции…" className={`${inputCls} flex-1`} />
        <button className={primaryBtnCls}>Найти</button>
      </form>
      {query && (
        <p className="text-sm text-parchment/60">
          Найдено: {cases.length} ·{" "}
          <Link href="/cases" className="underline hover:text-brass-300">
            сбросить
          </Link>
        </p>
      )}
      {cases.length === 0 ? (
        <p className="text-parchment/60">{query ? "Ничего не нашлось." : "Дел пока нет — начните первое заседание на главной."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {cases.map((c) => (
            <li key={c.id} className="rounded-xl border border-wood-700 bg-wood-900">
              <Link href={`/cases/${c.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-wood-800/60">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.caseFile?.title ?? c.materialText.slice(0, 100)}</div>
                  <div className="text-xs text-parchment/50">
                    {date(c.createdAt)}
                    {c.caseFile?.media.length ? ` · вложений: ${c.caseFile.media.length}` : ""}
                    {c.appeals.length ? ` · апелляций: ${c.appeals.length}` : ""}
                    {c.revision?.status === "linked" ? ` · 🔁 версия ${c.revision.version} (было ${c.revision.previous.score ?? "—"}%)` : ""}
                  </div>
                  <Actual c={c} />
                </div>
                <Score c={c} />
              </Link>
              {c.appeals.length > 0 && (
                <ul className="border-t border-wood-700/60">
                  {c.appeals.map((a) => (
                    <li key={a.id}>
                      <Link href={`/cases/${a.id}`} className="flex items-start gap-3 py-2 pl-8 pr-4 text-sm hover:bg-wood-800/60">
                        <div className="min-w-0 flex-1">
                          <span className="text-parchment/50">↳ апелляция: </span>
                          {a.appeal?.segment}, {a.appeal?.age_from}–{a.appeal?.age_to} лет
                          <Actual c={a} />
                        </div>
                        <Score c={a} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
