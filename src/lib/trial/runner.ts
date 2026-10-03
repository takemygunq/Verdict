import { EventEmitter } from "node:events";
import {
  addTokens,
  appendEvent,
  clearEvents,
  createCase,
  getCase,
  rootCaseId,
  listCasesInStatus,
  transitionStatus,
  updateCase,
} from "../store/cases";
import { hasFfmpeg } from "../materials/ffmpeg";
import { caseFilePath, listCaseFiles } from "../materials/files";
import { processMaterials } from "../materials/process";
import { visualAttachments } from "../materials/visuals";
import { transcribeAudio } from "../providers/openai";
import { adapterFor } from "../providers/registry";
import type { Usage } from "../providers/types";
import { listProviders, modelProvider, providerConfig, type ProviderView } from "../store/providers";
import { getSettings, type Settings } from "../store/settings";
import { appealContextFor, appealParticipants } from "./appeal";
import { prepareCase, runTrial } from "./engine";
import type { StoredEvent, TrialEvent } from "./events";
import { compareVersions, RevisionError, revisionFor, reuseParticipants, revisionSnapshot } from "./revision";
import { buildParticipants, officialsModels } from "./roster";
import { appealSchema, type Appeal, type CaseFile, type Media, type ModelRef } from "./schemas";

/**
 * Серверная оркестрация: подготовка дела, запуск заседания в фоне, журнал событий и рассылка подписчикам SSE.
 * Состояние процесса живёт в globalThis, чтобы переживать hot reload в dev.
 */
const g = globalThis as unknown as { verdictBus?: EventEmitter; verdictRecovered?: boolean };
const bus = (g.verdictBus ??= new EventEmitter().setMaxListeners(100));

export class CaseStateError extends Error {}

/** Дела, которые остались в процессе после перезапуска сервера, помечаются прерванными. */
function recoverOnce() {
  if (g.verdictRecovered) return;
  g.verdictRecovered = true;
  for (const c of listCasesInStatus(["preparing", "running"])) {
    if (c.status === "preparing") {
      updateCase(c.id, { status: "draft", error: "Подготовка прервана перезапуском сервера" });
    } else {
      appendEvent(c.id, { type: "error", message: "Заседание прервано перезапуском сервера" });
      appendEvent(c.id, { type: "trial_end", status: "failed" });
      updateCase(c.id, { status: "failed", error: "Заседание прервано перезапуском сервера" });
    }
  }
}

export function subscribe(caseId: string, listener: (e: StoredEvent) => void): () => void {
  bus.on(caseId, listener);
  return () => bus.off(caseId, listener);
}

function emit(caseId: string, event: TrialEvent) {
  bus.emit(caseId, appendEvent(caseId, event));
}

const getModel = (ref: ModelRef) => modelProvider(ref.providerId, ref.modelId);
const usage = (caseId: string) => (u: Usage) => addTokens(caseId, u.inputTokens, u.outputTokens, u.cachedInputTokens ?? 0);

/** Подготовка в процессе: обработка файлов, затем секретарь формирует материалы дела и состав суда. */
async function runPrepare(caseId: string) {
  const progress = (text: string | null) => updateCase(caseId, { progress: text });
  try {
    const c = getCase(caseId);
    const settings = getSettings();
    const providers = listProviders();
    const models = officialsModels(providers, settings);
    const files = listCaseFiles(caseId);

    let media: Media[] = [];
    let materialText = c.materialText;
    if (files.length) {
      const processed = await processMaterials(caseId, files, c.comment, {
        getModel,
        vision: models.secretary,
        video: videoModel(providers),
        transcribe: transcriber(providers, settings),
        ffmpeg: await hasFfmpeg(),
        filePath: (id) => caseFilePath(caseId, id)!.path,
        onProgress: progress,
        onUsage: usage(caseId),
      });
      media = processed.media;
      materialText = [c.materialText, processed.extraText].filter((t) => t.trim()).join("\n\n");
    }

    progress("Секретарь изучает материалы дела и подбирает состав суда");
    const prep = await prepareCase(
      { materialText, comment: c.comment, media, attachments: visualAttachments(caseId, media) },
      models.secretary,
      { getModel, onUsage: usage(caseId) },
    );
    const caseFile: CaseFile = {
      title: prep.title,
      material_type: prep.material_type,
      summary: prep.summary,
      key_facts: prep.key_facts,
      material_text: materialText,
      comment: c.comment,
      media,
    };
    let participants = buildParticipants(prep, models);
    let revision = null;
    if (c.previousId) {
      // Новая версия рассмотренного дела: тот же суд и сравнение с прошлой версией
      const linked = await linkToPrevious(caseId, c.previousId, caseFile, providers, models, progress);
      participants = linked.participants;
      revision = linked.revision;
    }
    return updateCase(caseId, { status: "ready", caseFile, participants, revision, error: null, progress: null });
  } catch (e) {
    updateCase(caseId, { status: "draft", error: e instanceof Error ? e.message : String(e), progress: null });
    throw e;
  }
}

/** Связь с прошлой версией: снимок её вердикта, тот же состав суда, сравнение версий секретарём. */
async function linkToPrevious(
  caseId: string,
  previousId: string,
  caseFile: CaseFile,
  providers: ProviderView[],
  models: ReturnType<typeof officialsModels>,
  progress: (text: string | null) => void,
) {
  const previous = getCase(previousId);
  let revision = revisionSnapshot(previous);
  const participants = reuseParticipants(previous.participants ?? [], providers, models);
  progress("Секретарь сравнивает новую версию с прошлой");
  try {
    revision = await compareVersions(previous.caseFile!, caseFile, revision, getModel(models.secretary), usage(caseId));
  } catch (e) {
    // Сравнение — подсказка суду, а не условие заседания: без него суд всё равно получит прошлый вердикт
    console.error(`[revision ${caseId}]`, e instanceof Error ? e.message : e);
  }
  return { revision, participants };
}

/**
 * Пользователь подтвердил, что готовое дело — новая версия дела из архива.
 * Сравнение версий идёт в фоне; экран подготовки показывает progress.
 */
export function startLinkRevision(caseId: string, previousId: string) {
  recoverOnce();
  const c = getCase(caseId);
  if (!c.caseFile) throw new CaseStateError("Дело ещё не подготовлено");
  if (c.parentId) throw new CaseStateError("Апелляцию нельзя сделать новой версией");
  if (previousId === caseId) throw new CaseStateError("Дело не может быть версией самого себя");
  try {
    revisionSnapshot(getCase(previousId)); // проверяем, что прошлое дело подходит, до смены статуса
  } catch (e) {
    if (e instanceof RevisionError) throw new CaseStateError(e.message);
    throw e;
  }
  if (!transitionStatus(caseId, ["ready", "failed"], "preparing")) {
    throw new CaseStateError("Связать версии можно только до начала заседания");
  }
  updateCase(caseId, { previousId, progress: "Секретарь поднимает прошлое дело из архива" });
  void (async () => {
    const progress = (text: string | null) => updateCase(caseId, { progress: text });
    try {
      const providers = listProviders();
      const linked = await linkToPrevious(caseId, previousId, c.caseFile!, providers, officialsModels(providers, getSettings()), progress);
      updateCase(caseId, { status: "ready", ...linked, error: null, progress: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      updateCase(caseId, { status: "ready", previousId: null, error: `Не удалось связать версии: ${message}`, progress: null });
    }
  })();
  return getCase(caseId);
}

/** «Это другое дело» — больше не предлагать связь; для связанного дела — отвязать. */
export function dismissRevision(caseId: string) {
  const c = getCase(caseId);
  if (c.status === "running" || c.status === "preparing") throw new CaseStateError("Сейчас дело нельзя менять");
  if (c.status === "done") throw new CaseStateError("Вердикт уже вынесен");
  return updateCase(caseId, { revision: { status: "dismissed" }, previousId: null });
}

function beginPrepare(caseId: string) {
  recoverOnce();
  if (!transitionStatus(caseId, ["draft"], "preparing")) {
    throw new CaseStateError("Дело уже подготовлено или готовится");
  }
  updateCase(caseId, { progress: "Принимаем материалы дела" });
}

/** Подготовка с ожиданием результата (тесты, скрипты). */
export async function prepare(caseId: string) {
  beginPrepare(caseId);
  return runPrepare(caseId);
}

/** Подготовка в фоне: обработка видео может занять минуты, экран следит за progress. */
export function startPrepare(caseId: string) {
  beginPrepare(caseId);
  void runPrepare(caseId).catch((e) => console.error(`[prepare ${caseId}]`, e instanceof Error ? e.message : e));
  return getCase(caseId);
}

/** Апелляция — короткое слушание: 2–3 заседания (но не больше общего лимита). */
export function appealSettings<T extends { minRounds: number; maxRounds: number }>(settings: T, isAppeal: boolean): T {
  if (!isAppeal) return settings;
  const maxRounds = Math.min(3, settings.maxRounds);
  return { ...settings, minRounds: Math.min(2, maxRounds), maxRounds };
}

/**
 * Апелляция: новое дело-потомок с тем же составом суда и материалами,
 * аудитория зафиксирована. Слушание стартует сразу.
 */
export function startAppeal(parentId: string, input: Appeal) {
  recoverOnce();
  const appeal = appealSchema.parse(input);
  const parent = getCase(parentId);
  if (parent.status !== "done" || !parent.caseFile || !parent.participants) {
    throw new CaseStateError("Апелляцию можно подать только после вердикта");
  }
  const child = createCase({
    materialText: parent.materialText,
    comment: parent.comment,
    parentId,
    appeal,
    status: "ready",
    caseFile: { ...parent.caseFile, title: `${parent.caseFile.title} — апелляция: ${appeal.segment}`.slice(0, 200) },
    participants: appealParticipants(parent.participants, appeal),
  });
  return start(child.id);
}

/** Модель, понимающая видео нативно (Gemini; демо — для проверки интерфейса). */
function videoModel(providers: ProviderView[]): ModelRef | null {
  const p = providers.find((x) => x.enabled && x.models.length && adapterFor(x.kind).capabilities.video);
  return p ? { providerId: p.id, modelId: p.defaultModel ?? p.models[0].id } : null;
}

/** Расшифровка речи через OpenAI (Whisper), если такой провайдер подключён. */
function transcriber(providers: ProviderView[], settings: Settings) {
  const p = providers.find((x) => x.enabled && x.kind === "openai");
  return p ? (audio: string) => transcribeAudio(providerConfig(p.id), settings.transcriptionModel, audio) : null;
}

/** Запускает заседание в фоне. Ход заседания доступен через subscribe/listEvents. */
export function start(caseId: string) {
  recoverOnce();
  const c = getCase(caseId);
  if (!c.caseFile || !c.participants) throw new CaseStateError("Дело ещё не подготовлено");
  if (!transitionStatus(caseId, ["ready", "failed", "done"], "running")) {
    throw new CaseStateError("Заседание уже идёт");
  }
  clearEvents(caseId);
  updateCase(caseId, { verdict: null, rounds: 0 });

  const settings = appealSettings(getSettings(), !!c.appeal);
  const revision = revisionFor(c);
  void runTrial(
    {
      caseFile: c.caseFile,
      participants: c.participants,
      settings,
      // Файлы и кадры лежат у исходного дела (апелляции им пользуются)
      attachments: visualAttachments(rootCaseId(caseId), c.caseFile.media),
      context: [appealContextFor(c), revision?.context].filter(Boolean).join("\n\n---\n\n") || undefined,
      revision: revision?.input,
    },
    { getModel, emit: (e) => emit(caseId, e), onUsage: usage(caseId) },
  ).then(
    ({ verdict, rounds }) => {
      updateCase(caseId, { status: "done", verdict, rounds });
      emit(caseId, { type: "trial_end", status: "done" });
    },
    (e) => {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[trial ${caseId}]`, message);
      updateCase(caseId, { status: "failed", error: message });
      emit(caseId, { type: "error", message });
      emit(caseId, { type: "trial_end", status: "failed" });
    },
  );
  return getCase(caseId);
}

export function ensureRecovered() {
  recoverOnce();
}
