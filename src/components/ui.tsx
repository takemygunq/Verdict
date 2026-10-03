import type { ReactNode } from "react";

export const inputCls =
  "rounded-lg border border-wood-600 bg-wood-950 px-3 py-2 text-sm outline-none focus:border-brass-500 disabled:opacity-50";
export const btnCls =
  "rounded-lg border border-wood-600 px-3 py-1.5 text-sm hover:border-brass-500 hover:text-brass-300 disabled:opacity-50";
export const primaryBtnCls =
  "rounded-lg bg-brass-500 px-4 py-2 text-sm font-medium text-wood-950 hover:bg-brass-400 disabled:opacity-50";

export function Section({
  title,
  hint,
  children,
  className = "",
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-wood-700 bg-wood-900 p-5 ${className}`}>
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-parchment/60">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-parchment/70">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brass-500 border-t-transparent" />
      {label}
    </div>
  );
}
