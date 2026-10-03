import { NextResponse, type NextRequest } from "next/server";
import { PKCE_COOKIE, exchangeCode } from "@/lib/oauth/openrouter";
import { checkProvider, createProvider, refreshModels } from "@/lib/store/providers";

/** Возврат с OpenRouter: проверяем state, меняем код на ключ, сохраняем провайдера и идём в настройки. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const back = (params: Record<string, string>) => {
    const target = new URL("/settings", url.origin);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    const res = NextResponse.redirect(target);
    res.cookies.delete({ name: PKCE_COOKIE, path: "/api/openrouter" });
    return res;
  };

  let saved: { verifier?: string; state?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get(PKCE_COOKIE)?.value ?? "{}");
  } catch {
    saved = {};
  }
  const code = url.searchParams.get("code");
  if (!code) return back({ openrouter: "error", message: "OpenRouter не прислал код авторизации" });
  if (!saved.verifier || (saved.state && saved.state !== url.searchParams.get("state"))) {
    return back({ openrouter: "error", message: "Сессия входа устарела или подменена — попробуйте ещё раз" });
  }

  try {
    const key = await exchangeCode(code, saved.verifier);
    const provider = createProvider({ kind: "openrouter", label: "OpenRouter", apiKey: key });
    // Сразу проверяем и подтягиваем модели — провайдер готов к работе одним действием
    const checked = await checkProvider(provider.id);
    if (checked.lastCheck?.ok) await refreshModels(provider.id).catch(() => undefined);
    return back({ openrouter: "connected" });
  } catch (e) {
    return back({ openrouter: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
