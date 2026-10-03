import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { PKCE_COOKIE, authorizeUrl, createVerifier } from "@/lib/oauth/openrouter";

/** «Войти через OpenRouter»: генерируем PKCE и отправляем на страницу авторизации OpenRouter. */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const verifier = createVerifier();
  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(`${origin}/api/openrouter/callback`, verifier, state));
  res.cookies.set(PKCE_COOKIE, JSON.stringify({ verifier, state }), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/openrouter",
  });
  return res;
}
