import { handle } from "@/lib/api";
import { caseDetails } from "@/lib/trial/case-details";
import { startPrepare } from "@/lib/trial/runner";

/** Запускает подготовку в фоне (обработка файлов, секретарь). Ход — в поле progress дела. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => {
    startPrepare(id);
    return caseDetails(id);
  });
}
