import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { depthScale, STAGE, type Point } from "@/lib/scene/layout";
import type { CharacterAssets } from "@/lib/scene/manifest";
import type { Emotion } from "@/lib/trial/schemas";
import { easeInOut, easeOutBack, type SceneClock } from "./clock";

export const EMOTION_EMOJI: Record<Emotion, string> = {
  calm: "😌",
  confident: "😎",
  angry: "😠",
  skeptical: "🤨",
  surprised: "😲",
  laughing: "😂",
  thinking: "🤔",
  sad: "😢",
};

export const FONT = "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
export const DISPLAY_FONT = "'PT Serif', Georgia, 'Times New Roman', serif";

const BODY_H = 118;
/** Высота нарисованного персонажа на сцене (при масштабе глубины 1) */
const SPRITE_H = 200;

export interface ActorOptions {
  name: string;
  color: number;
  /** Эмодзи-«лицо» заглушки, если нет ассета */
  face: string;
  /** Значок поверх силуэта: роль или тип подсудимого */
  badge?: string;
  assets?: CharacterAssets;
  textures: Map<string, Texture>;
  /** Высота нарисованного персонажа, px при масштабе глубины 1 */
  spriteHeight?: number;
}

/**
 * Персонаж сцены. Если в манифесте есть картинки — рисует спрайт, иначе заглушку:
 * цветной силуэт, лицо-эмодзи эмоции и табличку с именем.
 * Позиция контейнера — точка «под ногами».
 */
export class Actor {
  readonly view = new Container();
  /** Облачко и оценка живут в отдельном верхнем слое сцены, чтобы мебель не перекрывала их,
   *  а говорящий оставался за трибуной. Позиция синхронизируется с персонажем каждый кадр. */
  readonly overlay = new Container();
  private figure = new Container();
  private sprite: Sprite | null = null;
  private face: Text;
  private bubble = new Container();
  private scoreBadge = new Container();
  private emotion: Emotion = "calm";
  private intensity: 1 | 2 | 3 = 1;
  private walking = false;
  private present = true;
  /** Сдвиг фазы фоновой анимации, чтобы персонажи не «дышали» синхронно */
  private phase = Math.random() * 1000;
  extra: ((now: number) => void) | null = null;

  constructor(
    private clock: SceneClock,
    private opts: ActorOptions,
  ) {
    const idle = this.texture(opts.assets?.idle);
    if (idle) {
      this.sprite = new Sprite(idle);
      this.sprite.anchor.set(0.5, 1);
      // Все позы персонажа масштабируются одинаково — по высоте idle
      this.sprite.height = this.spriteH;
      this.sprite.scale.x = this.sprite.scale.y;
      this.figure.addChild(this.sprite);
    } else {
      const body = new Graphics()
        // тень под ногами
        .ellipse(0, 0, 34, 9)
        .fill({ color: 0x000000, alpha: 0.35 })
        // туловище
        .roundRect(-30, -BODY_H + 34, 60, BODY_H - 34, 22)
        .fill(opts.color)
        .roundRect(-30, -BODY_H + 34, 60, BODY_H - 34, 22)
        .stroke({ width: 2, color: 0x000000, alpha: 0.35 })
        // голова
        .circle(0, -BODY_H + 8, 30)
        .fill(0xf3e9d2)
        .circle(0, -BODY_H + 8, 30)
        .stroke({ width: 2, color: 0x000000, alpha: 0.3 });
      this.figure.addChild(body);
      if (opts.badge) {
        const badge = new Text({ text: opts.badge, style: { fontFamily: FONT, fontSize: 24 } });
        badge.anchor.set(0.5);
        badge.position.set(0, -BODY_H + 66);
        this.figure.addChild(badge);
      }
    }
    this.face = new Text({ text: opts.face, style: { fontFamily: FONT, fontSize: 40 } });
    this.face.anchor.set(0.5);
    this.face.position.set(0, -BODY_H + 9);
    this.face.visible = !this.sprite;
    this.figure.addChild(this.face);

    const label = new Text({
      text: opts.name,
      style: {
        fontFamily: FONT,
        fontSize: 15,
        fill: 0xf3e9d2,
        fontWeight: "600",
        align: "center",
        // Длинные имена переносятся на две строки, чтобы не налезать на соседей
        wordWrap: true,
        wordWrapWidth: 104,
        lineHeight: 17,
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 3, distance: 0 },
      },
    });
    label.anchor.set(0.5, 0);
    label.position.set(0, 8);

    this.view.addChild(this.figure);
    // Табличка с именем тоже сверху: мебель не должна её закрывать
    this.overlay.addChild(label, this.scoreBadge, this.bubble);
    this.scoreBadge.visible = false;
    this.bubble.visible = false;
  }

  private texture(path: string | undefined) {
    return path ? this.opts.textures.get(path) : undefined;
  }

  /** Верх головы относительно ног */
  private get headTop() {
    return this.sprite ? -this.spriteH : -BODY_H - 30;
  }

  /** Персонаж нарисован ассетом, а не заглушкой */
  get hasSprite() {
    return this.sprite !== null;
  }

  /** Есть ли у персонажа картинка для настроения (подсудимый) */
  hasMood(mood: string) {
    return !!this.texture(this.opts.assets?.moods[mood]);
  }

  get position(): Point {
    return { x: this.view.x, y: this.view.y };
  }

  place(p: Point) {
    this.view.position.set(p.x, p.y);
    this.view.scale.set(depthScale(p.y));
    this.view.zIndex = p.y;
  }

  setVisible(v: boolean) {
    this.view.visible = v;
  }

  setPresent(present: boolean) {
    this.present = present;
    this.view.alpha = present ? 1 : 0.35;
  }

  setEmotion(emotion: Emotion, intensity: 1 | 2 | 3 = 1) {
    this.emotion = emotion;
    this.intensity = intensity;
    if (this.sprite) {
      const t = this.texture(this.opts.assets?.emotions[emotion]) ?? this.texture(this.opts.assets?.idle);
      if (t) this.sprite.texture = t;
    } else {
      this.face.text = EMOTION_EMOJI[emotion];
    }
  }

  /** Для подсудимого: лицо по настроению. */
  setFace(face: string, assetKey?: string) {
    if (this.sprite) {
      const t = this.texture(assetKey ? this.opts.assets?.moods[assetKey] : undefined) ?? this.texture(this.opts.assets?.idle);
      if (t) this.sprite.texture = t;
    } else {
      this.face.text = face;
    }
  }

  async walkTo(target: Point, ms: number) {
    const from = this.position;
    if (Math.hypot(target.x - from.x, target.y - from.y) < 2) return;
    this.walking = true;
    this.figure.scale.x = target.x < from.x ? -1 : 1;
    await this.clock.tween(ms, (t) => {
      const k = easeInOut(t);
      this.place({ x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k });
    });
    this.walking = false;
    if (this.sprite) this.setEmotion(this.emotion, this.intensity);
    this.figure.scale.x = 1;
    this.figure.y = 0;
    this.figure.rotation = 0;
  }

  /** Облачко с репликой над персонажем на ms. */
  async say(text: string, ms: number, maxWidth = 320) {
    this.bubble.removeChildren().forEach((c) => c.destroy());
    const content = new Text({
      text,
      style: { fontFamily: FONT, fontSize: 17, fill: 0x1f150e, wordWrap: true, wordWrapWidth: maxWidth, lineHeight: 22, breakWords: true },
    });
    const pad = 12;
    const w = content.width + pad * 2;
    const h = content.height + pad * 2;
    const bg = new Graphics()
      .roundRect(-w / 2, -h, w, h, 14)
      .fill(0xf3e9d2)
      .roundRect(-w / 2, -h, w, h, 14)
      .stroke({ width: 2, color: 0x1f150e, alpha: 0.6 })
      .poly([-10, -1, 10, -1, 0, 14])
      .fill(0xf3e9d2);
    content.position.set(-w / 2 + pad, -h + pad);
    this.bubble.addChild(bg, content);

    // Облачко над головой, но в пределах сцены (учитываем масштаб глубины)
    const s = this.view.scale.x;
    const headTop = this.headTop - 4;
    const marginX = (w / 2 + 8) * s;
    const dx = Math.min(Math.max(this.view.x, marginX), STAGE.width - marginX) - this.view.x;
    const top = this.view.y + (headTop - h) * s;
    const dy = top < 8 ? (8 - top) / s : 0;
    this.bubble.position.set(dx / s, headTop + dy);

    this.bubble.visible = true;
    await this.clock.tween(220, (t) => (this.bubble.scale.set(easeOutBack(t)), (this.bubble.alpha = t)));
    await this.clock.wait(ms);
    await this.clock.tween(180, (t) => (this.bubble.alpha = 1 - t));
    this.bubble.visible = false;
  }

  hideBubble() {
    this.bubble.visible = false;
  }

  /** Оценка над головой во время выступления. */
  showScore(score: number, delta: number | null) {
    this.scoreBadge.removeChildren().forEach((c) => c.destroy());
    const arrow = delta ? (delta > 0 ? ` ▲${delta}` : ` ▼${-delta}`) : "";
    const txt = new Text({
      text: `${score}${arrow}`,
      style: { fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: "700", fill: delta && delta < 0 ? 0xffb4a8 : delta && delta > 0 ? 0xb8f0c8 : 0xf0d48a },
    });
    txt.anchor.set(0.5);
    const w = txt.width + 18;
    const bg = new Graphics().roundRect(-w / 2, -16, w, 32, 16).fill({ color: 0x140d08, alpha: 0.9 }).roundRect(-w / 2, -16, w, 32, 16).stroke({ width: 2, color: 0xc99a35 });
    this.scoreBadge.addChild(bg, txt);
    this.scoreBadge.position.set(this.sprite ? 62 : 52, this.headTop + 38);
    this.scoreBadge.visible = true;
  }

  hideScore() {
    this.scoreBadge.visible = false;
  }

  /** Фоновая анимация: дыхание, тряска при сильной эмоции, походка. Вызывается каждый кадр. */
  tick(now: number) {
    const t = (now + this.phase) / 1000;
    if (this.walking) {
      const frames = this.opts.assets?.walk ?? [];
      if (this.sprite && frames.length) {
        // Есть цикл ходьбы из ассетов — листаем кадры
        const tex = this.texture(frames[Math.floor(t * 8) % frames.length]);
        if (tex) this.sprite.texture = tex;
      } else {
        this.figure.y = -Math.abs(Math.sin(t * 14)) * 7;
        this.figure.rotation = Math.sin(t * 14) * 0.05;
      }
    } else if (this.present) {
      const shake = this.intensity === 3 && (this.emotion === "angry" || this.emotion === "laughing" || this.emotion === "surprised");
      this.figure.y = Math.sin(t * 2.2) * 1.5;
      this.figure.rotation = shake ? Math.sin(t * 40) * 0.03 : 0;
      this.face.scale.set(1 + (this.intensity - 1) * 0.08 + (this.intensity === 3 ? Math.sin(t * 6) * 0.04 : 0));
    }
    this.overlay.position.copyFrom(this.view.position);
    this.overlay.scale.copyFrom(this.view.scale);
    this.overlay.visible = this.view.visible;
    this.overlay.alpha = this.view.alpha;
    this.extra?.(now);
  }

  private get spriteH() {
    return this.opts.spriteHeight ?? SPRITE_H;
  }

  destroy() {
    this.overlay.destroy({ children: true });
    this.view.destroy({ children: true });
  }
}
