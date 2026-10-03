import { z } from "zod";
import { handle } from "@/lib/api";
import { deleteProvider, getProvider, updateProvider } from "@/lib/store/providers";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  apiKey: z.string().trim().min(1).optional(),
  baseUrl: z.string().trim().max(500).nullable().optional(),
  models: z.array(z.object({ id: z.string().trim().min(1), label: z.string().optional() })).optional(),
  defaultModel: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(() => ({ provider: getProvider(id) }));
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => ({ provider: updateProvider(id, patchSchema.parse(await request.json())) }));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(() => {
    deleteProvider(id);
    return { ok: true };
  });
}
