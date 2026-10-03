import type { CaseView } from "../store/cases";
import type { StoredEvent } from "../trial/events";
import {
  CONFIDENCE_PLAIN,
  IMPLEMENTATION_PLAIN,
  LEVEL_PLAIN,
  OUTCOME_TITLES_PLAIN,
  PRIOR_POSITION_PLAIN,
  compareImprovements,
  tokensLine,
  urgencyPlain,
} from "../trial/labels";
import { MATERIAL_TYPE_TITLES, ROLE_TITLES, hasActualResult, type ActualResult } from "../trial/schemas";

/** Экранирование для ячеек таблицы Markdown */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
const date = (ms: number) =>
  new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function actualResultLines(r: ActualResult): string[] {
  const lines: string[] = [];
  if (r.ctr !== null) lines.push(`- CTR: ${r.ctr}%`);
  if (r.conversion !== null) lines.push(`- Конверсия: ${r.conversion}%`);
  if (r.sales !== null) lines.push(`- Продажи: ${r.sales.toLocaleString("ru-RU")}`);
  if (r.note) lines.push(`- Заметка: ${r.note}`);
  return lines;
}

export interface ExportInput {
  case: CaseView;
  events: StoredEvent[];
  parent?: CaseView | null;
  appeals?: CaseView[];
}

/** Отчёт по делу в Markdown: вердикт, аудитории, улучшения, риски, особые мнения, протокол. */
export function caseToMarkdown({ case: c, events, parent, appeals = [] }: ExportInput): string {
  const f = c.caseFile;
  const v = c.verdict;
  const out: string[] = [];
  out.push(`# ${f?.title ?? "Дело"}`, "", `*Verdict · ${date(c.createdAt)}*`, "");

  if (c.appeal) {
    out.push(
      `> **Апелляция** по делу «${parent?.caseFile?.title ?? c.parentId}». Аудитория: **${c.appeal.segment}, ${c.appeal.age_from}–${c.appeal.age_to} лет**.` +
        (c.appeal.note ? ` Пожелания: ${c.appeal.note}` : ""),
      "",
    );
  }

  const rev = c.revision?.status === "linked" ? c.revision : null;
  if (rev) {
    out.push(
      `> **Повторное рассмотрение**, версия ${rev.version}. Прошлая версия: «${rev.previous.title}» от ${date(rev.previous.createdAt)}` +
        (rev.previous.score !== null ? `, оценка ${rev.previous.score}%.` : "."),
      "",
    );
  }

  if (f) {
    out.push("## Материалы дела", "", `**Тип:** ${MATERIAL_TYPE_TITLES[f.material_type]}`, "");
    if (f.summary) out.push(f.summary, "");
    if (f.key_facts.length) out.push(...f.key_facts.map((k) => `- ${k}`), "");
    if (f.media.length) out.push(`**Вложения:** ${f.media.map((m) => m.name).join(", ")}`, "");
    if (f.comment) out.push(`**Показания к делу:** ${f.comment}`, "");
  }

  if (v) {
    out.push(
      "## Вердикт",
      "",
      `**Вероятность успеха: ${v.success_score}%** (разброс мнений ${v.score_range[0]}–${v.score_range[1]}, уверенность ${CONFIDENCE_PLAIN[v.confidence]})`,
      "",
      ...(v.plan_quality !== undefined
        ? [`**Качество плана: ${v.plan_quality}%** (разброс мнений ${v.plan_quality_range![0]}–${v.plan_quality_range![1]})`, ""]
        : []),
      `**Приговор:** ${OUTCOME_TITLES_PLAIN[v.outcome]}`,
      "",
      `> ${v.verdict_speech}`,
      "",
      v.verdict,
      "",
      "*Оценка — экспертное мнение суда, а не статистический прогноз.*",
      "",
    );
    if (rev) {
      out.push(`## Повторное рассмотрение`, "");
      if (rev.previous.score !== null) {
        const delta = v.success_score - rev.previous.score;
        out.push(`Оценка: ${rev.previous.score}% → **${v.success_score}%** (${delta >= 0 ? "+" : ""}${delta}).`, "");
      }
      if (rev.previous.planQuality != null && v.plan_quality !== undefined) {
        const delta = v.plan_quality - rev.previous.planQuality;
        out.push(`Качество плана: ${rev.previous.planQuality}% → **${v.plan_quality}%** (${delta >= 0 ? "+" : ""}${delta}).`, "");
      }
      if (rev.changes.length) out.push("**Что изменилось в новой версии:**", "", ...rev.changes.map((x) => `- ${x}`), "");
      const review = new Map((v.prior_recommendations ?? []).map((r) => [r.change, r]));
      if (rev.recommendations.length) {
        out.push("**Прошлые советы суда:**", "", "| Совет | Выполнен | Позиция суда | Пояснение |", "|---|---|---|---|");
        for (const r of rev.recommendations) {
          const j = review.get(r.change);
          out.push(
            `| ${cell(r.change)} | ${r.status ? IMPLEMENTATION_PLAIN[r.status] : "—"} | ${j ? PRIOR_POSITION_PLAIN[j.position] : "—"} | ${cell(j?.explanation ?? "")} |`,
          );
        }
        out.push("");
      }
    }
    if (v.audiences.length) {
      out.push("## Целевые аудитории", "", "| Аудитория | Возраст | Соответствие | Почему |", "|---|---|---|---|");
      for (const a of [...v.audiences].sort((x, y) => y.fit - x.fit)) {
        out.push(`| ${cell(a.segment)} | ${a.age_from}–${a.age_to} | ${a.fit}% | ${cell(a.why)} |`);
      }
      out.push("");
    }
    if (v.improvements.length) {
      out.push("## Что улучшить", "", "| Изменение | Зачем | Срочность | Влияние | Трудозатраты |", "|---|---|---|---|---|");
      for (const i of [...v.improvements].sort(compareImprovements)) {
        out.push(`| ${cell(i.change)} | ${cell(i.why)} | ${urgencyPlain(i.blocking)} | ${LEVEL_PLAIN[i.impact]} | ${LEVEL_PLAIN[i.effort]} |`);
      }
      out.push("");
    }
    if (v.risks.length) out.push("## Риски", "", ...v.risks.map((r) => `- ${r}`), "");
    out.push("## Особые мнения", "", ...(v.dissent.length ? v.dissent.map((d) => `- ${d}`) : ["Суд был единодушен."]), "");
  }

  if (hasActualResult(c.actualResult)) {
    out.push("## Фактический результат", "", ...actualResultLines(c.actualResult!), "");
    if (v) out.push(`Прогноз суда был: ${v.success_score}%.`, "");
  }

  // Протокол: оценки и тезисы по заседаниям
  const byId = new Map((c.participants ?? []).map((p) => [p.id, p]));
  const rounds = new Map<number, string[]>();
  for (const { event: e } of events) {
    const lines = rounds.get("round" in e ? e.round : 0) ?? [];
    if (e.type === "speech") {
      const p = byId.get(e.participantId);
      lines.push(`- **${p?.name ?? e.participantId}** (${p ? ROLE_TITLES[p.role] : ""}) — ${e.response.score}: ${e.response.stance}`);
    } else if (e.type === "absent") {
      lines.push(`- *${byId.get(e.participantId)?.name ?? e.participantId} отсутствовал(а)*`);
    } else if (e.type === "secretary_decision") {
      lines.push(`- *Секретарь: ${e.reason}*`);
    } else continue;
    rounds.set(e.round, lines);
  }
  if (rounds.size) {
    out.push("## Протокол");
    for (const [n, lines] of [...rounds].sort((a, b) => a[0] - b[0])) out.push("", `### Заседание №${n}`, "", ...lines);
    out.push("");
  }

  if (appeals.length) {
    out.push("## Апелляции", "");
    for (const a of appeals) {
      out.push(
        `- ${a.appeal?.segment ?? "—"} (${a.appeal?.age_from}–${a.appeal?.age_to} лет): ${a.verdict ? `${a.verdict.success_score}%, ${OUTCOME_TITLES_PLAIN[a.verdict.outcome]}` : "без вердикта"}`,
      );
    }
    out.push("");
  }

  out.push(`*Заседаний: ${c.rounds} · токенов: ${tokensLine(c)}*`, "");
  return out.join("\n");
}

/** Имя файла: латиница и цифры, чтобы не было проблем со скачиванием */
export function exportFileName(c: CaseView): string {
  return `verdict-${c.id}.md`;
}
