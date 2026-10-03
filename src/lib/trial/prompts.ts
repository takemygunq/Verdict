import fs from "node:fs";
import path from "node:path";
import { MATERIAL_TYPE_TITLES, ROLE_TITLES, type CaseFile, type Media, type Participant } from "./schemas";

export function promptsDir(): string {
  return process.env.VERDICT_PROMPTS_DIR ?? path.join(process.cwd(), "prompts");
}

/** Читает шаблон из /prompts при каждом вызове и подставляет {{переменные}}. */
export function loadPrompt(name: string, vars: Record<string, string | number> = {}): string {
  const file = path.join(promptsDir(), `${name}.md`);
  const template = fs.readFileSync(file, "utf8");
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`В промпте ${name}.md подстановка {{${key}}} не передана кодом`);
    return String(vars[key]);
  });
}

/** Материалы дела в виде сообщения для моделей. */
export function renderCaseFile(c: CaseFile): string {
  const lines = [
    `# Материалы дела: «${c.title}»`,
    `**Тип материала:** ${MATERIAL_TYPE_TITLES[c.material_type]}`,
  ];
  if (c.summary) lines.push("", "## Краткое описание", c.summary);
  if (c.key_facts.length) lines.push("", "## Ключевые факты", ...c.key_facts.map((f) => `- ${f}`));
  if (c.material_text.trim()) lines.push("", "## Материал", "<<<", c.material_text, ">>>");
  c.media.forEach((m, i) => lines.push("", renderMedia(m, i + 1)));
  if (c.comment.trim()) lines.push("", "## Показания к делу (комментарий заказчика)", c.comment);
  return lines.join("\n");
}

const MEDIA_TITLES: Record<Media["kind"], string> = { image: "изображение", video: "видео", document: "документ" };

/** Вложение в виде текста: так его «видят» модели без зрения (и все — при чтении протокола). */
export function renderMedia(m: Media, n: number): string {
  const lines = [`## Вложение ${n}: «${m.name}» (${MEDIA_TITLES[m.kind]})`];
  if (m.description.trim()) lines.push(m.kind === "image" ? "Описание изображения:" : "Описание:", m.description);
  if (m.storyboard.length) lines.push("", "Раскадровка:", ...m.storyboard.map((s) => `- ${s.time} — ${s.description}`));
  if (m.transcript.trim()) lines.push("", "Расшифровка речи:", "<<<", m.transcript, ">>>");
  if (m.text.trim()) lines.push("Текст документа:", "<<<", m.text, ">>>");
  if (m.frames.length && m.kind !== "document") {
    lines.push("", m.kind === "image" ? "(Само изображение приложено, если ты умеешь видеть картинки.)" : "(Несколько кадров приложены, если ты умеешь видеть картинки.)");
  }
  return lines.join("\n");
}

export function renderRoster(participants: Participant[]): string {
  return participants
    .map((p) => `- ${p.name} — ${ROLE_TITLES[p.role]}${p.specialization ? `, ${p.specialization}` : ""}`)
    .join("\n");
}

const ROLE_PROMPT: Record<string, string> = {
  prosecutor: "role-prosecutor",
  defense: "role-defense",
  witness: "role-witness",
  juror: "role-juror",
};

/**
 * Системный промпт выступающих — общий для всех: правила, состав суда и материалы дела.
 * Одинаковое начало запросов позволяет провайдерам кэшировать его: материалы читаются из кэша,
 * а не оплачиваются заново в каждом запросе. Роль и характер участника — в его сообщении.
 */
export function participantSystemPrompt(all: Participant[], caseText: string): string {
  return loadPrompt("participant", { roster: renderRoster(all), case: caseText });
}

/** Роль, имя и характер участника — начало его сообщения в каждом заседании. */
export function participantPersona(p: Participant): string {
  return loadPrompt("participant-persona", {
    role_title: ROLE_TITLES[p.role],
    name: p.name,
    specialization: p.specialization || "—",
    character: p.character || "—",
    role_instructions: loadPrompt(ROLE_PROMPT[p.role]),
  });
}
