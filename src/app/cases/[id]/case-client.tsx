"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Courtroom } from "@/components/courtroom/courtroom";
import { ScoreChart } from "@/components/score-chart";
import { Spinner, btnCls, primaryBtnCls } from "@/components/ui";
import { api, errorText } from "@/lib/client/api";
import type { ProviderView } from "@/lib/store/providers";
import type { CaseDetails } from "@/lib/trial/case-details";
import type { StoredEvent } from "@/lib/trial/events";
import { PrepView } from "./prep-view";
import { AppealBanner, ReportBlock } from "./case-actions";
import { RevisionBanner } from "./revision";
import { TrialView, roundScores } from "./trial-view";

export interface ViewSettings {
  animationSpeed: number;
  fastMode: boolean;
}

/** Экран дела: подготовка → материалы и состав суда → заседание → отчёт. */
export function CaseClient({
  initial,
  providers,
  view,
  startFresh = false,
}: {
  initial: CaseDetails;
  providers: ProviderView[];
  view: ViewSettings;
  /** Только что запущенное заседание (например, апелляция) — смотреть с начала, а не догонять */
  startFresh?: boolean;
}) {
  const [details, setDetails] = useState(initial);
  const [editing, setEditing] = useState(false);
  /** Заседание запущено с этой страницы — его нужно показать целиком, а не «догонять» */
  const [fresh, setFresh] = useState(startFresh);
  const c = details.case;

  const reload = useCallback(async () => {
    setDetails(await api<CaseDetails>(`/api/cases/${c.id}`));
  }, [c.id]);

  if (c.status === "draft" || c.status === "preparing") {
    return <Preparing details={details} onReady={setDetails} reload={reload} />;
  }

  if (c.status === "ready" || editing) {
    return (
      <PrepView
        details={details}
        providers={providers}
        onChange={setDetails}
        onStarted={(next) => {
          setEditing(false);
          setFresh(true);
          setDetails(next);
        }}
      />
    );
  }

  return (
    <Hearing
      details={details}
      providers={providers}
      view={view}
      fresh={fresh}
      onCaseChange={(next) => setDetails((d) => ({ ...d, case: next }))}
      reload={reload}
      onEdit={() => setEditing(true)}
      onRestart={setDetails}
    />
  );
}

function Preparing({
  details,
  onReady,
  reload,
}: {
  details: CaseDetails;
  onReady: (d: CaseDetails) => void;
  reload: () => Promise<void>;
}) {
  const c = details.case;
  /** Ошибка запуска подготовки; ошибка фоновой обработки приходит в c.error */
  const [startError, setStartError] = useState<string | null>(null);
  const error = startError ?? (c.status === "draft" ? c.error : null);
  const requested = useRef(false);

  const prepare = useCallback(async () => {
    setStartError(null);
    try {
      onReady(await api<CaseDetails>(`/api/cases/${c.id}/prepare`, { method: "POST" }));
    } catch (e) {
      setStartError(errorText(e));
    }
  }, [c.id, onReady]);

  useEffect(() => {
    // Новое дело без ошибки — сразу отдаём секретарю. Ref защищает от двойного вызова в StrictMode.
    if (c.status === "draft" && !c.error && !requested.current) {
      requested.current = true;
      void prepare();
    }
    // Подготовка идёт в фоне — следим за прогрессом
    if (c.status === "preparing") {
      const t = setInterval(() => void reload(), 1500);
      return () => clearInterval(t);
    }
  }, [c.status, c.error, prepare, reload]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-24 text-center">
      <div className="text-5xl">📜</div>
      {error ? (
        <>
          <h1 className="font-display text-2xl font-bold">Секретарь не смог подготовить дело</h1>
          <p className="text-verdict-red">{error}</p>
          <div className="flex gap-3">
            <button className={primaryBtnCls} onClick={() => void prepare()}>
              Попробовать снова
            </button>
            <Link href="/settings" className={btnCls}>
              Настройки провайдеров
            </Link>
          </div>
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl font-bold">Готовим материалы дела…</h1>
          <p className="text-parchment/60">
            {details.files.length
              ? "Изучаем файлы и подбираем состав суда. Видео может обрабатываться несколько минут."
              : "Секретарь определяет тип материала и подбирает состав суда. Обычно это занимает до минуты."}
          </p>
          <Spinner label={c.progress ?? "Работаем"} />
        </>
      )}
    </div>
  );
}

function Hearing({
  details,
  providers,
  view,
  fresh,
  onCaseChange,
  reload,
  onEdit,
  onRestart,
}: {
  details: CaseDetails;
  providers: ProviderView[];
  view: ViewSettings;
  fresh: boolean;
  onCaseChange: (c: CaseDetails["case"]) => void;
  reload: () => Promise<void>;
  onEdit: () => void;
  onRestart: (d: CaseDetails) => void;
}) {
  const c = details.case;
  const participants = c.participants ?? [];
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [connection, setConnection] = useState<"open" | "lost" | "closed">("open");
  const [restartError, setRestartError] = useState<string | null>(null);
  /** Номер прогона: перезапуск заседания очищает журнал, на него нужно переподписаться */
  const [run, setRun] = useState(0);
  const [fast, setFast] = useState(view.fastMode);
  const [sceneError, setSceneError] = useState<string | null>(null);
  /** Что уже показано на сцене: протокол и отчёт не забегают вперёд анимации */
  const [revealed, setRevealed] = useState(0);
  const [played, setPlayed] = useState(0);
  /** Заседание смотрят «вживую» (а не открыли завершённое) — тогда после вердикта прокручиваем к отчёту */
  const [watching, setWatching] = useState(fresh);
  const feedRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Журнал заседания: при переподключении EventSource сам передаёт Last-Event-ID, сервер дошлёт пропущенное.
    const source = new EventSource(`/api/cases/${c.id}/stream`);
    source.onopen = () => setConnection("open");
    source.onmessage = (msg) => {
      const stored = JSON.parse(msg.data) as StoredEvent;
      setEvents((list) => (list.some((e) => e.seq === stored.seq) ? list : [...list, stored]));
      if (stored.event.type === "trial_end") {
        source.close();
        setConnection("closed");
        void reload();
      }
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setConnection("closed");
      else setConnection("lost");
    };
    return () => source.close();
  }, [c.id, run, reload]);

  const animated = !fast && !sceneError;
  const shown = useMemo(() => (animated ? events.filter((e) => e.seq <= revealed) : events), [animated, events, revealed]);
  const verdictSeq = events.find((e) => e.event.type === "verdict")?.seq;
  const verdictShown = !animated || (verdictSeq !== undefined && played >= verdictSeq);
  const caughtUp = !animated || revealed >= (events.at(-1)?.seq ?? 0);
  const chartRounds = useMemo(() => roundScores(shown), [shown]);
  const debaters = participants.filter((p) => p.role !== "secretary" && p.role !== "judge");

  // Лента протокола прокручивается за ходом заседания
  useEffect(() => {
    const feed = feedRef.current;
    if (animated && feed) feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
  }, [animated, shown.length]);

  // После анимации вердикта — плавный переход к отчёту
  const reportVisible = c.status === "done" && !!c.verdict && verdictShown;
  const scrolledToReport = useRef(false);
  useEffect(() => {
    if (reportVisible && animated && watching && !scrolledToReport.current) {
      scrolledToReport.current = true;
      // Пауза, чтобы финальный кадр вердикта успели увидеть
      setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 1800);
    }
  }, [reportVisible, animated, watching]);

  async function restart() {
    setRestartError(null);
    try {
      await api(`/api/cases/${c.id}/start`, { method: "POST" });
      setEvents([]);
      setRevealed(0);
      setPlayed(0);
      scrolledToReport.current = false;
      setWatching(true);
      onRestart(await api<CaseDetails>(`/api/cases/${c.id}`));
      setRun((n) => n + 1);
    } catch (e) {
      setRestartError(errorText(e));
    }
  }

  const protocol = <TrialView caseView={c} events={shown} providers={providers} live={caughtUp} />;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold text-brass-400 sm:text-3xl">{c.caseFile?.title}</h1>
        {c.status === "running" && connection === "lost" && (
          <span className="text-sm text-verdict-red">связь потеряна, переподключаемся…</span>
        )}
        <button
          className="ml-auto rounded-lg border border-wood-600 px-3 py-1 text-sm hover:border-brass-500 hover:text-brass-300"
          onClick={() => setFast((f) => !f)}
          title="Быстрый режим: без сцены, сразу протокол и отчёт"
        >
          {fast ? "🎬 Показать зал суда" : "⚡ Быстрый режим"}
        </button>
      </header>
      {sceneError && (
        <p className="text-sm text-parchment/60">
          Сцена недоступна в этом браузере ({sceneError}), показываем протокол.
        </p>
      )}

      <AppealBanner details={details} />
      <RevisionBanner details={details} />

      {!animated && reportVisible && <ReportBlock details={details} onChange={onCaseChange} />}

      {c.status === "failed" && (
        <div className="rounded-xl border border-verdict-red/50 bg-verdict-red/10 p-4">
          <div className="font-medium text-verdict-red">Заседание сорвано: {c.error}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={primaryBtnCls} onClick={() => void restart()}>
              Повторить заседание
            </button>
            <button className={btnCls} onClick={onEdit}>
              Изменить материалы и состав суда
            </button>
          </div>
          {restartError && <p className="mt-2 text-sm text-verdict-red">{restartError}</p>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {animated ? (
          <Courtroom
            key={`${c.id}:${run}`}
            participants={participants}
            materialType={c.caseFile!.material_type}
            events={events}
            catchUp={!fresh && run === 0}
            initialSpeed={view.animationSpeed}
            onReveal={(seq) => setRevealed((r) => Math.max(r, seq))}
            onPlayed={(seq) => setPlayed((p) => Math.max(p, seq))}
            onReplay={() => {
              setRevealed(0);
              setPlayed(0);
              scrolledToReport.current = false;
              setWatching(true);
            }}
            onUnavailable={setSceneError}
          />
        ) : (
          <div className="order-2 lg:order-1">{protocol}</div>
        )}
        <aside className="order-1 flex flex-col gap-4 lg:order-2">
          <ScoreChart debaters={debaters} rounds={chartRounds} />
          {animated && (
            <div ref={feedRef} className="max-h-[70vh] overflow-y-auto pr-1 lg:max-h-[480px]">
              <div className="mb-2 font-display font-bold">Протокол</div>
              {protocol}
            </div>
          )}
        </aside>
      </div>

      {animated && reportVisible && (
        <motion.div
          ref={reportRef}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="scroll-mt-4"
        >
          <ReportBlock details={details} onChange={onCaseChange} />
        </motion.div>
      )}

      {c.status === "done" && reportVisible && (
        <div className="flex flex-wrap gap-2">
          <button className={btnCls} onClick={() => void restart()}>
            Провести заседание заново
          </button>
          <button className={btnCls} onClick={onEdit}>
            Изменить материалы и состав суда
          </button>
          {restartError && <p className="text-sm text-verdict-red">{restartError}</p>}
        </div>
      )}
    </div>
  );
}
