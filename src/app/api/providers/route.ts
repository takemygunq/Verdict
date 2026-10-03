import { z } from "zod";
import { handle } from "@/lib/api";
import { KEYLESS_KINDS } from "@/lib/providers/registry";
import { PROVIDER_KINDS } from "@/lib/providers/types";
import { createProvider, listProviders } from "@/lib/store/providers";

const createSchema = z
  .object({
    kind: z.enum(PROVIDER_KINDS),
    label: z.string().trim().min(1).max(60),
    apiKey: z.string().trim().default(""),
    // Адрес API (прокси, Ollama) или путь к программе для CLI-мостов
    baseUrl: z.string().trim().max(500).optional(),
  })
  .refine((v) => KEYLESS_KINDS.includes(v.kind) || v.apiKey.length > 0, {
    message: "Нужен API-ключ",
    path: ["apiKey"],
  });

export async function GET() {
  return handle(() => ({ providers: listProviders() }));
}

export async function POST(request: Request) {
  return handle(async () => {
    const input = createSchema.parse(await request.json());
    return { provider: createProvider(input) };
  });
}
