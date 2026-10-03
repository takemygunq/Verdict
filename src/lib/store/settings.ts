import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db";

const modelRef = z.object({ providerId: z.string(), modelId: z.string() }).nullable();

export const settingsSchema = z.object({
  /** Модель секретаря (оркестратора) по умолчанию */
  secretaryModel: modelRef.default(null),
  /** Модель судьи по умолчанию */
  judgeModel: modelRef.default(null),
  minRounds: z.number().int().min(1).max(10).default(2),
  maxRounds: z.number().int().min(1).max(10).default(5),
  /** Консенсус: стандартное отклонение оценок ниже порога (и нет новых доводов) */
  spreadThreshold: z.number().min(0).max(50).default(6),
  /** Лимит бюджета на одно дело, $ */
  budgetUsd: z.number().min(0).default(2),
  /** Веса ролей при агрегации оценки (взвешенная медиана) */
  roleWeights: z
    .object({
      prosecutor: z.number().min(0).max(2),
      defense: z.number().min(0).max(2),
      witness: z.number().min(0).max(2),
      juror: z.number().min(0).max(2),
    })
    .default({ prosecutor: 0.75, defense: 0.75, witness: 1, juror: 1 }),
  /** Модель расшифровки речи в видео (OpenAI) */
  transcriptionModel: z.string().trim().min(1).default("whisper-1"),
  sound: z.boolean().default(true),
  animationSpeed: z.number().min(0.5).max(2).default(1),
  fastMode: z.boolean().default(false),
});

export type Settings = z.infer<typeof settingsSchema>;

const KEY = "app";

export function getSettings(): Settings {
  const row = db().select().from(schema.settings).where(eq(schema.settings.key, KEY)).get();
  const raw = row ? JSON.parse(row.value) : {};
  const parsed = settingsSchema.safeParse(raw);
  // Если сохранённые настройки повреждены или устарели — откатываемся к значениям по умолчанию.
  return parsed.success ? parsed.data : settingsSchema.parse({});
}

/** patch — непроверенные данные; валидируется вся итоговая структура целиком. */
export function saveSettings(patch: Partial<Settings> | Record<string, unknown>): Settings {
  const next = settingsSchema
    .refine((s) => s.minRounds <= s.maxRounds, { message: "Минимум заседаний больше максимума" })
    .parse({ ...getSettings(), ...patch });
  db()
    .insert(schema.settings)
    .values({ key: KEY, value: JSON.stringify(next) })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: JSON.stringify(next) } })
    .run();
  return next;
}
