import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setupTempDataDir } from "./helpers";

const dir = setupTempDataDir();
const { decryptSecret, encryptSecret, maskSecret } = await import("@/lib/crypto");

describe("шифрование ключей", () => {
  it("шифрует и расшифровывает", () => {
    const enc = encryptSecret("sk-test-123456");
    expect(enc).not.toContain("sk-test");
    expect(decryptSecret(enc)).toBe("sk-test-123456");
  });

  it("каждый раз даёт разный шифротекст (случайный IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("создаёт файл ключа в ./data с правами только для владельца", () => {
    const file = path.join(dir, "secret.key");
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o077).toBe(0);
  });

  it("обнаруживает подмену шифротекста", () => {
    const [v, iv, tag, data] = encryptSecret("secret").split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });

  it("маскирует ключ для фронта", () => {
    expect(maskSecret("sk-ant-api03-abcdefgh")).toBe("••••efgh");
    expect(maskSecret("short")).toBe("••••");
  });
});
