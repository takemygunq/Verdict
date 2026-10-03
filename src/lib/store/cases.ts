import crypto from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db";
import type { CaseRow } from "../db/schema";
import type { StoredEvent, TrialEvent } from "../trial/events";
import {
  actualResultSchema,
  appealSchema,
  caseFileSchema,
  participantSchema,
  revisionSchema,
  type ActualResult,
  type Appeal,
  type CaseFile,
  type Participant,
  type Revision,
  type Verdict,
} from "../trial/schemas";
import { deleteCaseUploads } from "../materials/files";
import { NotFoundError } from "./providers";

export type CaseStatus = "draft" | "preparing" | "ready" | "running" | "done" | "failed";

export interface CaseView {
  id: string;
  parentId: string | null;
  status: CaseStatus;
  materialText: string;
  comment: string;
  caseFile: CaseFile | null;
  participants: Participant[] | null;
  verdict: Verdict | null;
  error: string | null;
  rounds: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: number;
  updatedAt: number;
  /** Текущий шаг подготовки (обработка файлов, секретарь) */
  progress: string | null;
  /** Для апелляций: зафиксированная аудитория */
  appeal: Appeal | null;
  actualResult: ActualResult | null;
  /** Повторное рассмотрение: прошлая версия материала (null — удалена или это первая версия) */
  previousId: string | null;
  revision: Revision | null;
  /** Сколько из inputTokens прочитано из кэша провайдера */
  cachedTokens: number;
}

const parse = <T>(raw: string | null, s: z.ZodType<T>): T | null => (raw ? s.parse(JSON.parse(raw)) : null);

function toView(row: CaseRow): CaseView {
  return {
    id: row.id,
    parentId: row.parentId,
    status: row.status as CaseStatus,
    materialText: row.materialText,
    comment: row.comment,
    caseFile: parse(row.caseFile, caseFileSchema),
    participants: parse(row.participants, z.array(participantSchema)),
    // Вердикт пишет только наш код после валидации, повторно не проверяем
    verdict: row.verdict ? (JSON.parse(row.verdict) as Verdict) : null,
    error: row.error,
    rounds: row.rounds,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    progress: row.progress,
    appeal: parse(row.appeal, appealSchema),
    actualResult: parse(row.actualResult, actualResultSchema),
    previousId: row.previousId,
    revision: parse(row.revision, revisionSchema),
    cachedTokens: row.cachedTokens,
  };
}

function getRow(id: string): CaseRow {
  const row = db().select().from(schema.cases).where(eq(schema.cases.id, id)).get();
  if (!row) throw new NotFoundError(`Дело ${id} не найдено`);
  return row;
}

export function getCase(id: string): CaseView {
  return toView(getRow(id));
}

export function listCases(limit = 20): CaseView[] {
  return db().select().from(schema.cases).orderBy(desc(schema.cases.createdAt)).limit(limit).all().map(toView);
}

export function createCase(input: {
  materialText: string;
  comment: string;
  parentId?: string;
  appeal?: Appeal;
  status?: CaseStatus;
  caseFile?: CaseFile;
  participants?: Participant[];
  previousId?: string;
}): CaseView {
  const now = Date.now();
  const row: CaseRow = {
    id: crypto.randomUUID().slice(0, 8),
    parentId: input.parentId ?? null,
    status: input.status ?? "draft",
    materialText: input.materialText,
    comment: input.comment,
    caseFile: input.caseFile ? JSON.stringify(caseFileSchema.parse(input.caseFile)) : null,
    participants: input.participants ? JSON.stringify(z.array(participantSchema).parse(input.participants)) : null,
    verdict: null,
    error: null,
    rounds: 0,
    inputTokens: 0,
    outputTokens: 0,
    createdAt: now,
    updatedAt: now,
    progress: null,
    appeal: input.appeal ? JSON.stringify(appealSchema.parse(input.appeal)) : null,
    actualResult: null,
    previousId: input.previousId ?? null,
    revision: null,
    cachedTokens: 0,
  };
  db().insert(schema.cases).values(row).run();
  return toView(row);
}

export function updateCase(
  id: string,
  patch: Partial<{
    status: CaseStatus;
    caseFile: CaseFile;
    participants: Participant[];
    verdict: Verdict | null;
    error: string | null;
    rounds: number;
    progress: string | null;
    actualResult: ActualResult | null;
    previousId: string | null;
    revision: Revision | null;
  }>,
): CaseView {
  const values: Partial<CaseRow> = { updatedAt: Date.now() };
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.caseFile !== undefined) values.caseFile = JSON.stringify(caseFileSchema.parse(patch.caseFile));
  if (patch.participants !== undefined) {
    values.participants = JSON.stringify(z.array(participantSchema).parse(patch.participants));
  }
  if (patch.verdict !== undefined) values.verdict = patch.verdict ? JSON.stringify(patch.verdict) : null;
  if (patch.error !== undefined) values.error = patch.error;
  if (patch.rounds !== undefined) values.rounds = patch.rounds;
  if (patch.progress !== undefined) values.progress = patch.progress;
  if (patch.actualResult !== undefined) {
    values.actualResult = patch.actualResult ? JSON.stringify(actualResultSchema.parse(patch.actualResult)) : null;
  }
  if (patch.previousId !== undefined) values.previousId = patch.previousId;
  if (patch.revision !== undefined) values.revision = patch.revision ? JSON.stringify(revisionSchema.parse(patch.revision)) : null;
  const res = db().update(schema.cases).set(values).where(eq(schema.cases.id, id)).run();
  if (!res.changes) throw new NotFoundError(`Дело ${id} не найдено`);
  return getCase(id);
}

/** Атомарная смена статуса: true, если дело было в одном из ожидаемых статусов. */
export function transitionStatus(id: string, from: CaseStatus[], to: CaseStatus): boolean {
  const res = db()
    .update(schema.cases)
    .set({ status: to, updatedAt: Date.now(), ...(to === "preparing" || to === "running" ? { error: null } : {}) })
    .where(and(eq(schema.cases.id, id), inArray(schema.cases.status, from)))
    .run();
  return res.changes > 0;
}

export function addTokens(id: string, input: number, output: number, cached = 0) {
  db()
    .update(schema.cases)
    .set({
      inputTokens: sql`${schema.cases.inputTokens} + ${input}`,
      outputTokens: sql`${schema.cases.outputTokens} + ${output}`,
      cachedTokens: sql`${schema.cases.cachedTokens} + ${cached}`,
    })
    .where(eq(schema.cases.id, id))
    .run();
}

export function deleteCase(id: string) {
  getRow(id);
  // Апелляции удаляются каскадом, их файлов нет — они пользуются файлами исходного дела
  db().delete(schema.cases).where(eq(schema.cases.id, id)).run();
  deleteCaseUploads(id);
}

/* ---------- Журнал заседания ---------- */

export function appendEvent(caseId: string, event: TrialEvent): StoredEvent {
  const d = db();
  return d.transaction((tx) => {
    const last = tx
      .select({ max: sql<number | null>`max(${schema.caseEvents.seq})` })
      .from(schema.caseEvents)
      .where(eq(schema.caseEvents.caseId, caseId))
      .get();
    const stored: StoredEvent = { seq: (last?.max ?? 0) + 1, event, at: Date.now() };
    tx.insert(schema.caseEvents)
      .values({ caseId, seq: stored.seq, type: event.type, payload: JSON.stringify(event), createdAt: stored.at })
      .run();
    return stored;
  });
}

export function listEvents(caseId: string, afterSeq = 0): StoredEvent[] {
  return db()
    .select()
    .from(schema.caseEvents)
    .where(and(eq(schema.caseEvents.caseId, caseId), gt(schema.caseEvents.seq, afterSeq)))
    .orderBy(schema.caseEvents.seq)
    .all()
    .map((r) => ({ seq: r.seq, event: JSON.parse(r.payload) as TrialEvent, at: r.createdAt }));
}

export function clearEvents(caseId: string) {
  db().delete(schema.caseEvents).where(eq(schema.caseEvents.caseId, caseId)).run();
}

/** Дела, зависшие в процессе (сервер перезапускался во время заседания). */
export function listCasesInStatus(statuses: CaseStatus[]): CaseView[] {
  return db().select().from(schema.cases).where(inArray(schema.cases.status, statuses)).all().map(toView);
}

/* ---------- Апелляции и архив ---------- */

export function listAppeals(parentId: string): CaseView[] {
  return db().select().from(schema.cases).where(eq(schema.cases.parentId, parentId)).orderBy(schema.cases.createdAt).all().map(toView);
}

/** Более новые версии материала, поданные на повторное рассмотрение. */
export function listRevisions(previousId: string): CaseView[] {
  return db().select().from(schema.cases).where(eq(schema.cases.previousId, previousId)).orderBy(schema.cases.createdAt).all().map(toView);
}

/** Завершённые исходные дела (не апелляции) — кандидаты в «прошлую версию». */
export function listFinishedRootCases(): CaseView[] {
  return db()
    .select()
    .from(schema.cases)
    .where(and(eq(schema.cases.status, "done"), isNull(schema.cases.parentId)))
    .orderBy(desc(schema.cases.createdAt))
    .all()
    .map(toView);
}

/** Исходное дело для апелляции (по цепочке родителей): у него лежат файлы и кадры. */
export function rootCaseId(id: string): string {
  let row = getRow(id);
  for (let i = 0; row.parentId && i < 20; i++) row = getRow(row.parentId);
  return row.id;
}

export interface ArchiveEntry extends CaseView {
  appeals: CaseView[];
}

/** Архив: исходные дела (с апелляциями внутри), новые сверху, с поиском по тексту. */
export function searchCases(query = "", limit = 200): ArchiveEntry[] {
  const all = db().select().from(schema.cases).orderBy(desc(schema.cases.createdAt)).all().map(toView);
  const byParent = new Map<string, CaseView[]>();
  for (const c of all) if (c.parentId) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  const q = query.trim().toLowerCase();
  const haystack = (c: CaseView) =>
    [c.caseFile?.title, c.caseFile?.summary, c.materialText, c.comment, c.appeal?.segment, ...(c.caseFile?.media.map((m) => m.name) ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  return all
    .filter((c) => !c.parentId)
    .map((c) => ({ ...c, appeals: (byParent.get(c.id) ?? []).reverse() }))
    .filter((c) => !q || haystack(c).includes(q) || c.appeals.some((a) => haystack(a).includes(q)))
    .slice(0, limit);
}
