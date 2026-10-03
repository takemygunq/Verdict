import type { ModelProvider, Usage } from "../providers/types";
import type { ProviderView } from "../store/providers";
import {
  getCase,
  listFinishedRootCases,
  listRevisions,
  type CaseView,
} from "../store/cases";
import { finalPositions } from "./appeal";
import { askJson } from "./json";
import { OUTCOME_TITLES_PLAIN } from "./labels";
import { loadPrompt, renderCaseFile } from "./prompts";
import {
  revisionCompareSchema,
  type CaseFile,
  type ImplementationStatus,
  type LinkedRevision,
  type ModelRef,
  type Participant,
} from "./schemas";

/* ---------------- Поиск прошлой версии ---------------- */

/** Порог сходства текстов, после которого суд предлагает считать дело новой версией. Подтверждает пользователь. */
export const REVISION_SIMILARITY = 0.5;

function caseCorpus(c: CaseFile): string {
  return [
    c.title,
    c.summary,
    ...c.key_facts,
    c.material_text,
    ...c.media.flatMap((m) => [m.name, m.description, m.transcript, m.text, ...m.storyboard.map((s) => s.description)]),
  ].join(" ");
}

function termVector(text: string): Map<string, number> {
  const v = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (w.length >= 3) v.set(w, (v.get(w) ?? 0) + 1);
  }
  return v;
}

/** Косинусное сходство частот слов: у версий одного материала ~0.6+, у разных материалов ~0.1–0.3. */
export function textSimilarity(a: string, b: string): number {
  const va = termVector(a);
  const vb = termVector(b);
  let dot = 0;
  for (const [w, n] of va) dot += n * (vb.get(w) ?? 0);
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, n) => s + n * n, 0));
  const d = norm(va) * norm(vb);
  return d ? dot / d : 0;
}

export interface RevisionCandidate {
  id: string;
  title: string;
  score: number | null;
  createdAt: number;
  similarity: number;
}

/** Самое похожее завершённое дело из архива, если сходство выше порога. */
export function findRevisionCandidate(c: CaseView): RevisionCandidate | null {
  if (!c.caseFile || c.parentId || c.previousId || c.revision) return null;
  const corpus = caseCorpus(c.caseFile);
  let best: RevisionCandidate | null = null;
  for (const other of listFinishedRootCases()) {
    if (other.id === c.id || other.createdAt >= c.createdAt || !other.caseFile || !other.verdict) continue;
    const similarity = textSimilarity(corpus, caseCorpus(other.caseFile));
    if (similarity >= REVISION_SIMILARITY && (!best || similarity > best.similarity)) {
      best = {
        id: other.id,
        title: other.caseFile.title,
        score: other.verdict.success_score,
        createdAt: other.createdAt,
        similarity: Math.round(similarity * 100) / 100,
      };
    }
  }
  return best;
}

/* ---------------- Связь с прошлой версией ---------------- */

/** Снимок прошлой версии: номер, итог и её советы (статусы заполнит сравнение секретаря). */
export function revisionSnapshot(previous: CaseView): LinkedRevision {
  if (previous.status !== "done" || !previous.verdict || !previous.caseFile) {
    throw new RevisionError("Повторное рассмотрение возможно только для дела с вынесенным вердиктом");
  }
  if (previous.parentId) throw new RevisionError("Новую версию подают к исходному делу, а не к апелляции");
  return {
    status: "linked",
    previousId: previous.id,
    version: previous.revision?.status === "linked" ? previous.revision.version + 1 : 2,
    previous: {
      title: previous.caseFile.title,
      score: previous.verdict.success_score,
      planQuality: previous.verdict.plan_quality ?? null,
      outcome: previous.verdict.outcome,
      createdAt: previous.createdAt,
    },
    changes: [],
    recommendations: previous.verdict.improvements.map((i) => ({ change: i.change, why: i.why, status: null, evidence: "" })),
  };
}

export class RevisionError extends Error {}

/**
 * Тот же состав суда, что и в прошлый раз. Если модель участника больше недоступна
 * (провайдер удалён или выключен), назначается текущая — по тем же правилам, что при подборе состава.
 */
export function reuseParticipants(
  previous: Participant[],
  providers: ProviderView[],
  models: { secretary: ModelRef; judge: ModelRef; pool: ModelRef[] },
): Participant[] {
  const usable = (m: ModelRef | null) =>
    !!m && providers.some((p) => p.id === m.providerId && p.enabled && p.models.some((x) => x.id === m.modelId));
  let next = 0;
  return previous.map((p) => {
    if (usable(p.model)) return p;
    if (p.role === "secretary") return { ...p, model: models.secretary };
    if (p.role === "judge") return { ...p, model: models.judge };
    return { ...p, model: models.pool[next++ % models.pool.length] ?? models.secretary };
  });
}

/** Секретарь сравнивает версии: что изменилось и какие прошлые советы выполнены. */
export async function compareVersions(
  previous: CaseFile,
  next: CaseFile,
  revision: LinkedRevision,
  model: ModelProvider,
  onUsage?: (u: Usage) => void,
): Promise<LinkedRevision> {
  const recs = revision.recommendations;
  const content = [
    "# Прошлая версия",
    renderCaseFile(previous),
    "---",
    "# Советы суда по прошлой версии",
    recs.length ? recs.map((r, i) => `${i + 1}. ${r.change}`).join("\n") : "Советов не было.",
    "---",
    "# Новая версия",
    renderCaseFile(next),
  ].join("\n\n");
  const out = await askJson(model, revisionCompareSchema, {
    system: loadPrompt("secretary-revision"),
    messages: [{ role: "user", content }],
    onUsage,
  });
  const byIndex = new Map(out.recommendations.map((r) => [r.index, r]));
  return {
    ...revision,
    changes: out.changes,
    recommendations: recs.map((r, i) => {
      const found = byIndex.get(i + 1);
      return found ? { ...r, status: found.status, evidence: found.evidence } : r;
    }),
  };
}

/* ---------------- Контекст для суда ---------------- */

const STATUS_PLAIN: Record<ImplementationStatus, string> = {
  implemented: "выполнен",
  partial: "выполнен частично",
  not_implemented: "не выполнен",
};

export function revisionContext(revision: LinkedRevision, previous: CaseView | null): string {
  const v = previous?.verdict;
  const verdictText = v
    ? [
        `Оценка вероятности успеха: ${v.success_score}% (разброс ${v.score_range[0]}–${v.score_range[1]})${
          v.plan_quality !== undefined ? `, качество плана: ${v.plan_quality}%` : ""
        }, приговор: ${OUTCOME_TITLES_PLAIN[v.outcome]}.`,
        v.verdict,
        v.risks.length ? `Риски:\n${v.risks.map((r) => `- ${r}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    : `Оценка вероятности успеха: ${revision.previous.score ?? "—"}%. Подробности прошлого вердикта недоступны (дело удалено).`;
  const recommendations = revision.recommendations.length
    ? revision.recommendations
        .map((r, i) => {
          const status = r.status ? `**${STATUS_PLAIN[r.status]}**${r.evidence ? ` — ${r.evidence}` : ""}` : "статус не установлен";
          return `${i + 1}. ${r.change}${r.why ? `\n   Почему советовали: ${r.why}` : ""}\n   Сейчас: ${status}`;
        })
        .join("\n")
    : "Советов в прошлый раз не было.";
  return loadPrompt("revision", {
    version: revision.version,
    previous_date: new Date(revision.previous.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }),
    previous_verdict: verdictText,
    recommendations,
    changes: revision.changes.length ? revision.changes.map((c) => `- ${c}`).join("\n") : "Секретарь не смог сравнить версии.",
    positions: previous?.participants ? finalPositions(previous.id, previous.participants) : "Недоступны.",
  });
}

/** Контекст и параметры заседания для повторного рассмотрения (или undefined, если это не оно). */
export function revisionFor(c: CaseView) {
  if (c.revision?.status !== "linked") return undefined;
  const revision = c.revision;
  let previous: CaseView | null = null;
  try {
    previous = getCase(revision.previousId);
  } catch {
    previous = null; // прошлое дело удалено — работаем по снимку
  }
  return {
    context: revisionContext(revision, previous),
    input: { version: revision.version, previousRecommendations: revision.recommendations.map((r) => r.change) },
  };
}

/** Цепочка версий: более новые версии этого дела. */
export function newerVersions(id: string): CaseView[] {
  return listRevisions(id);
}
