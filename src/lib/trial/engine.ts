import { ProviderError, type AskRequest, type Attachment, type ModelProvider, type Usage } from "../providers/types";
import type { z } from "zod";
import type { Aggregate, TrialEvent } from "./events";
import { checkCalculations, formatCalculation } from "./calc";
import { askJson, type AskJsonOptions } from "./json";
import { loadPrompt, participantPersona, participantSystemPrompt, renderCaseFile, renderMedia } from "./prompts";
import {
  ROLE_TITLES,
  isDebater,
  judgeOutputSchema,
  judgeRevisionSchema,
  participantAnswerSchema,
  secretaryDecisionSchema,
  secretaryPrepareSchema,
  type CaseFile,
  type Media,
  type ModelRef,
  type Participant,
  type ParticipantAnswer,
  type ParticipantResponse,
  type PriorRecommendationReview,
  type SecretaryDecision,
  type SecretaryPrepare,
  type Verdict,
} from "./schemas";
import { aggregate, capConfidence, decideStop, defendantMood, type StopDecision } from "./stats";

export interface TrialSettings {
  minRounds: number;
  maxRounds: number;
  spreadThreshold: number;
  roleWeights: { prosecutor: number; defense: number; witness: number; juror: number };
}

export interface TrialDeps {
  getModel(ref: ModelRef): ModelProvider;
  emit(event: TrialEvent): void;
  onUsage?(usage: Usage): void;
  json?: AskJsonOptions;
}

export class TrialError extends Error {}

/**
 * Запрос с картинками; если модель их не принимает (400), повторяем без них —
 * текстовое описание вложений и так есть в материалах дела.
 */
async function askWithVisuals<T>(
  model: ModelProvider,
  schema: z.ZodType<T>,
  req: Omit<AskRequest, "jsonSchema">,
  attachments: Attachment[] | undefined,
  opts: TrialDeps["json"],
): Promise<T> {
  if (!attachments?.length) return askJson(model, schema, req, opts);
  try {
    return await askJson(model, schema, { ...req, attachments }, opts);
  } catch (e) {
    if (e instanceof ProviderError && !e.retryable && (e.status === 400 || e.status === undefined)) {
      return askJson(model, schema, req, opts);
    }
    throw e;
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ---------------- Подготовка ---------------- */

export async function prepareCase(
  input: { materialText: string; comment: string; media?: Media[]; attachments?: Attachment[] },
  secretary: ModelRef,
  deps: Pick<TrialDeps, "getModel" | "onUsage" | "json">,
): Promise<SecretaryPrepare> {
  const content = [
    input.materialText.trim() ? `## Материал\n<<<\n${input.materialText}\n>>>` : "",
    ...(input.media ?? []).map((m, i) => renderMedia(m, i + 1)),
    input.comment.trim() ? `## Показания к делу (комментарий заказчика)\n${input.comment}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return askWithVisuals(
    deps.getModel(secretary),
    secretaryPrepareSchema,
    { system: loadPrompt("secretary-prepare"), messages: [{ role: "user", content }], onUsage: deps.onUsage },
    input.attachments,
    deps.json,
  );
}

/* ---------------- Заседание ---------------- */

interface Position {
  round: number;
  response: ParticipantResponse;
}

function formatPosition(p: Participant, pos: Position, currentRound: number): string {
  const stale = pos.round < currentRound - 1 ? ` (позиция из заседания №${pos.round}, в последнем отсутствовал)` : "";
  const r = pos.response;
  return [
    `### ${p.name} — ${ROLE_TITLES[p.role]}${p.specialization ? `, ${p.specialization}` : ""}${stale}`,
    `Оценка: ${r.score}${r.plan_quality !== undefined ? ` · качество плана: ${r.plan_quality}` : ""}`,
    `Тезис: ${r.stance}`,
    `Речь: ${r.speech}`,
    r.calculations?.length ? `Расчёты (посчитаны кодом):\n${r.calculations.map((c) => `- ${formatCalculation(c)}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Установленные факты — общий список секретаря, который участникам запрещено пересказывать. */
const MAX_FACTS = 10;
const renderFacts = (facts: string[]) => facts.map((f) => `- ${f}`).join("\n");

/** Тезисы прошлых заседаний — секретарю, чтобы отличать новые доводы от повторов. */
function earlierTheses(earlier: { round: number; speeches: { p: Participant; r: ParticipantResponse }[] }[]): string {
  if (!earlier.length) return "";
  return `# Тезисы прошлых заседаний\n\n${earlier
    .map((h) => `## Заседание №${h.round}\n${h.speeches.map(({ p, r }) => `- ${p.name}: ${r.score} — ${r.stance}`).join("\n")}`)
    .join("\n\n")}\n\n`;
}

/** Ответ модели → реплика протокола: точное имя в reacts_to (неизвестные отбрасываются) и расчёты, посчитанные кодом. */
function toResponse(answer: ParticipantAnswer, self: Participant, all: Participant[]): ParticipantResponse {
  const { calculations, ...r } = answer;
  const checked = calculations?.length ? { calculations: checkCalculations(calculations) } : {};
  if (!r.reacts_to) return { ...r, ...checked };
  const target = r.reacts_to.trim().toLowerCase();
  const match = all.find((p) => p.id !== self.id && (p.name.toLowerCase() === target || target.includes(p.name.toLowerCase())));
  return { ...r, ...checked, reacts_to: match?.name };
}

const STOP_REASONS: Record<StopDecision["rule"], string> = {
  min_rounds: "Минимальное число заседаний ещё не проведено.",
  max_rounds: "Достигнут лимит заседаний.",
  consensus: "Мнения сторон сблизились: разброс оценок ниже порога.",
  no_new_arguments: "Новых аргументов не прозвучало.",
  new_arguments: "Оценки сблизились, но прозвучали новые доводы — суд обязан их обсудить.",
  continue: "Стороны не пришли к согласию, прения продолжаются.",
};

const outcome = (d: StopDecision) => (d.stop ? "закрываются" : "продолжаются");

/**
 * Что секретарь должен знать о решении ещё до того, как его напишет: код решает об остановке заранее.
 * Если исход не зависит от новизны доводов, секретарь его только объясняет; иначе — видит оба исхода
 * и выбирает между ними своей оценкой new_arguments. Так текст секретаря не может разойтись с регламентом.
 */
function stopOutcomeRules(ifNew: StopDecision, ifNone: StopDecision): string {
  if (ifNew.stop === ifNone.stop) {
    return `Решение по регламенту уже принято: слушания ${outcome(ifNew)}. ${STOP_REASONS[ifNew.rule]}\nНе предлагай другого исхода: в \`reason\` объясни именно это решение.`;
  }
  return [
    "Исход зависит только от твоей оценки новизны доводов:",
    `- если новые доводы прозвучали (\`new_arguments\` = true), слушания ${outcome(ifNew)};`,
    `- если нет (\`new_arguments\` = false), слушания ${outcome(ifNone)}.`,
    "`reason` должен объяснять исход, который следует из твоего `new_arguments`.",
  ].join("\n");
}

export interface TrialInput {
  caseFile: CaseFile;
  participants: Participant[];
  settings: TrialSettings;
  /** Картинки и кадры видео для моделей со зрением */
  attachments?: Attachment[];
  /** Дополнительный контекст для всех (например, условия апелляции и итоги первого слушания) */
  context?: string;
  /** Повторное рассмотрение: номер версии и прошлые советы суда, по которым судья обязан отчитаться */
  revision?: { version: number; previousRecommendations: string[] };
}

const modelKey = (m: ModelRef) => `${m.providerId}:${m.modelId}`;

/**
 * Первое заседание с прогревом кэша: на каждой модели один участник отвечает первым и записывает
 * общий системный промпт (правила + материалы дела) в кэш провайдера, остальные идут следом и читают его.
 * Разные модели работают параллельно. Результаты — в исходном порядке участников.
 */
async function warmCacheFirst<T>(items: Participant[], run: (p: Participant) => Promise<T>): Promise<T[]> {
  const groups = new Map<string, number[]>();
  items.forEach((p, i) => groups.set(modelKey(p.model!), [...(groups.get(modelKey(p.model!)) ?? []), i]));
  const out = new Array<T>(items.length);
  await Promise.all(
    [...groups.values()].map(async ([first, ...rest]) => {
      out[first] = await run(items[first]);
      await Promise.all(rest.map(async (i) => (out[i] = await run(items[i]))));
    }),
  );
  return out;
}

export interface TrialResult {
  verdict: Verdict;
  rounds: number;
}

/**
 * Полный цикл заседания: слепое заседание → дебаты → решение об остановке после каждого → вердикт.
 * Падение одного участника не роняет процесс: он помечается отсутствующим.
 */
export async function runTrial(input: TrialInput, deps: TrialDeps): Promise<TrialResult> {
  const { caseFile, participants, settings } = input;
  const debaters = participants.filter(isDebater);
  const secretary = participants.find((p) => p.role === "secretary");
  const judge = participants.find((p) => p.role === "judge");
  if (!secretary?.model || !judge?.model) throw new TrialError("Не назначены модели секретаря и судьи");
  if (!debaters.length) throw new TrialError("В составе суда нет ни одного выступающего");
  const missing = debaters.filter((d) => !d.model);
  if (missing.length) throw new TrialError(`Не назначена модель: ${missing.map((m) => m.name).join(", ")}`);

  const tokens = { input: 0, output: 0, cached: 0 };
  const onUsage = (u: Usage) => {
    tokens.input += u.inputTokens;
    tokens.output += u.outputTokens;
    tokens.cached += u.cachedInputTokens ?? 0;
    deps.onUsage?.(u);
  };
  const caseText = input.context ? `${renderCaseFile(caseFile)}\n\n---\n\n${input.context}` : renderCaseFile(caseFile);
  // Общий для всех выступающих и всех заседаний — кэшируется провайдером
  const debaterSystem = participantSystemPrompt(participants, caseText);
  const latest = new Map<string, Position>();
  const history: { round: number; speeches: { p: Participant; r: ParticipantResponse }[]; decision?: string }[] = [];
  let prevMean: number | null = null;
  let lastAggregate: Aggregate | null = null;
  let consensusBefore = false;
  let facts: string[] = [];

  deps.emit({
    type: "session_open",
    text: input.revision
      ? `Встать, суд идёт! Повторно слушается дело «${caseFile.title}» — версия ${input.revision.version}. Председательствует ${judge.name}.`
      : `Встать, суд идёт! Слушается дело «${caseFile.title}». Председательствует ${judge.name}.`,
  });

  let round = 0;
  for (round = 1; round <= settings.maxRounds; round++) {
    deps.emit({
      type: "round_start",
      round,
      text:
        round === 1
          ? "Заседание №1 объявляется открытым. Слепое заседание: стороны высказываются независимо."
          : `Заседание №${round} объявляется открытым. Стороны переходят к прениям.`,
    });

    const roundPrompt = (p: Participant) => {
      if (round === 1) return loadPrompt("round-blind", { round });
      const own = latest.get(p.id);
      const others = debaters
        .filter((o) => o.id !== p.id && latest.has(o.id))
        .map((o) => formatPosition(o, latest.get(o.id)!, round))
        .join("\n\n");
      return loadPrompt("round-debate", {
        round,
        facts: facts.length ? renderFacts(facts) : "Пока не установлено.",
        own_position: own ? formatPosition(p, own, round) : "В прошлых заседаниях ты не выступал.",
        others: others || "Остальные участники позиций не представили.",
      });
    };

    const speak = async (p: Participant): Promise<{ p: Participant; response: ParticipantResponse | null }> => {
      try {
        const answer = await askWithVisuals(
          deps.getModel(p.model!),
          participantAnswerSchema,
          {
            system: debaterSystem,
            cacheSystem: true,
            messages: [{ role: "user", content: `${participantPersona(p)}\n\n---\n\n${roundPrompt(p)}` }],
            onUsage,
          },
          input.attachments,
          deps.json,
        );
        const response = toResponse(answer, p, participants);
        // Порядок событий = порядок ответов: кто раньше ответил, тот раньше выступает.
        deps.emit({ type: "speech", round, participantId: p.id, response });
        return { p, response };
      } catch (e) {
        deps.emit({ type: "absent", round, participantId: p.id, reason: errorText(e) });
        return { p, response: null };
      }
    };
    // В первом заседании кэш ещё пуст — прогреваем; дальше он уже тёплый, все говорят параллельно
    const results = round === 1 ? await warmCacheFirst(debaters, speak) : await Promise.all(debaters.map(speak));

    const speeches = results.filter(
      (r): r is { p: Participant; response: ParticipantResponse } => r.response !== null,
    );
    for (const s of speeches) latest.set(s.p.id, { round, response: s.response });
    history.push({ round, speeches: speeches.map((s) => ({ p: s.p, r: s.response })) });

    if (!latest.size) throw new TrialError("Ни один участник не явился на заседание: проверьте подключение провайдеров");

    const scored = debaters
      .filter((d) => latest.has(d.id))
      .map((d) => ({ id: d.id, score: latest.get(d.id)!.response.score, weight: settings.roleWeights[d.role] }));
    const agg = aggregate(scored);
    lastAggregate = agg;
    deps.emit({
      type: "round_summary",
      round,
      scores: Object.fromEntries(scored.map((s) => [s.id, s.score])),
      aggregate: agg,
      defendantMood: defendantMood(agg.mean, prevMean),
      tokens: { ...tokens },
    });
    prevMean = agg.mean;

    // Решение об остановке принимает код, причём заранее: секретарь оценивает только новизну доводов
    // и объясняет исход, который ему уже известен. В заседании №1 все доводы новые по определению.
    const stopInput = {
      round,
      minRounds: settings.minRounds,
      maxRounds: settings.maxRounds,
      std: agg.std,
      spreadThreshold: settings.spreadThreshold,
      consensusBefore,
    };
    const ifNew = decideStop({ ...stopInput, newArguments: round === 1 ? null : true });
    const ifNone = round === 1 ? ifNew : decideStop({ ...stopInput, newArguments: false });

    let secretaryDecision: SecretaryDecision | null = null;
    if (speeches.length) {
      try {
        secretaryDecision = await askJson(
          deps.getModel(secretary.model),
          secretaryDecisionSchema,
          {
            system: loadPrompt("secretary-decision", {
              round,
              std: agg.std,
              threshold: settings.spreadThreshold,
              outcome_rules: stopOutcomeRules(ifNew, ifNone),
              max_facts: MAX_FACTS,
            }),
            messages: [
              {
                role: "user",
                content: `${caseText}\n\n---\n\n${earlierTheses(history.slice(0, -1))}# Установленные факты\n\n${
                  facts.length ? renderFacts(facts) : "Пока не установлено."
                }\n\n# Протокол заседания №${round}\n\n${speeches
                  .map((s) => formatPosition(s.p, { round, response: s.response }, round))
                  .join("\n\n")}`,
              },
            ],
            onUsage,
          },
          deps.json,
        );
      } catch {
        secretaryDecision = null; // секретарь не ответил — решает код по правилам
      }
    }

    if (secretaryDecision) facts = secretaryDecision.established_facts.slice(0, MAX_FACTS);

    const stop: StopDecision = !speeches.length
      ? { stop: true, rule: "no_new_arguments" } // все отсутствовали — прения бессмысленны
      : !secretaryDecision
        ? decideStop({ ...stopInput, newArguments: null }) // секретарь не ответил — решает код по правилам
        : secretaryDecision.new_arguments
          ? ifNew
          : ifNone;

    let reason = secretaryDecision?.reason ?? STOP_REASONS[stop.rule];
    if (!speeches.length) reason = "Никто из участников не явился на заседание. Слушания закрываются.";

    deps.emit({
      type: "secretary_decision",
      round,
      decision: stop.stop ? "close" : "continue",
      newArguments: secretaryDecision?.new_arguments ?? speeches.length > 0,
      reason,
    });
    history[history.length - 1].decision = reason;
    consensusBefore = agg.std < settings.spreadThreshold;
    if (stop.stop) break;
  }
  const roundsHeld = Math.min(round, settings.maxRounds);

  // Вердикт
  deps.emit({ type: "judge_start", text: "Слушания закрыты. Суд удаляется для вынесения вердикта." });
  const agg = lastAggregate!;
  const protocol = history
    .map(
      (h) =>
        `# Заседание №${h.round}\n\n${h.speeches
          .map(({ p, r }) =>
            [
              formatPosition(p, { round: h.round, response: r }, h.round),
              r.changed_score_because ? `Изменение оценки: ${r.changed_score_because}` : "",
              `Аудитории: ${r.audience_guess.map((a) => `${a.segment} (${a.age_from}–${a.age_to})`).join("; ") || "—"}`,
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n")}${h.decision ? `\n\n**Решение секретаря:** ${h.decision}` : ""}`,
    )
    .join("\n\n");
  const prior = input.revision?.previousRecommendations ?? [];
  const judgeSchema = prior.length ? judgeRevisionSchema(prior.length) : judgeOutputSchema;
  // Качество плана — по последним репликам, где оно есть (в старых протоколах его нет)
  const quality = debaters
    .filter((d) => latest.get(d.id)?.response.plan_quality !== undefined)
    .map((d) => ({ score: latest.get(d.id)!.response.plan_quality!, weight: settings.roleWeights[d.role] }));
  const qualityAgg = quality.some((q) => q.weight > 0) ? aggregate(quality) : null;
  const judgeReq = {
    system: loadPrompt("judge", {
      success_score: agg.median,
      score_min: agg.min,
      score_max: agg.max,
      std: agg.std,
      plan_quality: qualityAgg
        ? `**${qualityAgg.median}** из 100, разброс от ${qualityAgg.min} до ${qualityAgg.max}`
        : "участники её не выставили",
      revision_rules: prior.length ? loadPrompt("judge-revision", { count: prior.length }) : "",
    }),
    messages: [
      {
        role: "user" as const,
        content: `${caseText}\n\n---\n\n${protocol}${facts.length ? `\n\n# Установленные факты (итог секретаря)\n\n${renderFacts(facts)}` : ""}`,
      },
    ],
    onUsage,
  };

  let judged;
  try {
    judged = await askWithVisuals(deps.getModel(judge.model), judgeSchema, judgeReq, input.attachments, deps.json);
  } catch (e) {
    // Судья не справился — вердикт выносит секретарь, чтобы дело не пропало.
    if (judge.model.providerId === secretary.model.providerId && judge.model.modelId === secretary.model.modelId) {
      throw new TrialError(`Судья не смог вынести вердикт: ${errorText(e)}`);
    }
    try {
      judged = await askWithVisuals(deps.getModel(secretary.model), judgeSchema, judgeReq, input.attachments, deps.json);
    } catch (e2) {
      throw new TrialError(`Судья не смог вынести вердикт: ${errorText(e)}; замена секретарём: ${errorText(e2)}`);
    }
  }

  const { prior_recommendations: priorRaw, ...judgedRest } = judged as typeof judged & {
    prior_recommendations?: { index: number; position: PriorRecommendationReview["position"]; explanation: string }[];
  };
  const verdict: Verdict = {
    ...judgedRest,
    confidence: capConfidence(judged.confidence, agg.std),
    success_score: Math.round(agg.median),
    score_range: [agg.min, agg.max],
    ...(qualityAgg ? { plan_quality: Math.round(qualityAgg.median), plan_quality_range: [qualityAgg.min, qualityAgg.max] as [number, number] } : {}),
    ...(priorRaw
      ? {
          prior_recommendations: [...priorRaw]
            .sort((a, b) => a.index - b.index)
            .map((r) => ({ change: prior[r.index - 1], position: r.position, explanation: r.explanation })),
        }
      : {}),
  };
  deps.emit({ type: "verdict", verdict });
  return { verdict, rounds: roundsHeld };
}
