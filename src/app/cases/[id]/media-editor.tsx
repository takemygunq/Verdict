"use client";

import { inputCls } from "@/components/ui";
import type { Media } from "@/lib/trial/schemas";

const KIND_TITLES: Record<Media["kind"], string> = { image: "Изображение", video: "Видео", document: "Документ" };
const KIND_ICONS: Record<Media["kind"], string> = { image: "🖼️", video: "🎞️", document: "📄" };

/** Раскадровка редактируется как текст: «ММ:СС — что в кадре», по строке на момент. */
export function storyboardToText(s: Media["storyboard"]): string {
  return s.map((x) => `${x.time} — ${x.description}`).join("\n");
}

export function textToStoryboard(text: string): Media["storyboard"] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*[—–-]\s*(.+)$/);
      return m ? { time: m[1], description: m[2] } : { time: "", description: line };
    });
}

/** Одно вложение материалов дела: превью и редактируемые описания. */
export function MediaEditor({
  caseId,
  media,
  storyboardText,
  onChange,
  onStoryboardText,
}: {
  caseId: string;
  media: Media;
  storyboardText: string;
  onChange: (patch: Partial<Media>) => void;
  onStoryboardText: (text: string) => void;
}) {
  const fileUrl = `/api/cases/${caseId}/files/${media.fileId}`;
  const frameUrl = (name: string) => `/api/cases/${caseId}/frames/${name}`;

  return (
    <div className="rounded-xl border border-wood-700 bg-wood-800/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="text-xl">{KIND_ICONS[media.kind]}</span>
        <span className="font-medium">{media.name}</span>
        <span className="text-parchment/50">{KIND_TITLES[media.kind]}</span>
        <a href={fileUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs text-parchment/50 underline hover:text-brass-300">
          открыть файл
        </a>
      </div>

      {media.warnings.map((w, i) => (
        <p key={i} className="mb-2 rounded-lg bg-brass-500/10 px-3 py-2 text-sm text-brass-300">
          ⚠️ {w}
        </p>
      ))}

      <div className="grid gap-3 md:grid-cols-[240px_1fr]">
        <div className="flex min-w-0 flex-col gap-2">
          {media.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element -- превью локального файла
            <img src={fileUrl} alt={media.name} className="w-full rounded-lg border border-wood-700 object-contain" />
          )}
          {media.kind === "video" && (
            <>
              <video src={fileUrl} controls preload="metadata" className="w-full rounded-lg border border-wood-700" />
              {media.frames.length > 0 && (
                <div className="grid grid-cols-4 gap-1" title="Эти кадры увидят модели со зрением">
                  {media.frames.map((f) => (
                    // eslint-disable-next-line @next/next/no-img-element -- кадры с локального сервера
                    <img key={f} src={frameUrl(f)} alt="" className="aspect-video w-full min-w-0 rounded object-cover" />
                  ))}
                </div>
              )}
            </>
          )}
          {media.kind === "document" && (
            <div className="grid h-32 place-items-center rounded-lg border border-wood-700 text-4xl">📄</div>
          )}
        </div>

        <div className="flex flex-col gap-2 text-xs text-parchment/70">
          {media.kind !== "document" && (
            <label className="flex flex-col gap-1">
              {media.kind === "image" ? "Описание изображения (для моделей без зрения)" : "Описание ролика"}
              <textarea className={`${inputCls} min-h-28`} value={media.description} onChange={(e) => onChange({ description: e.target.value })} />
            </label>
          )}
          {media.kind === "video" && (
            <>
              <label className="flex flex-col gap-1">
                Раскадровка — по строке на момент: «ММ:СС — что в кадре»
                <textarea className={`${inputCls} min-h-28 font-mono`} value={storyboardText} onChange={(e) => onStoryboardText(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                Расшифровка речи
                <textarea className={`${inputCls} min-h-20`} value={media.transcript} onChange={(e) => onChange({ transcript: e.target.value })} />
              </label>
            </>
          )}
          {media.kind === "document" && (
            <details open={media.text.length < 2000}>
              <summary className="cursor-pointer">Текст документа ({media.text.length.toLocaleString("ru")} символов)</summary>
              <textarea
                className={`${inputCls} mt-1 min-h-48 w-full font-mono`}
                value={media.text}
                onChange={(e) => onChange({ text: e.target.value })}
              />
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
