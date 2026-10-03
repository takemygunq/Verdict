import { z } from "zod";

/**
 * Манифест ассетов /public/assets/manifest.json: персонаж → поза/эмоция → файл.
 * Пути — относительно /assets. Всё необязательно: чего нет, то сцена рисует заглушкой.
 */
const file = z.string().min(1);

export const characterAssetsSchema = z.object({
  /** Поза по умолчанию */
  idle: file.optional(),
  /** Эмоции: calm, confident, angry, skeptical, surprised, laughing, thinking, sad */
  emotions: z.record(z.string(), file).default({}),
  /** Кадры цикла ходьбы */
  walk: z.array(file).default([]),
  /** Для подсудимого: ecstatic, happy, calm, nervous, sweating */
  moods: z.record(z.string(), file).default({}),
});

export const manifestSchema = z.object({
  version: z.literal(1),
  backgrounds: z.object({ default: file.optional(), verdict: file.optional() }).default({}),
  /** Ключи: judge, secretary, prosecutor, defense, witness, juror-1…juror-6, defendant-film/-scroll/-folder/-frame */
  characters: z.record(z.string(), characterAssetsSchema).default({}),
  /** gavel, podium, bubble, confetti, verdict-plaque, … */
  objects: z.record(z.string(), file).default({}),
  /** Видеолупы с прозрачным фоном: gavel, verdict, … (webm) */
  videos: z.record(z.string(), file).default({}),
});

export type AssetManifest = z.infer<typeof manifestSchema>;
export type CharacterAssets = z.infer<typeof characterAssetsSchema>;

export const EMPTY_MANIFEST: AssetManifest = { version: 1, backgrounds: {}, characters: {}, objects: {}, videos: {} };

/** Загружает манифест; при любой проблеме — пустой (приложение работает и без ассетов). */
export async function loadManifest(url = "/assets/manifest.json"): Promise<AssetManifest> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return EMPTY_MANIFEST;
    const parsed = manifestSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("[assets] manifest.json не прошёл проверку, используются заглушки", parsed.error.issues);
      return EMPTY_MANIFEST;
    }
    return parsed.data;
  } catch {
    return EMPTY_MANIFEST;
  }
}

/** Все картинки из манифеста — для предзагрузки (видео грузятся отдельно, по требованию). */
export function manifestFiles(m: AssetManifest, characters?: Iterable<string>): string[] {
  const files = new Set<string>();
  const only = characters ? new Set(characters) : null;
  for (const f of Object.values(m.backgrounds)) if (f) files.add(f);
  for (const [key, c] of Object.entries(m.characters)) {
    // Грузим только персонажей этого дела: из 15 нарисованных на сцене максимум 9
    if (only && !only.has(key)) continue;
    if (c.idle) files.add(c.idle);
    for (const f of [...Object.values(c.emotions), ...c.walk, ...Object.values(c.moods)]) files.add(f);
  }
  for (const f of Object.values(m.objects)) files.add(f);
  return [...files];
}
