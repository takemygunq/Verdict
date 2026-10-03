import { handle } from "@/lib/api";
import { deleteCase } from "@/lib/store/cases";
import { caseDetails, patchCase } from "@/lib/trial/case-details";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(() => caseDetails(id));
}

/** Правка материалов дела и состава суда перед заседанием. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => patchCase(id, await request.json()));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(() => {
    deleteCase(id);
    return { ok: true };
  });
}
