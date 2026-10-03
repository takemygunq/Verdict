import { z } from "zod";
import { handle } from "@/lib/api";
import { getSettings, saveSettings } from "@/lib/store/settings";

export async function GET() {
  return handle(() => ({ settings: getSettings() }));
}

export async function PUT(request: Request) {
  return handle(async () => {
    // Полная валидация происходит в saveSettings после слияния с текущими настройками.
    // (partial().parse здесь не подходит: в zod 4 он подставил бы значения по умолчанию в непереданные поля.)
    const patch = z.record(z.string(), z.unknown()).parse(await request.json());
    return { settings: saveSettings(patch) };
  });
}
