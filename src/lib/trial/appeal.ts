import { getCase, listEvents, type CaseView } from "../store/cases";
import { OUTCOME_TITLES_PLAIN } from "./labels";
import { loadPrompt } from "./prompts";
import { ROLE_TITLES, isDebater, type Appeal, type Participant, type ParticipantResponse } from "./schemas";

/** Финальная позиция каждого участника исходного дела — последняя реплика. */
export function finalPositions(caseId: string, participants: Participant[]): string {
  const latest = new Map<string, ParticipantResponse>();
  for (const { event } of listEvents(caseId)) if (event.type === "speech") latest.set(event.participantId, event.response);
  const lines = participants.filter(isDebater).flatMap((p) => {
    const r = latest.get(p.id);
    return r ? [`- ${p.name} (${ROLE_TITLES[p.role]}): оценка ${r.score} — ${r.stance}`] : [];
  });
  return lines.join("\n") || "Позиции участников не сохранились.";
}

/** Блок контекста апелляции для всех участников и судьи. */
export function appealContext(appeal: Appeal, parent: CaseView): string {
  const v = parent.verdict;
  const previous = v
    ? [
        `Оценка вероятности успеха: ${v.success_score}% (разброс ${v.score_range[0]}–${v.score_range[1]}), приговор: ${OUTCOME_TITLES_PLAIN[v.outcome]}.`,
        v.verdict,
        v.improvements.length ? `Рекомендованные улучшения:\n${v.improvements.map((i) => `- ${i.change}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    : "Вердикт первого слушания недоступен.";
  return loadPrompt("appeal", {
    segment: appeal.segment,
    age_from: appeal.age_from,
    age_to: appeal.age_to,
    note: appeal.note ? `**Пожелания заказчика:** ${appeal.note}` : "",
    previous_verdict: previous,
    positions: parent.participants ? finalPositions(parent.id, parent.participants) : "—",
  });
}

/** Состав суда для апелляции: тот же суд, а свидетель — представитель зафиксированной аудитории. */
export function appealParticipants(participants: Participant[], appeal: Appeal): Participant[] {
  return participants.map((p) =>
    p.role === "witness"
      ? {
          ...p,
          specialization: `${appeal.segment}, ${appeal.age_from}–${appeal.age_to} лет`,
          character: `Типичный представитель аудитории «${appeal.segment}» (${appeal.age_from}–${appeal.age_to} лет): оценивает материал её глазами — что зацепит, что смутит, что заставит действовать.`,
        }
      : p,
  );
}

export function appealContextFor(c: CaseView): string | undefined {
  if (!c.appeal || !c.parentId) return undefined;
  return appealContext(c.appeal, getCase(c.parentId));
}
