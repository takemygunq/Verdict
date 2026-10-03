import { handle } from "@/lib/api";
import { start } from "@/lib/trial/runner";

/** Открывает заседание. Ход заседания — в /api/cases/[id]/stream. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => ({ case: start(id) }));
}
