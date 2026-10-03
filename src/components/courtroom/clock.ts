/**
 * Время сцены: учитывает скорость анимации и умеет «перемотку» —
 * при пропуске все текущие анимации мгновенно доходят до конца.
 * Не зависит от PixiJS: тикер сцены просто вызывает advance().
 */
interface Tween {
  elapsed: number;
  duration: number;
  update: (t: number) => void;
  resolve: () => void;
}

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

export class SceneClock {
  speed = 1;
  /** Пока true — анимации завершаются мгновенно (пропуск) */
  fastForward = false;
  /** Время сцены с учётом скорости — для фоновых анимаций (дыхание, капли пота) */
  now = 0;
  private tweens = new Set<Tween>();

  advance(realMs: number) {
    const dt = realMs * this.speed;
    this.now += dt;
    for (const tw of [...this.tweens]) {
      tw.elapsed += dt;
      const t = Math.min(1, tw.elapsed / tw.duration);
      tw.update(t);
      if (t >= 1) this.finish(tw);
    }
  }

  /** Анимация на ms (при скорости 1x); update получает прогресс 0..1. */
  tween(ms: number, update: (t: number) => void = () => {}): Promise<void> {
    return new Promise((resolve) => {
      const tw: Tween = { elapsed: 0, duration: Math.max(1, ms), update, resolve };
      if (this.fastForward) {
        update(1);
        resolve();
        return;
      }
      update(0);
      this.tweens.add(tw);
    });
  }

  wait(ms: number) {
    return this.tween(ms);
  }

  /** Мгновенно завершить всё, что сейчас анимируется. */
  flush() {
    for (const tw of [...this.tweens]) {
      tw.update(1);
      this.finish(tw);
    }
  }

  get busy() {
    return this.tweens.size > 0;
  }

  private finish(tw: Tween) {
    this.tweens.delete(tw);
    tw.resolve();
  }
}
