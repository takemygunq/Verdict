import { handle } from "@/lib/api";
import { caseToMarkdown, exportFileName } from "@/lib/export/markdown";
import { getCase, listAppeals, listEvents } from "@/lib/store/cases";

/** Экспорт отчёта в Markdown (скачивание файла). PDF — через печатную версию /cases/[id]/print. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const c = getCase(id);
    const markdown = caseToMarkdown({
      case: c,
      events: listEvents(id),
      parent: c.parentId ? getCase(c.parentId) : null,
      appeals: listAppeals(id),
    });
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFileName(c)}"`,
      },
    });
  } catch (e) {
    // Ошибки (дело не найдено и т. п.) — в общем формате API
    return handle(() => {
      throw e;
    });
  }
}
