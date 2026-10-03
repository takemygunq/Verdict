"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputCls, primaryBtnCls } from "@/components/ui";
import type { CaseView } from "@/lib/store/cases";
import { CourtroomDropzone, lookOf, primaryLook } from "./courtroom-dropzone";

const FILE_ICONS = { film: "🎞️", frame: "🖼️", folder: "📁", scroll: "📜" } as const;

function formatSize(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/** Отправка с прогрессом: большие видео грузятся заметное время. */
function upload(form: FormData, onProgress: (share: number) => void): Promise<{ case: CaseView }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/cases");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = (() => {
        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return {};
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error ?? `Ошибка ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Не удалось отправить файлы: нет связи с сервером"));
    xhr.send(form);
  });
}

/** Повторное рассмотрение: новая версия этого дела */
export interface RevisionOf {
  id: string;
  title: string;
  score: number | null;
}

export function NewCaseForm({
  disabled,
  ffmpegMissing,
  revisionOf,
}: {
  disabled: boolean;
  ffmpegMissing: boolean;
  revisionOf?: RevisionOf | null;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [material, setMaterial] = useState("");
  const [comment, setComment] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const look = primaryLook(files.map((f) => lookOf(f.type, f.name))) ?? (material.trim() ? "scroll" : null);
  const hasVideo = files.some((f) => lookOf(f.type, f.name) === "film");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setProgress(0);
    try {
      const form = new FormData();
      form.set("materialText", material);
      form.set("comment", comment);
      if (revisionOf) form.set("previousId", revisionOf.id);
      for (const f of files) form.append("files", f);
      const { case: c } = await upload(form, setProgress);
      router.push(`/cases/${c.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-wood-700 bg-wood-900 p-5">
      {revisionOf && (
        <div className="rounded-xl border border-brass-500/50 bg-brass-500/10 px-4 py-3 text-sm">
          🔁 <b>Повторное рассмотрение</b> дела «{revisionOf.title}»
          {revisionOf.score !== null && <span className="text-parchment/70"> (было {revisionOf.score}%)</span>}. Загрузите новую
          версию материала: суд сравнит её с прошлой и будет держать ответ за свои прошлые советы. Состав суда — тот же.{" "}
          <Link href="/" className="underline hover:text-brass-300">
            Отменить
          </Link>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-bold">Подсудимый</span>
        <CourtroomDropzone
          look={look}
          disabled={disabled || progress !== null}
          onFiles={(added) => setFiles((list) => [...list, ...added.filter((a) => !list.some((f) => f.name === a.name && f.size === a.size))])}
        />
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <li key={`${f.name}-${f.size}`} className="flex items-center gap-2 rounded-lg bg-wood-800 px-3 py-1.5 text-sm">
                <span>{FILE_ICONS[lookOf(f.type, f.name)]}</span>
                <span className="max-w-56 truncate">{f.name}</span>
                <span className="text-parchment/50">{formatSize(f.size)}</span>
                <button
                  type="button"
                  className="text-parchment/40 hover:text-verdict-red"
                  aria-label={`Убрать ${f.name}`}
                  onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {hasVideo && ffmpegMissing && (
          <p className="text-sm text-brass-300">
            ⚠️ ffmpeg не найден: без Gemini видео не получится разобрать. Установите ffmpeg или подключите Gemini.
          </p>
        )}
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-sm text-parchment/70">
          {files.length ? "Текст к материалу (необязательно)" : "…или вставьте текст: рекламу, сценарий ролика, стратегию, медиаплан"}
        </span>
        <textarea
          className={`${inputCls} min-h-28`}
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          placeholder="Например: «Кофе, который будит лучше будильника. Первая чашка — бесплатно по промокоду УТРО»"
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-display text-lg font-bold">Показания к делу</span>
        <span className="text-sm text-parchment/60">Канал, цель, бюджет, аудитория — всё, что поможет суду.</span>
        <textarea
          className={`${inputCls} min-h-20`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Например: реклама для Instagram, бюджет 50 000 ₽ в месяц, цель — подписки"
        />
      </label>
      {error && <p className="text-sm text-verdict-red">{error}</p>}
      <div className="flex items-center gap-4">
        <button className={`${primaryBtnCls} text-base`} disabled={disabled || progress !== null || (!material.trim() && !files.length)}>
          {progress === null ? "⚖️ Начать заседание" : progress < 1 ? "Передаём дело в суд…" : "Регистрируем дело…"}
        </button>
        {progress !== null && files.length > 0 && (
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-wood-700" aria-label="Загрузка файлов">
            <div className="h-full bg-brass-500 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
    </form>
  );
}
