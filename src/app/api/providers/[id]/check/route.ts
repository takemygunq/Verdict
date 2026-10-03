import { handle } from "@/lib/api";
import { checkProvider } from "@/lib/store/providers";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => ({ provider: await checkProvider(id) }));
}
