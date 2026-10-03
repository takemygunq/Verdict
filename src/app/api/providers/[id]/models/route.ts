import { handle } from "@/lib/api";
import { refreshModels } from "@/lib/store/providers";

/** Подтянуть актуальный список моделей у провайдера. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => ({ provider: await refreshModels(id) }));
}
