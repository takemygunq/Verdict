"use client";

import { useEffect } from "react";

/** Открывает диалог печати сразу (там можно «Сохранить как PDF»); кнопка — на случай повторной печати. */
export function PrintButton({ auto = true }: { auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm print:hidden">
      В диалоге печати выберите «Сохранить как PDF».
      <button onClick={() => window.print()} className="ml-auto rounded bg-neutral-900 px-3 py-1 text-white">
        Печать / PDF
      </button>
    </div>
  );
}
