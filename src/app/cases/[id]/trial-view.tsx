"use client";

import { modelLabel } from "@/components/model-select";
import type { RoundScores } from "@/components/score-chart";
import { Spinner } from "@/components/ui";
import type { CaseView } from "@/lib/store/cases";
import type { ProviderView } from "@/lib/store/providers";
import { formatCalculation } from "@/lib/trial/calc";
import type { StoredEvent, TrialEvent } from "@/lib/trial/events";
import { ROLE_TITLES, isDebater, type Participant, type ParticipantResponse } from "@/lib/trial/schemas";
import { EMOTION_ICONS, MOOD, ROLE_ICONS } from "./labels";

type Ev<T extends TrialEvent["type"]> = Extract<TrialEvent, { type: T }>;

interface RoundState {
  round: number;
  start?: Ev<"round_start">;
  items: (Ev<"speech"> | Ev<"absent">)[];
  summary?: Ev<"round_summary">;
  decision?: Ev<"secretary_decision">;
}

/** Сворачивает плоский журнал событий в раунды. */
function toRounds(events: StoredEvent[]) {
  const rounds = new Map<number, RoundState>();
  const get = (n: number) => {
    if (!rounds.has(n)) rounds.set(n, { round: n, items: [] });
    return rounds.get(n)!;
  };
  let open: Ev<"session_open"> | undefined;
  let judging: Ev<"judge_start"> | undefined;
  const errors: string[] = [];
  let ended = false;
  for (const { event: e } of events) {
    switch (e.type) {
      case "session_open":
        open = e;
        break;
      case "round_start":
        get(e.round).start = e;
        break;
      case "speech":
      case "absent":
        get(e.round).items.push(e);
        break;
      case "round_summary":
        get(e.round).summary = e;
        break;
      case "secretary_decision":
        get(e.round).decision = e;
        break;
      case "judge_start":
        judging = e;
        break;
      case "error":
        errors.push(e.message);
        break;
      case "trial_end":
        ended = true;
        break;
    }
  }
  return { open, rounds: [...rounds.values()].sort((a, b) => a.round - b.round), judging, errors, ended };
}

/** Данные для графика оценок: только выступившие в каждом заседании. */
export function roundScores(events: StoredEvent[]): RoundScores[] {
  return toRounds(events).rounds.map((r) => ({
    round: r.round,
    scores: Object.fromEntries(
      r.items.flatMap((it) => (it.type === "speech" ? [[it.participantId, it.response.score] as const] : [])),
    ),
    median: r.summary?.aggregate.median,
  }));
}

/** Протокол заседания. events — уже показанные на сцене события. */
export function TrialView({
  caseView,
  events,
  providers,
  live = true,
}: {
  caseView: CaseView;
  events: StoredEvent[];
  providers: ProviderView[];
  /** false — сцена ещё проигрывает полученное: индикаторы ожидания не нужны */
  live?: boolean;
}) {
  const participants = caseView.participants ?? [];
  const byId = new Map(participants.map((p) => [p.id, p]));
  const debaters = participants.filter(isDebater);
  const { open, rounds, judging, errors, ended } = toRounds(events);
  const running = caseView.status === "running" && !ended && live;
  const hasVerdict = events.some((e) => e.event.type === "verdict");

  // Предыдущая оценка участника — чтобы показать, куда она сдвинулась
  const prevScore = new Map<string, number>();
  const deltas = new Map<string, number | null>();
  for (const r of rounds) {
    for (const it of r.items) {
      if (it.type !== "speech") continue;
      const prev = prevScore.get(it.participantId);
      deltas.set(`${r.round}:${it.participantId}`, prev === undefined ? null : it.response.score - prev);
      prevScore.set(it.participantId, it.response.score);
    }
  }

  if (!events.length) {
    return running ? <Spinner label="Подключаемся к залу суда…" /> : null;
  }

  return (
    <div className="flex flex-col gap-6">
        {open && <Announcement icon="📜" text={open.text} />}
        {rounds.map((r) => {
          const spoken = new Set(r.items.map((i) => i.participantId));
          const waiting = running && !r.summary ? debaters.filter((d) => !spoken.has(d.id)) : [];
          return (
            <section key={r.round} className="flex flex-col gap-3">
              <h2 className="font-display text-2xl font-bold text-brass-300">Заседание №{r.round}</h2>
              {r.start && <Announcement icon="📜" text={r.start.text} />}
              {r.items.map((it) =>
                it.type === "speech" ? (
                  <SpeechCard
                    key={it.participantId}
                    p={byId.get(it.participantId)}
                    r={it.response}
                    delta={deltas.get(`${r.round}:${it.participantId}`) ?? null}
                    model={modelLabel(byId.get(it.participantId)?.model ?? null, providers)}
                  />
                ) : (
                  <div key={it.participantId} className="rounded-xl border border-dashed border-wood-600 p-3 text-sm text-parchment/60">
                    {ROLE_ICONS[byId.get(it.participantId)?.role ?? "juror"]} <b>{byId.get(it.participantId)?.name}</b>{" "}
                    отсутствовал на этом заседании. <span className="text-parchment/40">Причина: {it.reason}</span>
                  </div>
                ),
              )}
              {waiting.length > 0 && <Spinner label={`Готовят выступления: ${waiting.map((w) => w.name).join(", ")}`} />}
              {r.summary && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-wood-800/60 px-4 py-2 text-sm">
                  <span>
                    Медиана: <b className="text-brass-300">{r.summary.aggregate.median}</b>
                  </span>
                  <span>
                    Разброс: <b>{r.summary.aggregate.min}–{r.summary.aggregate.max}</b> (σ {r.summary.aggregate.std})
                  </span>
                  <span>
                    {MOOD[r.summary.defendantMood].icon} {MOOD[r.summary.defendantMood].text}
                  </span>
                </div>
              )}
              {r.decision && (
                <Announcement
                  icon={r.decision.decision === "close" ? "🔔" : "📜"}
                  text={`${r.decision.decision === "close" ? "Слушания закрыты." : "Слушания продолжаются."} ${r.decision.reason}`}
                />
              )}
              {running && r.summary && !r.decision && <Spinner label="Секретарь совещается…" />}
            </section>
          );
        })}
        {judging && <Announcement icon="⚖️" text={judging.text} />}
        {running && judging && !hasVerdict && <Spinner label="Судья пишет вердикт…" />}
        {errors.map((e, i) => (
          <div key={i} className="rounded-xl border border-verdict-red/50 bg-verdict-red/10 p-3 text-sm text-verdict-red">
            {e}
          </div>
        ))}
    </div>
  );
}

function Announcement({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-brass-500/30 bg-brass-500/5 px-4 py-2 text-sm italic text-parchment/80">
      <span className="not-italic">{icon}</span>
      {text}
    </div>
  );
}

function SpeechCard({
  p,
  r,
  delta,
  model,
}: {
  p: Participant | undefined;
  r: ParticipantResponse;
  delta: number | null;
  model: string;
}) {
  if (!p) return null;
  return (
    <article className="rounded-xl border border-wood-700 bg-wood-900 p-4">
      <header className="flex items-start gap-3">
        <span className="text-2xl" title={ROLE_TITLES[p.role]}>
          {ROLE_ICONS[p.role]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {p.name}{" "}
            <span className="text-sm font-normal text-parchment/50">
              {ROLE_TITLES[p.role]}
              {p.specialization ? ` · ${p.specialization}` : ""}
            </span>
          </div>
          <div className="text-xs text-parchment/40">{model}</div>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <span title={`${r.emotion}, сила ${r.intensity}`}>{EMOTION_ICONS[r.emotion].repeat(r.intensity)}</span>
          <span className="rounded-lg bg-wood-950 px-2.5 py-1 font-display text-lg font-bold text-brass-300" title="Вероятность успеха">
            {r.score}
          </span>
          {r.plan_quality !== undefined && (
            <span className="text-xs text-parchment/50" title="Качество плана">
              план {r.plan_quality}
            </span>
          )}
          {delta !== null && delta !== 0 && (
            <span className={`text-sm ${delta > 0 ? "text-verdict-green" : "text-verdict-red"}`}>
              {delta > 0 ? "▲" : "▼"}
              {Math.abs(delta)}
            </span>
          )}
        </span>
      </header>
      <p className="mt-3 font-medium">
        {r.reacts_to && <span className="text-parchment/50">→ {r.reacts_to}: </span>}
        {r.stance}
      </p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-parchment/60 hover:text-brass-300">Полная речь и аргументы</summary>
        <p className="mt-2 whitespace-pre-line text-parchment/90">{r.speech}</p>
        {r.changed_score_because && (
          <p className="mt-2 text-parchment/70">
            <b>Об изменении оценки:</b> {r.changed_score_because}
          </p>
        )}
        {r.calculations && r.calculations.length > 0 && (
          <div className="mt-2">
            <div className="text-xs uppercase tracking-wide text-parchment/50">Расчёты (посчитаны кодом)</div>
            <ul className="mt-1 flex flex-col gap-1 font-mono text-xs">
              {r.calculations.map((c, i) => (
                <li key={i} className={c.result === null ? "text-verdict-red" : ""}>
                  {formatCalculation(c)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.responses_to_others && r.responses_to_others.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {r.responses_to_others.map((x, i) => (
              <li key={i}>
                {x.agree ? "👍" : "👎"} <b>{x.participant}:</b> {x.argument}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <List title="Сильные стороны" items={r.strengths} />
          <List title="Слабые стороны" items={r.weaknesses} />
        </div>
      </details>
    </article>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-parchment/50">{title}</div>
      <ul className="mt-1 list-disc pl-5">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
