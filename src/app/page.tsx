import Link from "next/link";
import { hasFfmpeg } from "@/lib/materials/ffmpeg";
import { getCase, searchCases } from "@/lib/store/cases";
import { listProviders } from "@/lib/store/providers";
import { NewCaseForm, type RevisionOf } from "./new-case-form";
import { OUTCOME_TITLES, STATUS_TITLES } from "./cases/[id]/labels";

export const dynamic = "force-dynamic";

/** ?revisionOf=<id> — форма подаёт новую версию этого дела (кнопка «Подать новую версию» в отчёте) */
function revisionTarget(id: unknown): RevisionOf | null {
  if (typeof id !== "string") return null;
  try {
    const c = getCase(id);
    if (c.status !== "done" || c.parentId || !c.verdict) return null;
    return { id: c.id, title: c.caseFile?.title ?? c.materialText.slice(0, 80), score: c.verdict.success_score };
  } catch {
    return null;
  }
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const revisionOf = revisionTarget((await searchParams).revisionOf);
  const ffmpegMissing = !(await hasFfmpeg());
  const hasProviders = listProviders().some((p) => p.enabled && p.models.length);
  const cases = searchCases().slice(0, 8);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10">
      <div className="text-center">
        <h1>
          {/* eslint-disable-next-line @next/next/no-img-element -- статичный логотип */}
          <img src="/assets/brand/logo.webp" alt="Verdict" className="mx-auto h-28 w-auto" />
        </h1>
        <p className="mt-2 text-lg text-parchment/80">ИИ-суд над маркетинговыми проектами</p>
      </div>

      {!hasProviders && (
        <div className="rounded-xl border border-verdict-red/50 bg-verdict-red/10 px-4 py-3 text-sm">
          Суду не хватает судей: подключите хотя бы одного провайдера моделей в{" "}
          <Link href="/settings" className="underline hover:text-brass-300">
            настройках
          </Link>
          . Для пробы подойдёт провайдер «Демо» — он работает без ключа.
        </div>
      )}

      <NewCaseForm key={revisionOf?.id ?? "new"} disabled={!hasProviders} ffmpegMissing={ffmpegMissing} revisionOf={revisionOf} />

      {cases.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-xl font-bold">Последние дела</h2>
            <Link href="/cases" className="text-sm text-parchment/60 hover:text-brass-300">
              Весь архив →
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {cases.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/cases/${c.id}`}
                  className="flex items-center gap-3 rounded-xl border border-wood-700 bg-wood-900 px-4 py-3 hover:border-brass-500"
                >
                  <span className="min-w-0 flex-1 truncate">{c.caseFile?.title ?? c.materialText.slice(0, 80)}</span>
                  {c.verdict ? (
                    <span className="shrink-0 text-sm text-parchment/70">
                      {OUTCOME_TITLES[c.verdict.outcome]} ·{" "}
                      <b className="text-brass-300">{c.verdict.success_score}%</b>
                    </span>
                  ) : (
                    <span className="shrink-0 text-sm text-parchment/50">{STATUS_TITLES[c.status]}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
