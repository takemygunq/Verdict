import { z } from "zod";
import type { CheckedCalculation } from "./calc";

/* ---------- Ответы моделей (валидируются zod, в провайдеры уходят как JSON Schema) ---------- */

export const EMOTIONS = ["calm", "confident", "angry", "skeptical", "surprised", "laughing", "thinking", "sad"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const MATERIAL_TYPES = ["text_ad", "image_ad", "video_ad", "strategy", "media_plan", "other"] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

const score = z.number().min(0).max(100);
const age = z.number().int().min(0).max(120);

export const audienceGuessSchema = z.object({ segment: z.string(), age_from: age, age_to: age });

/** Расчёт участника: выражение посчитает код, модель только записывает его и допущения. */
export const calculationSchema = z.object({
  label: z.string().min(1),
  expression: z.string().min(1),
  assumptions: z.string(),
});

/** Ответ модели-участника. Расчёты в нём ещё не проверены — см. ParticipantResponse. */
export const participantAnswerSchema = z
  .object({
    score,
    plan_quality: score,
    stance: z.string().min(1),
    speech: z.string().min(1),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    audience_guess: z.array(audienceGuessSchema),
    responses_to_others: z
      .array(z.object({ participant: z.string(), agree: z.boolean(), argument: z.string() }))
      .optional(),
    changed_score_because: z.string().optional(),
    emotion: z.enum(EMOTIONS),
    intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    reacts_to: z.string().optional(),
    calculations: z.array(calculationSchema).optional(),
  })
  .meta({ title: "participant_response" });
export type ParticipantAnswer = z.infer<typeof participantAnswerSchema>;

/**
 * Реплика в протоколе: ответ модели с расчётами, пересчитанными кодом.
 * `plan_quality` нет в репликах, записанных до появления второй оценки.
 */
export type ParticipantResponse = Omit<ParticipantAnswer, "calculations" | "plan_quality"> & {
  plan_quality?: number;
  calculations?: CheckedCalculation[];
};

const persona = z.object({ name: z.string().min(1), character: z.string().min(1) });

/** Ответ секретаря на этапе подготовки: материалы дела + состав суда. */
export const secretaryPrepareSchema = z
  .object({
    title: z.string().min(1),
    material_type: z.enum(MATERIAL_TYPES),
    summary: z.string().min(1),
    key_facts: z.array(z.string()),
    prosecutor: persona,
    defense: persona,
    witness: persona.extend({ segment: z.string().min(1), age: age }),
    jurors: z.array(persona.extend({ specialization: z.string().min(1) })).min(2).max(4),
  })
  .meta({ title: "secretary_prepare" });
export type SecretaryPrepare = z.infer<typeof secretaryPrepareSchema>;

/** Решение секретаря после заседания. */
export const secretaryDecisionSchema = z
  .object({
    new_arguments: z.boolean(),
    reason: z.string().min(1),
    /** Полный обновлённый список фактов, в которых стороны уже сошлись: участникам запрещено их пересказывать */
    established_facts: z.array(z.string()),
  })
  .meta({ title: "secretary_decision" });
export type SecretaryDecision = z.infer<typeof secretaryDecisionSchema>;

const level = z.enum(["high", "medium", "low"]);

/** То, что пишет судья. success_score и score_range считает код, а не модель. */
export const judgeOutputSchema = z
  .object({
    confidence: z.enum(["low", "medium", "high"]),
    outcome: z.enum(["acquitted", "conditional", "guilty"]),
    verdict_speech: z.string().min(1),
    verdict: z.string().min(1),
    audiences: z.array(
      z.object({ segment: z.string(), age_from: age, age_to: age, fit: score, why: z.string() }),
    ),
    improvements: z.array(
      z.object({
        change: z.string(),
        why: z.string(),
        impact: level,
        effort: level,
        /** true — без этого запускать нельзя; false — можно доработать по ходу кампании */
        blocking: z.boolean(),
      }),
    ),
    risks: z.array(z.string()),
    dissent: z.array(z.string()),
  })
  .meta({ title: "judge_verdict" });
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;

/* ---------- Повторное рассмотрение ---------- */

/** Что секретарь установил о прошлом совете суда, сравнив версии */
export const IMPLEMENTATION_STATUSES = ["implemented", "partial", "not_implemented"] as const;
export type ImplementationStatus = (typeof IMPLEMENTATION_STATUSES)[number];

/** Ответ секретаря: чем новая версия отличается от прошлой и что стало с советами суда. */
export const revisionCompareSchema = z
  .object({
    changes: z.array(z.string().min(1)),
    recommendations: z.array(
      z.object({ index: z.number().int(), status: z.enum(IMPLEMENTATION_STATUSES), evidence: z.string() }),
    ),
  })
  .meta({ title: "revision_compare" });
export type RevisionCompare = z.infer<typeof revisionCompareSchema>;

/** Позиция суда по прошлому совету */
export const PRIOR_POSITIONS = ["kept", "done", "revised", "withdrawn"] as const;
export type PriorPosition = (typeof PRIOR_POSITIONS)[number];

const priorReviewItem = z.object({ index: z.number().int(), position: z.enum(PRIOR_POSITIONS), explanation: z.string().min(1) });

/**
 * Вердикт при повторном рассмотрении: судья обязан высказаться по каждому прошлому совету (1..count).
 * Проверка на полноту — в коде: если пропущен совет, askJson повторит запрос с текстом ошибки.
 */
export function judgeRevisionSchema(count: number) {
  return judgeOutputSchema
    .extend({ prior_recommendations: z.array(priorReviewItem) })
    .superRefine((v, ctx) => {
      const seen = v.prior_recommendations.map((r) => r.index).sort((a, b) => a - b);
      const expected = Array.from({ length: count }, (_, i) => i + 1);
      if (seen.join(",") !== expected.join(",")) {
        ctx.addIssue({
          code: "custom",
          path: ["prior_recommendations"],
          message: `Нужно ровно по одному пункту на каждый прошлый совет с index от 1 до ${count}; получено: [${seen.join(", ")}]`,
        });
      }
    })
    .meta({ title: "judge_verdict" });
}

export interface PriorRecommendationReview {
  change: string;
  position: PriorPosition;
  explanation: string;
}

export type Verdict = Omit<JudgeOutput, "improvements"> & {
  /** `blocking` нет в вердиктах, вынесенных до разделения советов по срочности */
  improvements: (Omit<JudgeOutput["improvements"][number], "blocking"> & { blocking?: boolean })[];
  success_score: number;
  score_range: [number, number];
  /** Качество проработки плана — отдельно от вероятности успеха. Нет в старых вердиктах. */
  plan_quality?: number;
  plan_quality_range?: [number, number];
  /** Только при повторном рассмотрении: что суд думает о своих прошлых советах */
  prior_recommendations?: PriorRecommendationReview[];
};

/* ---------- Данные дела ---------- */

export const modelRefSchema = z.object({ providerId: z.string(), modelId: z.string() });
export type ModelRef = z.infer<typeof modelRefSchema>;

export const ROLES = ["secretary", "judge", "prosecutor", "defense", "witness", "juror"] as const;
export type Role = (typeof ROLES)[number];
export type DebaterRole = Exclude<Role, "secretary" | "judge">;

export const participantSchema = z.object({
  id: z.string(),
  role: z.enum(ROLES),
  name: z.string().trim().min(1),
  specialization: z.string().default(""),
  character: z.string().default(""),
  model: modelRefSchema.nullable(),
});
export type Participant = z.infer<typeof participantSchema>;

/** Обработанное вложение: описание картинки, раскадровка видео, текст документа. */
export const mediaSchema = z.object({
  fileId: z.string(),
  kind: z.enum(["image", "video", "document"]),
  name: z.string(),
  /** Подробное описание для моделей без зрения (картинки и видео) */
  description: z.string().default(""),
  /** Видео: раскадровка с таймкодами */
  storyboard: z.array(z.object({ time: z.string(), description: z.string() })).default([]),
  /** Видео: расшифровка речи */
  transcript: z.string().default(""),
  /** Документ: извлечённый текст */
  text: z.string().default(""),
  /** Видео: ключевые кадры (имена файлов) — их увидят модели со зрением */
  frames: z.array(z.string()).default([]),
  /** Что не удалось обработать */
  warnings: z.array(z.string()).default([]),
});
export type Media = z.infer<typeof mediaSchema>;

/** Материалы дела: то, что видят все участники. Редактируется пользователем перед заседанием. */
export const caseFileSchema = z
  .object({
    title: z.string().trim().min(1),
    material_type: z.enum(MATERIAL_TYPES),
    summary: z.string(),
    key_facts: z.array(z.string()),
    material_text: z.string(),
    comment: z.string(),
    media: z.array(mediaSchema).default([]),
  })
  .refine((c) => c.material_text.trim() || c.media.length, { message: "Материалы дела пусты: нет ни текста, ни вложений" });
export type CaseFile = z.infer<typeof caseFileSchema>;

/* ---------- Апелляция и фактический результат ---------- */

/** Апелляция: слушание под зафиксированную аудиторию. */
export const appealSchema = z
  .object({
    segment: z.string().trim().min(1, "Укажите аудиторию").max(200),
    age_from: z.number().int().min(0).max(120),
    age_to: z.number().int().min(0).max(120),
    note: z.string().trim().max(2000).default(""),
  })
  .refine((a) => a.age_from <= a.age_to, { message: "Возраст «от» больше, чем «до»" });
export type Appeal = z.infer<typeof appealSchema>;

const metric = z.number().min(0).nullable().default(null);

/** Что получилось на самом деле — чтобы сравнивать прогнозы суда с реальностью. */
export const actualResultSchema = z.object({
  /** CTR, % */
  ctr: metric,
  /** Конверсия, % */
  conversion: metric,
  /** Продажи, шт. или ₽ — как удобно */
  sales: metric,
  note: z.string().trim().max(5000).default(""),
});
export type ActualResult = z.infer<typeof actualResultSchema>;

export const hasActualResult = (r: ActualResult | null | undefined) =>
  !!r && (r.ctr !== null || r.conversion !== null || r.sales !== null || r.note.length > 0);

/** Повторное рассмотрение: связь с прошлой версией и снимок того, что о ней известно. */
export const revisionSchema = z.discriminatedUnion("status", [
  /** Пользователь ответил, что это не новая версия — больше не предлагать */
  z.object({ status: z.literal("dismissed") }),
  z.object({
    status: z.literal("linked"),
    previousId: z.string(),
    version: z.number().int().min(2),
    previous: z.object({
      title: z.string(),
      score: z.number().nullable(),
      /** Качество плана прошлой версии; нет у версий, оценённых до появления второй оценки */
      planQuality: z.number().nullable().optional(),
      outcome: z.enum(["acquitted", "conditional", "guilty"]).nullable(),
      createdAt: z.number(),
    }),
    /** Сравнение секретаря; пусто, пока сравнение не выполнено */
    changes: z.array(z.string()).default([]),
    recommendations: z
      .array(
        z.object({
          change: z.string(),
          why: z.string().default(""),
          /** null — секретарь не смог сравнить версии */
          status: z.enum(IMPLEMENTATION_STATUSES).nullable(),
          evidence: z.string().default(""),
        }),
      )
      .default([]),
  }),
]);
export type Revision = z.infer<typeof revisionSchema>;
export type LinkedRevision = Extract<Revision, { status: "linked" }>;

/* ---------- Обработка материалов ---------- */

export const imageDescriptionSchema = z
  .object({
    description: z.string().min(1),
    visible_text: z.string(),
  })
  .meta({ title: "image_description" });
export type ImageDescription = z.infer<typeof imageDescriptionSchema>;

export const videoAnalysisSchema = z
  .object({
    description: z.string().min(1),
    storyboard: z.array(z.object({ time: z.string(), description: z.string() })),
    transcript: z.string(),
  })
  .meta({ title: "video_analysis" });
export type VideoAnalysis = z.infer<typeof videoAnalysisSchema>;

export const MATERIAL_TYPE_TITLES: Record<MaterialType, string> = {
  text_ad: "Рекламный текст",
  image_ad: "Баннер / картинка",
  video_ad: "Рекламное видео",
  strategy: "Стратегия",
  media_plan: "Медиаплан",
  other: "Другое",
};

export const ROLE_TITLES: Record<Role, string> = {
  secretary: "Секретарь суда",
  judge: "Судья",
  prosecutor: "Прокурор",
  defense: "Адвокат защиты",
  witness: "Свидетель",
  juror: "Присяжный",
};

export const isDebater = (p: Participant): p is Participant & { role: DebaterRole } =>
  p.role !== "secretary" && p.role !== "judge";
