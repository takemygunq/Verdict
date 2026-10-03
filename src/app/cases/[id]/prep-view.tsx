"use client";

import { useState } from "react";
import { ModelSelect } from "@/components/model-select";
import { Section, btnCls, inputCls, primaryBtnCls } from "@/components/ui";
import { api, errorText } from "@/lib/client/api";
import type { ProviderView } from "@/lib/store/providers";
import type { CaseDetails } from "@/lib/trial/case-details";
import {
  MATERIAL_TYPES,
  MATERIAL_TYPE_TITLES,
  ROLE_TITLES,
  type CaseFile,
  type MaterialType,
  type Media,
  type Participant,
} from "@/lib/trial/schemas";
import { ROLE_ICONS } from "./labels";
import { MediaEditor, storyboardToText, textToStoryboard } from "./media-editor";
import { RevisionPrep } from "./revision";

const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)} тыс.` : String(n));

/** Экран 2: материалы дела и состав суда. Всё редактируется до открытия заседания. */
export function PrepView({
  details,
  providers,
  onChange,
  onStarted,
}: {
  details: CaseDetails;
  providers: ProviderView[];
  onChange: (d: CaseDetails) => void;
  onStarted: (d: CaseDetails) => void;
}) {
  const c = details.case;
  const [file, setFile] = useState<CaseFile>(c.caseFile!);
  const [roster, setRoster] = useState<Participant[]>(c.participants!);
  /** Раскадровки редактируются текстом и разбираются при сохранении */
  const [storyboards, setStoryboards] = useState<Record<string, string>>(() =>
    Object.fromEntries(c.caseFile!.media.map((m) => [m.fileId, storyboardToText(m.storyboard)])),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "start" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editFile = <K extends keyof CaseFile>(key: K, value: CaseFile[K]) => {
    setFile((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };
  const editMedia = (fileId: string, patch: Partial<Media>) => {
    setFile((f) => ({ ...f, media: f.media.map((m) => (m.fileId === fileId ? { ...m, ...patch } : m)) }));
    setDirty(true);
  };
  const editParticipant = (id: string, patch: Partial<Participant>) => {
    setRoster((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setDirty(true);
  };

  const jurors = roster.filter((p) => p.role === "juror");
  function addJuror() {
    let n = jurors.length + 1;
    while (roster.some((p) => p.id === `juror-${n}`)) n++;
    const model = jurors.at(-1)?.model ?? roster.find((p) => p.role === "prosecutor")?.model ?? null;
    setRoster((list) => [
      ...list,
      { id: `juror-${n}`, role: "juror", name: `Присяжный №${n}`, specialization: "", character: "", model },
    ]);
    setDirty(true);
  }

  async function save(): Promise<CaseDetails> {
    const next = await api<CaseDetails>(`/api/cases/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        caseFile: { ...file, media: file.media.map((m) => ({ ...m, storyboard: textToStoryboard(storyboards[m.fileId] ?? "") })) },
        participants: roster,
      }),
    });
    setDirty(false);
    onChange(next);
    return next;
  }

  async function run(kind: "save" | "start") {
    setBusy(kind);
    setError(null);
    try {
      if (dirty || kind === "save") await save();
      if (kind === "start") {
        await api(`/api/cases/${c.id}/start`, { method: "POST" });
        onStarted(await api<CaseDetails>(`/api/cases/${c.id}`));
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const est = details.estimate;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <h1 className="font-display text-3xl font-bold text-brass-400">Материалы дела и состав суда</h1>

      <RevisionPrep details={details} onChange={onChange} />

      <Section title="Материалы дела" hint="Их увидят все участники заседания. Поправьте, если секретарь что-то понял не так.">
        <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
          <Field label="Название дела">
            <input className={inputCls} value={file.title} onChange={(e) => editFile("title", e.target.value)} />
          </Field>
          <Field label="Тип материала">
            <select
              className={inputCls}
              value={file.material_type}
              onChange={(e) => editFile("material_type", e.target.value as MaterialType)}
            >
              {MATERIAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MATERIAL_TYPE_TITLES[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Краткое описание" className="sm:col-span-2">
            <textarea className={`${inputCls} min-h-20`} value={file.summary} onChange={(e) => editFile("summary", e.target.value)} />
          </Field>
          <Field label="Ключевые факты (по одному на строку)" className="sm:col-span-2">
            <textarea
              className={`${inputCls} min-h-24`}
              value={file.key_facts.join("\n")}
              onChange={(e) => editFile("key_facts", e.target.value.split("\n"))}
              onBlur={() => editFile("key_facts", file.key_facts.map((f) => f.trim()).filter(Boolean))}
            />
          </Field>
          {file.media.length > 0 && (
            <div className="flex flex-col gap-3 sm:col-span-2">
              <div className="text-xs text-parchment/70">
                Вложения — так их увидят участники. Модели со зрением дополнительно получат сами картинки и кадры видео.
              </div>
              {file.media.map((m) => (
                <MediaEditor
                  key={m.fileId}
                  caseId={c.id}
                  media={m}
                  storyboardText={storyboards[m.fileId] ?? ""}
                  onChange={(patch) => editMedia(m.fileId, patch)}
                  onStoryboardText={(text) => {
                    setStoryboards((s) => ({ ...s, [m.fileId]: text }));
                    setDirty(true);
                  }}
                />
              ))}
            </div>
          )}
          <Field label={file.media.length ? "Текст материала (необязательно)" : "Материал"} className="sm:col-span-2">
            <textarea
              className={`${inputCls} min-h-40 font-mono`}
              value={file.material_text}
              onChange={(e) => editFile("material_text", e.target.value)}
            />
          </Field>
          <Field label="Показания к делу" className="sm:col-span-2">
            <textarea className={`${inputCls} min-h-16`} value={file.comment} onChange={(e) => editFile("comment", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section
        title="Состав суда"
        hint="Модели спорящих сторон по возможности распределены по разным провайдерам, чтобы мнения были действительно разными."
      >
        <div className="flex flex-col gap-3">
          {roster.map((p) => (
            <div key={p.id} className="grid gap-3 rounded-xl border border-wood-700 bg-wood-800/60 p-3 sm:grid-cols-[180px_1fr_1fr]">
              <div className="flex items-start gap-2">
                <span className="text-2xl">{ROLE_ICONS[p.role]}</span>
                <div>
                  <div className="text-sm font-medium">{ROLE_TITLES[p.role]}</div>
                  {p.role === "juror" && jurors.length > 2 && (
                    <button
                      className="text-xs text-parchment/50 underline hover:text-verdict-red"
                      onClick={() => {
                        setRoster((list) => list.filter((x) => x.id !== p.id));
                        setDirty(true);
                      }}
                    >
                      исключить
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <input
                  className={inputCls}
                  value={p.name}
                  aria-label="Имя"
                  onChange={(e) => editParticipant(p.id, { name: e.target.value })}
                />
                {(p.role === "juror" || p.role === "witness") && (
                  <input
                    className={inputCls}
                    value={p.specialization}
                    placeholder={p.role === "witness" ? "Сегмент, возраст" : "Специализация"}
                    onChange={(e) => editParticipant(p.id, { specialization: e.target.value })}
                  />
                )}
                <ModelSelect value={p.model} providers={providers} onChange={(model) => editParticipant(p.id, { model })} />
              </div>
              {p.role === "secretary" || p.role === "judge" ? (
                <p className="text-sm text-parchment/50">
                  {p.role === "secretary"
                    ? "Ведёт протокол и решает, продолжать ли слушания."
                    : "Не участвует в спорах, выносит вердикт по итогам."}
                </p>
              ) : (
                <textarea
                  className={`${inputCls} min-h-20`}
                  value={p.character}
                  placeholder="Характер и позиция"
                  onChange={(e) => editParticipant(p.id, { character: e.target.value })}
                />
              )}
            </div>
          ))}
          {jurors.length < 4 && (
            <button className={`${btnCls} self-start`} onClick={addJuror}>
              + Добавить присяжного
            </button>
          )}
        </div>
      </Section>

      <div className="sticky bottom-4 flex flex-wrap items-center gap-4 rounded-xl border border-wood-700 bg-wood-900/95 px-4 py-3 shadow-lg backdrop-blur">
        {est && (
          <div className="text-sm text-parchment/70">
            Примерный расход: {fmt(est.min.input + est.min.output)}–{fmt(est.max.input + est.max.output)} токенов
            <span className="block text-xs text-parchment/50">
              в зависимости от числа заседаний; из них до {fmt(est.max.cached)} — повторное чтение материалов, его кэширует провайдер
              {dirty ? " · пересчитается после сохранения" : ""}. Стоимость в $ появится вместе с учётом затрат.
            </span>
          </div>
        )}
        {error && <p className="text-sm text-verdict-red">{error}</p>}
        <div className="ml-auto flex gap-2">
          {dirty && (
            <button className={btnCls} disabled={!!busy} onClick={() => void run("save")}>
              {busy === "save" ? "Сохраняю…" : "Сохранить"}
            </button>
          )}
          <button className={primaryBtnCls} disabled={!!busy} onClick={() => void run("start")}>
            {busy === "start" ? "Открываем…" : "🔨 Открыть заседание"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-parchment/70 ${className}`}>
      {label}
      {children}
    </label>
  );
}
