import path from "node:path";
import type { Attachment, ModelProvider, Usage } from "../providers/types";
import { askJson } from "../trial/json";
import { loadPrompt } from "../trial/prompts";
import { imageDescriptionSchema, videoAnalysisSchema, type Media, type ModelRef } from "../trial/schemas";
import { extractDocxText, extractPdfText, readTextFile, truncate } from "./extract";
import { extractAudio, extractKeyframes, formatTime, toVisionJpeg } from "./ffmpeg";
import { derivedDir, type CaseFileView } from "./files";

export interface ProcessDeps {
  getModel(ref: ModelRef): ModelProvider;
  /** Модель со зрением: описание картинок и ключевых кадров */
  vision: ModelRef;
  /** Модель, понимающая видео нативно (Gemini) — если подключена */
  video: ModelRef | null;
  /** Расшифровка аудио (Whisper) — если есть ключ OpenAI */
  transcribe: ((audioPath: string) => Promise<string>) | null;
  ffmpeg: boolean;
  /** Путь к файлу дела на диске */
  filePath(fileId: string): string;
  onProgress(text: string): void;
  onUsage?(u: Usage): void;
}

export interface ProcessedMaterials {
  media: Media[];
  /** Текст из .txt/.md — добавляется к тексту материала */
  extraText: string;
}

/** Сколько кадров видео отдаём участникам заседания (остальные — только в описании) */
export const FRAMES_FOR_PARTICIPANTS = 4;
/** Сколько кадров видим при описании видео без Gemini */
const FRAMES_FOR_ANALYSIS = 12;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function emptyMedia(file: CaseFileView, kind: Media["kind"]): Media {
  return { fileId: file.id, kind, name: file.name, description: "", storyboard: [], transcript: "", text: "", frames: [], warnings: [] };
}

function pickEvenly<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}

function jpeg(file: string): Attachment {
  return { kind: "image", mimeType: "image/jpeg", filePath: file, filename: path.basename(file) };
}

/**
 * Превращает загруженные файлы в «материалы дела»: тексты документов, описания картинок,
 * раскадровку и расшифровку видео. Ошибка одного файла не роняет обработку — она попадает в warnings.
 */
export async function processMaterials(caseId: string, files: CaseFileView[], comment: string, deps: ProcessDeps): Promise<ProcessedMaterials> {
  const media: Media[] = [];
  const extraText: string[] = [];
  const context = comment.trim() ? `Комментарий заказчика: ${comment.trim()}` : "Комментария заказчика нет.";
  const outDir = derivedDir(caseId);

  for (const [i, file] of files.entries()) {
    const where = `${i + 1}/${files.length} «${file.name}»`;
    const src = deps.filePath(file.id);
    try {
      switch (file.kind) {
        case "text": {
          deps.onProgress(`Читаем текст ${where}`);
          extraText.push(truncate(readTextFile(src)).text);
          break;
        }
        case "pdf":
        case "docx": {
          deps.onProgress(`Извлекаем текст из документа ${where}`);
          const m = emptyMedia(file, "document");
          const raw = file.kind === "pdf" ? await extractPdfText(src) : await extractDocxText(src);
          const { text, truncated } = truncate(raw);
          m.text = text;
          if (!text) m.warnings.push("В документе не нашлось текста (возможно, это скан) — опишите его содержание вручную.");
          if (truncated) m.warnings.push("Документ длинный — участники увидят только начало.");
          media.push(m);
          break;
        }
        case "image": {
          deps.onProgress(`Изучаем изображение ${where}`);
          const m = emptyMedia(file, "image");
          // Уменьшенная JPEG-копия: её увидят модели со зрением
          const prepared = deps.ffmpeg ? await toVisionJpeg(src, path.join(outDir, `${file.id}-image.jpg`)) : src;
          m.frames = [path.basename(prepared)];
          const image: Attachment = deps.ffmpeg ? jpeg(prepared) : { kind: "image", mimeType: file.mime, filePath: src, filename: file.name };
          const d = await askJson(deps.getModel(deps.vision), imageDescriptionSchema, {
            system: loadPrompt("materials-image"),
            messages: [{ role: "user", content: `Файл: ${file.name}\n${context}` }],
            attachments: [image],
            onUsage: deps.onUsage,
          });
          m.description = d.visible_text.trim() ? `${d.description}\n\nТекст на изображении: ${d.visible_text}` : d.description;
          media.push(m);
          break;
        }
        case "video": {
          media.push(await processVideo(file, src, outDir, context, where, deps));
          break;
        }
      }
    } catch (e) {
      const m = emptyMedia(file, file.kind === "video" ? "video" : file.kind === "image" ? "image" : "document");
      m.warnings.push(`Не удалось обработать файл: ${errorText(e)}. Опишите его содержание вручную.`);
      media.push(m);
    }
  }
  return { media, extraText: extraText.join("\n\n") };
}

async function processVideo(file: CaseFileView, src: string, outDir: string, context: string, where: string, deps: ProcessDeps): Promise<Media> {
  const m = emptyMedia(file, "video");
  const keyframes = deps.ffmpeg ? (deps.onProgress(`Нарезаем ключевые кадры ${where}`), await extractKeyframes(src, outDir, file.id)) : [];
  m.frames = pickEvenly(keyframes, FRAMES_FOR_PARTICIPANTS).map((k) => path.basename(k.file));
  if (!deps.ffmpeg) m.warnings.push("ffmpeg не найден в PATH — ключевые кадры не извлечены, модели со зрением не увидят ролик.");

  // 1. Нативный анализ видео в Gemini
  if (deps.video) {
    deps.onProgress(`Gemini смотрит видео ${where}`);
    try {
      const a = await askJson(deps.getModel(deps.video), videoAnalysisSchema, {
        system: loadPrompt("materials-video"),
        messages: [{ role: "user", content: `Файл: ${file.name}\n${context}` }],
        attachments: [{ kind: "video", mimeType: file.mime, filePath: src, filename: file.name }],
        onUsage: deps.onUsage,
      });
      return { ...m, description: a.description, storyboard: a.storyboard, transcript: a.transcript };
    } catch (e) {
      m.warnings.push(`Gemini не смог проанализировать видео (${errorText(e)}) — описание собрано по кадрам.`);
    }
  }

  // 2. Без Gemini: кадры + расшифровка аудио
  if (!keyframes.length) {
    m.warnings.push("Видео не проанализировано: нужен Gemini или ffmpeg. Опишите ролик вручную.");
    return m;
  }
  let transcript = "";
  const audio = await extractAudio(src, path.join(outDir, `${file.id}-audio.mp3`)).catch(() => null);
  if (audio && deps.transcribe) {
    deps.onProgress(`Расшифровываем речь ${where}`);
    try {
      transcript = await deps.transcribe(audio);
    } catch (e) {
      m.warnings.push(`Не удалось расшифровать речь: ${errorText(e)}`);
    }
  } else if (audio) {
    m.warnings.push("Речь не расшифрована: для транскрипции нужен провайдер OpenAI (Whisper). Добавьте текст вручную.");
  }

  deps.onProgress(`Описываем раскадровку ${where}`);
  const shown = pickEvenly(keyframes, FRAMES_FOR_ANALYSIS);
  const a = await askJson(deps.getModel(deps.vision), videoAnalysisSchema, {
    system: loadPrompt("materials-video-frames"),
    messages: [
      {
        role: "user",
        content: [
          `Файл: ${file.name}`,
          context,
          `Кадры по порядку (таймкоды): ${shown.map((k) => formatTime(k.time)).join(", ")}`,
          transcript ? `Расшифровка речи:\n${transcript}` : "Речь не расшифрована или её нет.",
        ].join("\n"),
      },
    ],
    attachments: shown.map((k) => jpeg(k.file)),
    onUsage: deps.onUsage,
  });
  return { ...m, description: a.description, storyboard: a.storyboard, transcript: transcript || a.transcript };
}
