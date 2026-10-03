import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

let available: Promise<boolean> | null = null;

/** Есть ли ffmpeg и ffprobe в PATH (проверяется один раз за процесс). */
export function hasFfmpeg(): Promise<boolean> {
  available ??= Promise.all([run("ffmpeg", ["-version"]), run("ffprobe", ["-version"])]).then(
    () => true,
    () => false,
  );
  return available;
}

export interface VideoInfo {
  duration: number;
  hasAudio: boolean;
}

export async function probeVideo(file: string): Promise<VideoInfo> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file]);
  const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
  return {
    duration: Number(info.format?.duration ?? 0),
    hasAudio: (info.streams ?? []).some((s) => s.codec_type === "audio"),
  };
}

/** Моменты смены сцены (секунды) по фильтру scene. */
export async function sceneChanges(file: string, threshold = 0.3): Promise<number[]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", file, "-vf", `select='gt(scene,${threshold})',showinfo`, "-an", "-f", "null", "-"], {
    maxBuffer: MAX_BUFFER,
  });
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

/**
 * Выбирает моменты для ключевых кадров: начало, смены сцен, а если их мало — равномерно.
 * Не больше max и не чаще чем раз в minGap секунд.
 */
export function pickKeyframeTimes(duration: number, scenes: number[], max = 20, minGap = 0.8): number[] {
  const candidates = [0, ...scenes].filter((t) => t < duration).sort((a, b) => a - b);
  const times: number[] = [];
  for (const t of candidates) if (!times.length || t - times[times.length - 1] >= minGap) times.push(t);
  // Мало смен сцены (статичный ролик) — добираем равномерно
  const wanted = Math.min(max, Math.max(4, Math.ceil(duration / 3)));
  if (times.length < wanted && duration > 0) {
    for (let i = 1; i < wanted; i++) {
      const t = (duration * i) / wanted;
      if (times.every((x) => Math.abs(x - t) >= minGap)) times.push(t);
    }
    times.sort((a, b) => a - b);
  }
  if (times.length <= max) return times;
  // Слишком много — равномерно прореживаем
  return Array.from({ length: max }, (_, i) => times[Math.round((i * (times.length - 1)) / (max - 1))]);
}

export interface Keyframe {
  time: number;
  file: string;
}

export async function extractKeyframes(video: string, outDir: string, prefix: string, max = 20): Promise<Keyframe[]> {
  const { duration } = await probeVideo(video);
  const times = pickKeyframeTimes(duration, await sceneChanges(video).catch(() => []), max);
  const frames: Keyframe[] = [];
  for (const [i, t] of times.entries()) {
    const file = path.join(outDir, `${prefix}-frame-${String(i + 1).padStart(2, "0")}.jpg`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale='min(768,iw)':-2", "-q:v", "4", file]);
    frames.push({ time: t, file });
  }
  return frames;
}

/** Аудио для транскрипции: моно 16 кГц, mp3 — укладывается в лимит Whisper (25 МБ) для роликов до ~1 часа. */
export async function extractAudio(video: string, out: string): Promise<string | null> {
  const { hasAudio } = await probeVideo(video);
  if (!hasAudio) return null;
  await run("ffmpeg", ["-v", "error", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", out]);
  return out;
}

/** Картинка для моделей: уменьшенная копия в JPEG (экономит токены и обходит неподдерживаемые форматы). */
export async function toVisionJpeg(image: string, out: string): Promise<string> {
  await run("ffmpeg", ["-v", "error", "-y", "-i", image, "-frames:v", "1", "-vf", "scale='min(1568,iw)':-2", "-q:v", "3", out]);
  return out;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
