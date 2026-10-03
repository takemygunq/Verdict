import { newContext, sceneStateAt, stepsFor, type DirectorContext, type SceneState, type Step } from "@/lib/scene/timeline";
import type { StoredEvent } from "@/lib/trial/events";
import type { Participant } from "@/lib/trial/schemas";

/** То, что режиссёру нужно от сцены. Реальная сцена — PixiJS, в тестах — заглушка. */
export interface Stage {
  run(step: Step): Promise<void>;
  applyState(state: SceneState): void;
  reset(): void;
  /** Включить/выключить перемотку: анимации завершаются мгновенно */
  setFastForward(on: boolean): void;
}

export interface DirectorCallbacks {
  /** Событие начало проигрываться — его можно показать в протоколе */
  onReveal(seq: number): void;
  /** Событие доиграно (для вердикта — после анимации) */
  onPlayed(seq: number): void;
  onIdle?(idle: boolean): void;
}

/**
 * Проигрывает журнал заседания на сцене по одному событию.
 * Живые события встают в очередь; «пропустить» мгновенно догоняет очередь.
 */
export class Director {
  private queue: StoredEvent[] = [];
  private known: StoredEvent[] = [];
  private ctx: DirectorContext;
  private playing = false;
  private generation = 0;
  private skipping = false;

  constructor(
    private stage: Stage,
    private participants: Participant[],
    private cb: DirectorCallbacks,
  ) {
    this.ctx = newContext(participants);
  }

  /** Новые события из потока. instant — применить без анимации (догоняем уже прошедшее). */
  push(events: StoredEvent[], instant = false) {
    const lastSeq = this.known.at(-1)?.seq ?? 0;
    const fresh = events.filter((e) => e.seq > lastSeq);
    if (!fresh.length) return;
    this.known.push(...fresh);
    if (instant && !this.playing && !this.queue.length) {
      this.catchUp(fresh);
      return;
    }
    this.queue.push(...fresh);
    void this.loop();
  }

  /** Пропустить анимацию: всё, что в очереди, применяется мгновенно. */
  skip() {
    if (!this.playing && !this.queue.length) return;
    this.skipping = true;
    this.stage.setFastForward(true);
  }

  /** Проиграть всё заседание с начала. */
  replay() {
    this.generation++;
    this.skipping = false;
    this.stage.setFastForward(false);
    this.stage.reset();
    this.ctx = newContext(this.participants);
    this.queue = [...this.known];
    this.playing = false;
    void this.loop();
  }

  get busy() {
    return this.playing || this.queue.length > 0;
  }

  private catchUp(events: StoredEvent[]) {
    for (const e of events) {
      stepsFor(e.event, this.ctx); // обновляет контекст (прошлые оценки для стрелок ▲▼)
      this.cb.onReveal(e.seq);
      this.cb.onPlayed(e.seq);
    }
    this.stage.applyState(sceneStateAt(this.known, this.participants));
  }

  private async loop() {
    if (this.playing) return;
    this.playing = true;
    this.cb.onIdle?.(false);
    const gen = this.generation;
    while (this.queue.length && gen === this.generation) {
      if (this.skipping) {
        const rest = this.queue.splice(0);
        this.catchUp(rest);
        break;
      }
      const e = this.queue.shift()!;
      this.cb.onReveal(e.seq);
      for (const step of stepsFor(e.event, this.ctx)) {
        if (gen !== this.generation) return;
        await this.stage.run(step);
      }
      if (gen !== this.generation) return;
      this.cb.onPlayed(e.seq);
    }
    if (gen !== this.generation) return;
    if (this.skipping) {
      this.skipping = false;
      this.stage.setFastForward(false);
      this.stage.applyState(sceneStateAt(this.known, this.participants));
    }
    this.playing = false;
    this.cb.onIdle?.(true);
  }
}
