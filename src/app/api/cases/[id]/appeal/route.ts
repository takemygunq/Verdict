import { handle } from "@/lib/api";
import { startAppeal } from "@/lib/trial/runner";

/** Подать апелляцию: { segment, age_from, age_to, note }. Создаёт дочернее дело и сразу начинает слушание. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => ({ case: startAppeal(id, await request.json()) }));
}
