import type { Attachment } from "../providers/types";
import type { Media } from "../trial/schemas";
import { derivedFilePath } from "./files";

/** Не больше стольких картинок в одном запросе участника — иначе дорого и долго. */
export const MAX_VISUALS = 6;

/** Картинки и кадры видео из материалов дела — для моделей со зрением. */
export function visualAttachments(caseId: string, media: Media[]): Attachment[] {
  const out: Attachment[] = [];
  for (const m of media) {
    for (const name of m.frames) {
      const filePath = derivedFilePath(caseId, name);
      if (filePath && out.length < MAX_VISUALS) out.push({ kind: "image", mimeType: "image/jpeg", filePath, filename: name });
    }
  }
  return out;
}
