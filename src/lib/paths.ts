import path from "node:path";
import fs from "node:fs";

/** Каталог локальных данных (БД, ключ шифрования, загрузки). Можно переопределить через VERDICT_DATA_DIR. */
export function dataDir(): string {
  const dir = process.env.VERDICT_DATA_DIR ?? path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
