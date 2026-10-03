import { listProviders } from "@/lib/store/providers";
import { getSettings } from "@/lib/store/settings";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const sp = await searchParams;
  const status = sp.openrouter === "connected" || sp.openrouter === "error" ? sp.openrouter : null;
  const message = typeof sp.message === "string" ? sp.message : undefined;
  return (
    <SettingsClient
      initialProviders={listProviders()}
      initialSettings={getSettings()}
      oauth={status ? { ok: status === "connected", message } : null}
    />
  );
}
