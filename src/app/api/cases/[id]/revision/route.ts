import { z } from "zod";
import { handle } from "@/lib/api";
import { caseDetails } from "@/lib/trial/case-details";
import { dismissRevision, startLinkRevision } from "@/lib/trial/runner";

type Ctx = { params: Promise<{ id: string }> };

/** Повторное рассмотрение: { previousId } — это дело новая версия указанного. Сравнение версий идёт в фоне. */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => {
    const { previousId } = z.object({ previousId: z.string().min(1) }).parse(await request.json());
    startLinkRevision(id, previousId);
    return caseDetails(id);
  });
}

/** «Это другое дело»: не связывать с архивом (или отвязать до заседания). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(() => {
    dismissRevision(id);
    return caseDetails(id);
  });
}
