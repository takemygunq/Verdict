import { handle } from "@/lib/api";
import { updateCase } from "@/lib/store/cases";
import { actualResultSchema, hasActualResult } from "@/lib/trial/schemas";

/** Фактический результат кампании: { ctr, conversion, sales, note }. Пустой — стирает. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const result = actualResultSchema.parse(await request.json());
    return { case: updateCase(id, { actualResult: hasActualResult(result) ? result : null }) };
  });
}
