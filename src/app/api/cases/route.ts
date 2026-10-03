import { z } from "zod";
import { handle } from "@/lib/api";
import { UploadError, saveUpload, validateUpload } from "@/lib/materials/files";
import { createCase, deleteCase, getCase, listCases } from "@/lib/store/cases";
import { CaseStateError } from "@/lib/trial/runner";
import { RevisionError, revisionSnapshot } from "@/lib/trial/revision";

const fieldsSchema = z.object({
  materialText: z.string().trim().max(200_000).default(""),
  comment: z.string().trim().max(10_000).default(""),
  /** Повторное рассмотрение: id прошлой версии */
  previousId: z.string().trim().max(64).optional(),
});

export async function GET() {
  return handle(() => ({ cases: listCases() }));
}

/**
 * Новое дело. JSON { materialText, comment, previousId? } или multipart/form-data:
 * поля materialText, comment, previousId и файлы в поле files.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const isForm = request.headers.get("content-type")?.includes("multipart/form-data");
    let fields: z.infer<typeof fieldsSchema>;
    let files: File[] = [];
    if (isForm) {
      const form = await request.formData();
      fields = fieldsSchema.parse({
        materialText: form.get("materialText") ?? "",
        comment: form.get("comment") ?? "",
        previousId: form.get("previousId") || undefined,
      });
      files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    } else {
      fields = fieldsSchema.parse(await request.json());
    }
    if (!fields.materialText && !files.length) throw new UploadError("Нужен материал: текст или файлы");
    // Сначала проверяем все файлы, чтобы не создавать дело наполовину
    for (const f of files) validateUpload(f.name, f.type, f.size);
    if (fields.previousId) {
      try {
        revisionSnapshot(getCase(fields.previousId));
      } catch (e) {
        throw e instanceof RevisionError ? new CaseStateError(e.message) : e;
      }
    }

    const c = createCase(fields);
    try {
      for (const f of files) await saveUpload(c.id, f);
    } catch (e) {
      deleteCase(c.id);
      throw e;
    }
    return { case: getCase(c.id) };
  });
}
