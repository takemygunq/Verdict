import crypto from "node:crypto";

/** Официальный OAuth PKCE OpenRouter: https://openrouter.ai/docs/use-cases/oauth-pkce */
// Адреса переопределяются через окружение (в тестах — на локальный стаб)
const authUrl = () => process.env.OPENROUTER_AUTH_URL ?? "https://openrouter.ai/auth";
const keysUrl = () => process.env.OPENROUTER_KEYS_URL ?? "https://openrouter.ai/api/v1/auth/keys";

export const PKCE_COOKIE = "verdict_or_pkce";

const base64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** code_verifier: 43–128 символов из [A-Za-z0-9-._~] (RFC 7636) */
export function createVerifier(): string {
  return base64url(crypto.randomBytes(48));
}

/** code_challenge для метода S256: base64url(SHA-256(verifier)) */
export function challengeFor(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

export function authorizeUrl(callbackUrl: string, verifier: string, state: string): string {
  const url = new URL(authUrl());
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("key_label", "Verdict");
  return url.toString();
}

/** Обмен кода из callback на API-ключ пользователя. */
export async function exchangeCode(code: string, verifier: string): Promise<string> {
  const res = await fetch(keysUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  const body = (await res.json().catch(() => ({}))) as { key?: string; error?: { message?: string } | string };
  if (!res.ok || !body.key) {
    const msg = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(`OpenRouter не выдал ключ (${res.status}${msg ? `: ${msg}` : ""})`);
  }
  return body.key;
}
