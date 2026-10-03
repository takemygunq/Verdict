"use client";

import { useState } from "react";
import type { Participant } from "@/lib/trial/schemas";

export interface RoundScores {
  round: number;
  /** Оценки выступивших в этом заседании */
  scores: Record<string, number>;
  median?: number;
}

/** Цвет закреплён за участником (по порядку в составе суда), а не за рангом. */
export const seriesColor = (i: number) => `var(--color-series-${(i % 7) + 1})`;

const W = 340;
const H = 200;
const M = { top: 10, right: 12, bottom: 24, left: 30 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;
const GRID = [0, 25, 50, 75, 100];

/** Изменение оценок каждого участника по заседаниям. */
export function ScoreChart({ debaters, rounds }: { debaters: Participant[]; rounds: RoundScores[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hover, setHover] = useState<number | null>(null);
  if (!rounds.length) return null;

  const n = rounds.length;
  const x = (i: number) => M.left + (n === 1 ? PW / 2 : (i / (n - 1)) * PW);
  const y = (v: number) => M.top + PH - (v / 100) * PH;
  const colWidth = n === 1 ? PW : PW / (n - 1);

  const series = debaters.map((d, i) => ({
    d,
    color: seriesColor(i),
    points: rounds.flatMap((r, ri) => (d.id in r.scores ? [{ ri, v: r.scores[d.id] }] : [])),
  }));
  const medianPoints = rounds.flatMap((r, ri) => (r.median !== undefined ? [{ ri, v: r.median }] : []));
  const path = (pts: { ri: number; v: number }[]) => pts.map((p, k) => `${k ? "L" : "M"}${x(p.ri)},${y(p.v)}`).join("");

  const hovered = hover !== null ? rounds[hover] : null;

  return (
    <div className="rounded-xl border border-wood-700 bg-wood-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-display font-bold">Оценки по заседаниям</div>
        <button
          className="text-xs text-parchment/60 underline hover:text-brass-300"
          onClick={() => setView(view === "chart" ? "table" : "chart")}
        >
          {view === "chart" ? "таблица" : "график"}
        </button>
      </div>

      {view === "chart" ? (
        <>
          <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="График оценок участников по заседаниям">
              {GRID.map((g) => (
                <g key={g}>
                  <line x1={M.left} x2={W - M.right} y1={y(g)} y2={y(g)} stroke="var(--color-wood-700)" strokeWidth={1} />
                  <text x={M.left - 6} y={y(g)} dy="0.32em" textAnchor="end" fontSize={10} fill="currentColor" opacity={0.5}>
                    {g}
                  </text>
                </g>
              ))}
              {rounds.map((r, i) => (
                <text key={r.round} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.5}>
                  №{r.round}
                </text>
              ))}
              {hover !== null && (
                <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + PH} stroke="var(--color-parchment)" strokeOpacity={0.35} strokeWidth={1} />
              )}
              {medianPoints.length > 1 && (
                <path d={path(medianPoints)} fill="none" stroke="var(--color-brass-300)" strokeWidth={1.5} strokeDasharray="4 3" />
              )}
              {series.map((s) => (
                <g key={s.d.id}>
                  {s.points.length > 1 && (
                    <path d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  )}
                  {s.points.map((p) => (
                    <circle key={p.ri} cx={x(p.ri)} cy={y(p.v)} r={4} fill={s.color} stroke="var(--color-wood-900)" strokeWidth={2} />
                  ))}
                </g>
              ))}
              {/* Зоны наведения шире самих точек */}
              {rounds.map((r, i) => (
                <rect
                  key={r.round}
                  x={x(i) - colWidth / 2}
                  y={M.top}
                  width={colWidth}
                  height={PH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </svg>
            {hovered && (
              <div
                className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-lg border border-wood-600 bg-wood-950/95 p-2 text-xs shadow-lg"
                style={x(hover!) > W / 2 ? { right: `${((W - x(hover!)) / W) * 100 + 3}%` } : { left: `${(x(hover!) / W) * 100 + 3}%` }}
              >
                <div className="mb-1 font-medium">Заседание №{hovered.round}</div>
                {series
                  .filter((s) => s.d.id in hovered.scores)
                  .sort((a, b) => hovered.scores[b.d.id] - hovered.scores[a.d.id])
                  .map((s) => (
                    <div key={s.d.id} className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="flex-1 truncate">{s.d.name}</span>
                      <span className="tabular-nums">{hovered.scores[s.d.id]}</span>
                    </div>
                  ))}
                {hovered.median !== undefined && (
                  <div className="mt-1 flex justify-between border-t border-wood-700 pt-1 text-brass-300">
                    <span>Медиана</span>
                    <span className="tabular-nums">{hovered.median}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-parchment/80">
            {series.map((s) => (
              <li key={s.d.id} className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
                {s.d.name}
              </li>
            ))}
            <li className="flex items-center gap-1.5 text-brass-300">
              <span className="w-3 border-t border-dashed border-brass-300" />
              медиана
            </li>
          </ul>
        </>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-parchment/50">
              <th className="text-left font-normal">Участник</th>
              {rounds.map((r) => (
                <th key={r.round} className="w-10 text-right font-normal">
                  №{r.round}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.d.id} className="border-t border-wood-700/60">
                <td className="truncate py-1 pr-2">{s.d.name}</td>
                {rounds.map((r) => (
                  <td key={r.round} className="text-right">
                    {r.scores[s.d.id] ?? <span className="text-parchment/40">—</span>}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-wood-600 font-medium text-brass-300">
              <td className="py-1">Медиана</td>
              {rounds.map((r) => (
                <td key={r.round} className="text-right">
                  {r.median ?? ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
