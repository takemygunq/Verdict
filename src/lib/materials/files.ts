import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { CaseFileRow } from "../db/schema";
import { dataDir } from "../paths";

export type FileKind = "image" | "video" | "pdf" | "docx" | "text";

export interface CaseFileView {
  id: string;
  name: string;
  mime: string;
  kind: FileKind;
  size: number;
}

/** Лимиты на файл, байт. Видео большое — Gemini получит его через Files API. */
export const LIMITS: Record<FileKind, number> = {
  image: 20 * 1024 * 1024,
  video: 1024 * 1024 * 1024,
  pdf: 50 * 1024 * 1024,
  docx: 50 * 1024 * 1024,
  text: 5 * 1024 * 1024,
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function fileKind(mime: string, name: string): FileKind | null {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_TYPES.includes(mime) || [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
  if (mime.startsWith("video/") || [".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"].includes(ext)) return "video";
  if (mime === "application/pdf" || ext === ".pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === ".docx") return "docx";
  if (mime.startsWith("text/") || [".txt", ".md", ".csv"].includes(ext)) return "text";
  return null;
}

export function mimeOf(kind: FileKind, name: string, fallback: string): string {
  if (fallback && fallback !== "application/octet-stream") return fallback;
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4v": "video/mp4",
    ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
  };
  return map[ext] ?? (kind === "video" ? "video/mp4" : "application/octet-stream");
}

export class UploadError extends Error {}

export function caseDir(caseId: string): string {
  const dir = path.join(dataDir(), "uploads", caseId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Каталог для производных файлов (ключевые кадры, аудио). */
export function derivedDir(caseId: string): string {
  const dir = path.join(caseDir(caseId), "derived");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Проверяет файл до сохранения: тип и размер. */
export function validateUpload(name: string, mime: string, size: number): FileKind {
  const kind = fileKind(mime, name);
  if (!kind) throw new UploadError(`Файл «${name}»: такой формат пока не поддерживается`);
  if (size > LIMITS[kind]) {
    throw new UploadError(`Файл «${name}» слишком большой: ${(size / 1024 / 1024).toFixed(0)} МБ`);
  }
  return kind;
}

export async function saveUpload(caseId: string, file: File): Promise<CaseFileView> {
  const kind = validateUpload(file.name, file.type, file.size);
  const id = crypto.randomUUID().slice(0, 8);
  // Имя на диске — без пользовательского ввода, чтобы не было проблем с путями
  const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "");
  const rel = path.join("uploads", caseId, `${id}${ext}`);
  caseDir(caseId);
  fs.writeFileSync(path.join(dataDir(), rel), Buffer.from(await file.arrayBuffer()));
  const row: CaseFileRow = {
    id,
    caseId,
    name: file.name.slice(0, 200),
    mime: mimeOf(kind, file.name, file.type),
    kind,
    size: file.size,
    path: rel,
    createdAt: Date.now(),
  };
  db().insert(schema.caseFiles).values(row).run();
  return toView(row);
}

function toView(r: CaseFileRow): CaseFileView {
  return { id: r.id, name: r.name, mime: r.mime, kind: r.kind as FileKind, size: r.size };
}

export function listCaseFiles(caseId: string): CaseFileView[] {
  return db()
    .select()
    .from(schema.caseFiles)
    .where(eq(schema.caseFiles.caseId, caseId))
    .orderBy(schema.caseFiles.createdAt)
    .all()
    .map(toView);
}

/** Абсолютный путь к файлу дела (или null, если файла нет). */
export function caseFilePath(caseId: string, fileId: string): { path: string; file: CaseFileView } | null {
  const row = db().select().from(schema.caseFiles).where(eq(schema.caseFiles.id, fileId)).get();
  if (!row || row.caseId !== caseId) return null;
  return { path: path.join(dataDir(), row.path), file: toView(row) };
}

/** Производный файл (кадр видео) — только имя внутри derived/, без выхода за пределы каталога. */
export function derivedFilePath(caseId: string, name: string): string | null {
  if (!/^[\w.-]+$/.test(name)) return null;
  const p = path.join(dataDir(), "uploads", caseId, "derived", name);
  return fs.existsSync(p) ? p : null;
}

export function deleteCaseUploads(caseId: string) {
  fs.rmSync(path.join(dataDir(), "uploads", caseId), { recursive: true, force: true });
}
