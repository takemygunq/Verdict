import fs from "node:fs";
import type { Attachment } from "./types";

/** base64 вложения: из поля data или из файла на диске. */
export function attachmentData(a: Attachment): string {
  if (a.data) return a.data;
  if (a.filePath) return fs.readFileSync(a.filePath).toString("base64");
  throw new Error(`Вложение ${a.filename ?? ""} без данных`);
}
