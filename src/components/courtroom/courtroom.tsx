"use client";

import { useEffect, useRef, useState } from "react";
import { loadManifest } from "@/lib/scene/manifest";
import type { StoredEvent } from "@/lib/trial/events";
import type { MaterialType, Participant } from "@/lib/trial/schemas";
import { Director } from "./director";
import type { CourtroomScene } from "./scene";

const SPEEDS = [0.5, 1, 1.5, 2];
/** Сколько после открытия страницы события считаются «уже прошедшими» и применяются без анимации */
const CATCH_UP_MS = 1500;

export interface CourtroomProps {
  participants: Participant[];
  materialType: MaterialType;
  /** Все полученные события заседания */
  events: StoredEvent[];
  /** Открыли уже идущее или завершённое дело: прошедшее применяется сразу, анимируется только новое */
  catchUp: boolean;
  initialSpeed: number;
  onReveal(seq: number): void;
  onPlayed(seq: number): void;
  /** Перед повторным просмотром: протокол нужно очистить */
  onReplay(): void;
  /** WebGL недоступен — родитель переключается в быстрый режим */
  onUnavailable(reason: string): void;
}

/**
 * Зал суда. Сцена PixiJS создаётся один раз на монтирование —
 * для нового прогона заседания родитель меняет key.
 */
export function Courtroom(props: CourtroomProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CourtroomScene | null>(null);
  const directorRef = useRef<Director | null>(null);
  const propsRef = useRef(props);
  const mountedAt = useRef(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState(props.initialSpeed);

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    let cancelled = false;
    const { participants, materialType } = propsRef.current;
    (async () => {
      try {
        const [{ CourtroomScene }, manifest] = await Promise.all([import("./scene"), loadManifest()]);
        if (cancelled || !hostRef.current) return;
        const scene = await CourtroomScene.create(hostRef.current, { participants, materialType, manifest });
        if (cancelled) {
          scene.destroy();
          return;
        }
        scene.setSpeed(propsRef.current.initialSpeed);
        sceneRef.current = scene;
        directorRef.current = new Director(scene, participants, {
          onReveal: (seq) => propsRef.current.onReveal(seq),
          onPlayed: (seq) => propsRef.current.onPlayed(seq),
          onIdle: (idle) => setBusy(!idle),
        });
        // Окно «догоняния» отсчитываем от готовности сцены: поток к этому моменту уже передал прошедшее
        mountedAt.current = performance.now();
        setReady(true);
      } catch (e) {
        if (!cancelled) propsRef.current.onUnavailable(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
      directorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const instant = props.catchUp && performance.now() - mountedAt.current < CATCH_UP_MS;
    directorRef.current?.push(props.events, instant);
  }, [props.events, props.catchUp, ready]);

  function changeSpeed(s: number) {
    setSpeed(s);
    sceneRef.current?.setSpeed(s);
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={hostRef}
        className="relative aspect-video w-full overflow-hidden rounded-2xl border border-wood-700 bg-wood-900"
      >
        {!ready && <div className="absolute inset-0 grid place-items-center text-parchment/50">Готовим зал суда…</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-parchment/60">Скорость:</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`rounded-md px-2 py-0.5 ${speed === s ? "bg-brass-500 text-wood-950" : "text-parchment/70 hover:text-brass-300"}`}
            onClick={() => changeSpeed(s)}
            aria-pressed={speed === s}
          >
            {s}x
          </button>
        ))}
        <span className="ml-auto" />
        {busy ? (
          <button className="rounded-lg border border-wood-600 px-3 py-1 hover:border-brass-500 hover:text-brass-300" onClick={() => directorRef.current?.skip()}>
            ⏭ Пропустить анимацию
          </button>
        ) : (
          ready &&
          props.events.length > 0 && (
            <button
              className="rounded-lg border border-wood-600 px-3 py-1 hover:border-brass-500 hover:text-brass-300"
              onClick={() => {
                propsRef.current.onReplay();
                directorRef.current?.replay();
              }}
            >
              ▶ Смотреть заседание заново
            </button>
          )
        )}
      </div>
    </div>
  );
}
