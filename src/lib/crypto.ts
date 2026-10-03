import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

const KEY_FILE = "secret.key";
const VERSION = "v1";

let cachedKey: Buffer | null = null;

/** Ключ шифрования AES-256 лежит отдельным файлом в ./data и создаётся при первом запуске. */
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const file = path.join(dataDir(), KEY_FILE);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
  }
  const key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error(`Повреждён файл ключа шифрования: ${file}`);
  cachedKey = key;
  return key;
}

/** Формат: v1:<iv base64>:<authTag base64>:<ciphertext base64> */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error("Неизвестный формат зашифрованного секрета");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** Для отображения на фронте: только хвост ключа. */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return "••••";
  return `••••${plain.slice(-4)}`;
}

/** Только для тестов. */
export function _resetKeyCache() {
  cachedKey = null;
}
