import { Application, Assets, Container, Graphics, Sprite, Text, Texture, VideoSource } from "pixi.js";
import {
  DEFENDANT_ICONS,
  ROLE_COLORS,
  JURY_BOX,
  SPOTS,
  STAGE,
  assetKey,
  defendantKind,
  seatOf,
  speakingSpot,
  type DefendantKind,
} from "@/lib/scene/layout";
import { manifestFiles, type AssetManifest } from "@/lib/scene/manifest";
import type { SceneState, Step } from "@/lib/scene/timeline";
import type { DefendantMood } from "@/lib/trial/events";
import type { MaterialType, Participant, Verdict } from "@/lib/trial/schemas";
import { Actor, DISPLAY_FONT, FONT } from "./actor";
import { SceneClock, easeInOut, easeOutBack } from "./clock";
import type { Stage } from "./director";

const ROLE_BADGES: Record<Participant["role"], string> = {
  judge: "⚖️",
  secretary: "📜",
  prosecutor: "🗡️",
  defense: "🛡️",
  witness: "🙋",
  juror: "🎓",
};

const MOOD_FACES: Record<DefendantMood, string> = {
  ecstatic: "🤩",
  happy: "😊",
  calm: "😐",
  nervous: "😰",
  sweating: "🥵",
};

const OUTCOME_TEXT: Record<Verdict["outcome"], { title: string; color: number }> = {
  acquitted: { title: "Оправдан!", color: 0x7fd49a },
  conditional: { title: "Условно, с доработками", color: 0xf0d48a },
  guilty: { title: "Виновен в скучности", color: 0xff8a7a },
};

const DEFENDANT_ID = "__defendant";

export interface SceneOptions {
  participants: Participant[];
  materialType: MaterialType;
  manifest: AssetManifest;
}

/** Сцена зала суда на PixiJS. Исполняет шаги режиссёра (см. lib/scene/timeline). */
export class CourtroomScene implements Stage {
  readonly clock = new SceneClock();
  private root = new Container();
  private world = new Container();
  private floorLayer = new Container();
  private actorsLayer = new Container();
  private overlayLayer = new Container();
  private fxLayer = new Container();
  private actors = new Map<string, Actor>();
  private textures = new Map<string, Texture>();
  private defendantKind: DefendantKind;
  private verdictView: Container | null = null;
  private confetti: Graphics[] = [];
  private judgeId: string;
  private sweatG = new Graphics();
  private verdictBg: Sprite | null = null;
  /** Видеолупы крупного плана (удар молотка, вердикт) — из манифеста, если есть */
  private videos = new Map<string, HTMLVideoElement>();
  /** Крупный план удара показываем один раз за заседание, дальше — короткий удар спрайтом */
  private gavelPlayed = false;
  private sweatDrops = 0;
  private destroyed = false;

  private constructor(
    private app: Application,
    private opts: SceneOptions,
  ) {
    this.defendantKind = defendantKind(opts.materialType);
    this.judgeId = opts.participants.find((p) => p.role === "judge")?.id ?? "judge";
  }

  static async create(host: HTMLElement, opts: SceneOptions): Promise<CourtroomScene> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      antialias: true,
      backgroundAlpha: 0,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    app.canvas.setAttribute("role", "img");
    app.canvas.setAttribute("aria-label", "Зал суда: ход заседания. Текстовая версия — в протоколе.");
    host.appendChild(app.canvas);
    const scene = new CourtroomScene(app, opts);
    await scene.preload();
    scene.preloadVideos();
    scene.build();
    return scene;
  }

  /* ---------------- Сборка ---------------- */

  private preloadVideos() {
    for (const [name, file] of Object.entries(this.opts.manifest.videos)) {
      const v = document.createElement("video");
      v.src = `/assets/${file}`;
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.loop = false;
      this.videos.set(name, v);
    }
  }

  /**
   * Крупный план поверх зала: персонаж «выпрыгивает» сбоку, проигрывается видео с прозрачным фоном.
   * onBeat — момент удара (доля длительности), чтобы синхронизировать тряску/звук.
   * Возвращает false, если видео нет или идёт перемотка.
   */
  private async cutaway(name: string, onBeat?: { at: number; run: () => void }): Promise<boolean> {
    const video = this.videos.get(name);
    if (!video || this.clock.fastForward || video.readyState < 2) return false;
    const sprite = new Sprite(new Texture({ source: new VideoSource({ resource: video, autoPlay: false, loop: false }) }));
    sprite.anchor.set(0.5, 1);
    sprite.height = 560;
    sprite.scale.x = sprite.scale.y;
    sprite.position.set(STAGE.width - 230, STAGE.height + 20);
    const shade = new Graphics().rect(0, 0, STAGE.width, STAGE.height).fill({ color: 0x000000, alpha: 0.35 });
    this.fxLayer.addChild(shade, sprite);
    const durationMs = (video.duration || 3) * 1000;
    try {
      video.currentTime = 0;
      video.playbackRate = this.clock.speed;
      void video.play().catch(() => {});
      let beaten = false;
      await this.clock.tween(durationMs, (t) => {
        // Въезд снизу и уход в конце
        const k = t < 0.12 ? easeOutBack(t / 0.12) : t > 0.9 ? 1 - (t - 0.9) / 0.1 : 1;
        sprite.y = STAGE.height + 20 + (1 - k) * 420;
        shade.alpha = Math.min(1, k);
        if (!beaten && onBeat && t >= onBeat.at) {
          beaten = true;
          onBeat.run();
        }
      });
    } finally {
      video.pause();
      shade.destroy();
      sprite.destroy({ texture: true, textureSource: true });
    }
    return true;
  }

  private async preload() {
    const { participants, manifest } = this.opts;
    const available = new Set(Object.keys(manifest.characters));
    const needed = [...participants.map((p) => assetKey(p, participants, available)), `defendant-${this.defendantKind}`];
    const files = manifestFiles(manifest, needed);
    await Promise.all(
      files.map(async (f) => {
        try {
          this.textures.set(f, await Assets.load<Texture>(`/assets/${f}`));
        } catch {
          // Файла нет — будет заглушка
        }
      }),
    );
  }

  private build() {
    this.app.stage.addChild(this.root);
    this.root.addChild(this.world);
    this.world.addChild(this.floorLayer, this.actorsLayer, this.overlayLayer, this.fxLayer);
    this.actorsLayer.sortableChildren = true;

    this.drawRoom();

    const { participants, manifest } = this.opts;
    for (const p of participants) {
      const actor = new Actor(this.clock, {
        name: p.name,
        color: ROLE_COLORS[p.role],
        face: "😌",
        badge: ROLE_BADGES[p.role],
        assets: manifest.characters[assetKey(p, participants, new Set(Object.keys(manifest.characters)))],
        textures: this.textures,
      });
      this.actors.set(p.id, actor);
      this.actorsLayer.addChild(actor.view);
      this.overlayLayer.addChild(actor.overlay);
    }
    const defendant = new Actor(this.clock, {
      name: "Подсудимый",
      color: ROLE_COLORS.defendant,
      face: MOOD_FACES.calm,
      badge: DEFENDANT_ICONS[this.defendantKind],
      assets: manifest.characters[`defendant-${this.defendantKind}`],
      textures: this.textures,
      // Подсудимый ниже остальных: стоит ближе к зрителю и не должен закрывать трибуну
      spriteHeight: 150,
    });
    this.actors.set(DEFENDANT_ID, defendant);
    this.actorsLayer.addChild(defendant.view);
    this.overlayLayer.addChild(defendant.overlay);
    defendant.view.addChild(this.sweatG);
    defendant.extra = (now) => this.drawSweat(now);

    this.reset();
    this.fit();
    this.app.renderer.on("resize", () => this.fit());
    this.app.ticker.add((ticker) => {
      this.clock.advance(ticker.deltaMS);
      for (const a of this.actors.values()) a.tick(this.clock.now);
    });
  }

  /** Сцена 1280×720 вписывается в ширину контейнера. */
  private fit() {
    const s = Math.min(this.app.screen.width / STAGE.width, this.app.screen.height / STAGE.height);
    this.root.scale.set(s);
    this.root.position.set((this.app.screen.width - STAGE.width * s) / 2, (this.app.screen.height - STAGE.height * s) / 2);
  }

  private tex(path: string | undefined) {
    return path ? this.textures.get(path) : undefined;
  }

  /** Спрайт объекта из манифеста: опорная точка — середина низа, ширина задаётся. */
  private objectSprite(name: string, x: number, bottom: number, width: number): Sprite | null {
    const t = this.tex(this.opts.manifest.objects[name]);
    if (!t) return null;
    const s = new Sprite(t);
    s.anchor.set(0.5, 1);
    s.width = width;
    s.scale.y = s.scale.x;
    s.position.set(x, bottom);
    s.zIndex = bottom;
    return s;
  }

  private drawRoom() {
    const { backgrounds } = this.opts.manifest;
    const bgTex = this.tex(backgrounds.default);
    if (bgTex) {
      const cover = (t: Texture) => {
        const sprite = new Sprite(t);
        sprite.width = STAGE.width;
        sprite.height = STAGE.height;
        return sprite;
      };
      this.floorLayer.addChild(cover(bgTex));
      // Вариант освещения для вердикта — проявляется поверх основного фона
      const verdictTex = this.tex(backgrounds.verdict);
      if (verdictTex) {
        this.verdictBg = cover(verdictTex);
        this.verdictBg.alpha = 0;
        this.floorLayer.addChild(this.verdictBg);
      }
      // Ложа присяжных и скамья зрителей на нарисованном фоне отсутствуют — ставим спрайтами
      const jury = this.objectSprite("jury-box", JURY_BOX.x, JURY_BOX.bottom, JURY_BOX.width);
      if (jury) this.floorLayer.addChild(jury);
    } else {
      this.floorLayer.addChild(this.drawPlaceholderRoom());
    }
    // Мебель, которая должна закрывать персонажей (трибуна, столы, ограждение скамьи подсудимых)
    for (const piece of this.drawFrontFurniture()) this.actorsLayer.addChild(piece);
  }

  private drawPlaceholderRoom(): Container {
    const c = new Container();
    const g = new Graphics();
    // стена
    g.rect(0, 0, STAGE.width, 245).fill(0x3d2a1c);
    for (let x = 0; x < STAGE.width; x += 80) g.rect(x, 0, 3, 245).fill({ color: 0x000000, alpha: 0.18 });
    g.rect(0, 238, STAGE.width, 8).fill(0x574030);
    // пол с перспективой досок
    g.rect(0, 245, STAGE.width, STAGE.height - 245).fill(0x2c1e14);
    for (let i = -8; i <= 8; i++) {
      g.moveTo(STAGE.width / 2 + i * 60, 245).lineTo(STAGE.width / 2 + i * 190, STAGE.height).stroke({ width: 2, color: 0x000000, alpha: 0.18 });
    }
    // ковровая дорожка к трибуне
    g.poly([600, 245, 680, 245, 760, STAGE.height, 520, STAGE.height]).fill({ color: 0x6b1f1a, alpha: 0.55 });
    // окна
    for (const x of [140, 1000]) {
      g.roundRect(x, 40, 120, 150, 60).fill({ color: 0xf0d48a, alpha: 0.12 }).roundRect(x, 40, 120, 150, 60).stroke({ width: 4, color: 0x574030 });
    }
    // дверь
    g.roundRect(1170, 85, 90, 125, 8).fill(0x2a1c12).roundRect(1170, 85, 90, 125, 8).stroke({ width: 4, color: 0x574030 });
    g.circle(1245, 150, 4).fill(0xc99a35);
    // ложа присяжных
    g.roundRect(25, 250, 335, 210, 10).fill({ color: 0x3d2a1c, alpha: 0.85 }).roundRect(25, 250, 335, 210, 10).stroke({ width: 3, color: 0x574030 });
    // скамья зрителей
    g.rect(1090, 640, 190, 30).fill(0x3d2a1c);
    c.addChild(g);

    const label = (text: string, x: number, y: number, size = 14) => {
      const t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fill: 0xf3e9d2 } });
      t.alpha = 0.55;
      t.anchor.set(0.5);
      t.position.set(x, y);
      c.addChild(t);
    };
    const crest = new Text({ text: "⚖️", style: { fontFamily: FONT, fontSize: 52 } });
    crest.anchor.set(0.5);
    crest.position.set(640, 80);
    c.addChild(crest);
    label("Ложа присяжных", 192, 475);
    label("Зрители", 1185, 700);
    return c;
  }

  private drawFrontFurniture(): Container[] {
    const pieces: Container[] = [];
    /** Спрайт из ассетов, а если его нет — нарисованная заглушка */
    const place = (name: string, x: number, bottom: number, width: number, fallback: () => Container) => {
      pieces.push(this.objectSprite(name, x, bottom, width) ?? fallback());
    };

    place("podium", SPOTS.podium.x, SPOTS.podium.y + 12, 112, () => {
      const g = new Graphics()
        .poly([-48, 0, 48, 0, 38, -62, -38, -62])
        .fill(0x6b4f3a)
        .poly([-48, 0, 48, 0, 38, -62, -38, -62])
        .stroke({ width: 3, color: 0x3d2a1c })
        .rect(-52, -70, 104, 10)
        .fill(0x8a6a4f);
      g.position.set(SPOTS.podium.x, SPOTS.podium.y + 12);
      g.zIndex = SPOTS.podium.y + 12;
      return g;
    });

    // Стол закрывает нижнюю часть сидящего, но не табличку с именем под ногами
    for (const x of [SPOTS.prosecutorTable.x, SPOTS.defenseTable.x]) {
      place("counsel-table", x, SPOTS.prosecutorTable.y + 2, 210, () => {
        const g = new Graphics().rect(-95, -34, 190, 32).fill(0x574030).rect(-95, -34, 190, 32).stroke({ width: 3, color: 0x3d2a1c });
        g.position.set(x, SPOTS.prosecutorTable.y + 2);
        g.zIndex = SPOTS.prosecutorTable.y + 2;
        return g;
      });
    }

    place("dock", SPOTS.dock.x, SPOTS.dock.y + 2, 190, () => {
      const dock = new Graphics();
      for (let x = -80; x <= 80; x += 20) dock.rect(x - 2, -48, 4, 48).fill(0x8a6a4f);
      dock.rect(-86, -52, 172, 8).fill(0x8a6a4f).rect(-86, -4, 172, 6).fill(0x574030);
      dock.position.set(SPOTS.dock.x, SPOTS.dock.y + 2);
      dock.zIndex = SPOTS.dock.y + 2;
      return dock;
    });

    // Стол судьи, секретаря и место свидетеля стоят перед персонажами: видно только верхнюю половину
    const desk = (x: number, y: number, w: number, h: number, caption?: string) => () => {
      const c = new Container();
      const g = new Graphics().rect(-w / 2, -h, w, h).fill(0x574030).rect(-w / 2, -h, w, h).stroke({ width: 3, color: 0x3d2a1c });
      g.rect(-w / 2 - 6, -h - 8, w + 12, 10).fill(0x6b4f3a);
      c.addChild(g);
      if (caption) {
        const t = new Text({ text: caption, style: { fontFamily: FONT, fontSize: 14, fill: 0xf3e9d2 } });
        t.alpha = 0.6;
        t.anchor.set(0.5);
        t.position.set(0, -h / 2);
        c.addChild(t);
      }
      c.position.set(x, y);
      c.zIndex = y;
      return c;
    };
    place("judge-bench", SPOTS.judgeBench.x, SPOTS.judgeBench.y + 28, 320, desk(SPOTS.judgeBench.x, SPOTS.judgeBench.y + 28, 300, 72, "СУД ИДЁТ"));
    place("secretary-desk", SPOTS.secretaryDesk.x, SPOTS.secretaryDesk.y + 22, 150, desk(SPOTS.secretaryDesk.x, SPOTS.secretaryDesk.y + 22, 130, 48));
    place("witness-stand", SPOTS.witnessStand.x, SPOTS.witnessStand.y + 22, 130, desk(SPOTS.witnessStand.x, SPOTS.witnessStand.y + 22, 110, 52));

    // Только с ассетами: перила ложи присяжных перед присяжными и скамья зрителей перед свидетелем
    const juryFront = this.objectSprite("jury-box-front", JURY_BOX.x, JURY_BOX.bottom, JURY_BOX.width);
    if (juryFront) pieces.push(juryFront);
    const gallery = this.objectSprite("gallery-bench", SPOTS.gallery.x, SPOTS.gallery.y + 14, 210);
    if (gallery) pieces.push(gallery);
    return pieces;
  }

  /* ---------------- Состояние ---------------- */

  private actor(id: string) {
    return this.actors.get(id);
  }

  private seat(id: string) {
    const p = this.opts.participants.find((x) => x.id === id);
    return p ? seatOf(p, this.opts.participants) : SPOTS.dock;
  }

  /** Начало заседания: все на местах, судьи ещё нет. */
  reset() {
    this.gavelPlayed = false;
    this.clock.flush();
    this.clearVerdict();
    for (const [id, a] of this.actors) {
      a.hideBubble();
      a.hideScore();
      a.setPresent(true);
      a.setVisible(true);
      a.setEmotion("calm", 1);
      a.place(id === DEFENDANT_ID ? SPOTS.dock : this.seat(id));
    }
    this.setMood("calm");
    const judge = this.actor(this.judgeId);
    judge?.place(SPOTS.door);
    judge?.setVisible(false);
  }

  /** Мгновенно привести сцену к состоянию (пропуск анимации, открытие завершённого дела). */
  applyState(state: SceneState) {
    this.clock.flush();
    this.clearVerdict();
    for (const [id, a] of this.actors) {
      a.hideBubble();
      a.hideScore();
      a.setVisible(true);
      a.place(id === DEFENDANT_ID ? SPOTS.dock : this.seat(id));
      a.setPresent(!state.absent.includes(id));
      const emo = state.emotions[id];
      a.setEmotion(emo?.emotion ?? "calm", emo?.intensity ?? 1);
    }
    const judge = this.actor(this.judgeId);
    if (!state.judgePresent) {
      judge?.place(SPOTS.door);
      judge?.setVisible(false);
    }
    this.setMood(state.mood);
    if (state.verdict) this.showVerdictFinal(state.verdict);
  }

  setFastForward(on: boolean) {
    this.clock.fastForward = on;
    if (on) this.clock.flush();
  }

  setSpeed(speed: number) {
    this.clock.speed = speed;
  }

  /* ---------------- Исполнение шагов ---------------- */

  async run(step: Step): Promise<void> {
    if (this.destroyed) return;
    switch (step.kind) {
      case "say": {
        const a = this.actor(step.who);
        if (!a) return;
        if (step.emotion) a.setEmotion(step.emotion, step.intensity ?? 1);
        if (step.score !== undefined) a.showScore(step.score, step.delta ?? null);
        await a.say(step.text, step.ms, step.who === this.judgeId ? 420 : 320);
        a.hideScore();
        return;
      }
      case "walk": {
        const a = this.actor(step.who);
        const p = this.opts.participants.find((x) => x.id === step.who);
        if (!a || !p) return;
        await a.walkTo(step.to === "speak" ? speakingSpot(p) : seatOf(p, this.opts.participants), step.ms);
        return;
      }
      case "emotion":
        this.actor(step.who)?.setEmotion(step.emotion, step.intensity);
        return;
      case "absent":
        this.actor(step.who)?.setPresent(step.present);
        return;
      case "parallel":
        await Promise.all(step.steps.map((s) => this.run(s)));
        return;
      case "pause":
        await this.clock.wait(step.ms);
        return;
      case "banner":
        await this.banner(step.text, step.ms);
        return;
      case "judgeEnter":
      case "judgeReturn": {
        const judge = this.actor(this.judgeId);
        if (!judge) return;
        judge.place(SPOTS.door);
        judge.setVisible(true);
        judge.view.alpha = 1;
        await judge.walkTo(SPOTS.judgeBench, step.ms);
        return;
      }
      case "judgeLeave": {
        const judge = this.actor(this.judgeId);
        if (!judge) return;
        await judge.walkTo(SPOTS.door, step.ms);
        judge.setVisible(false);
        return;
      }
      case "gavel":
        await this.gavel(step.ms);
        return;
      case "mood":
        this.setMood(step.mood);
        await this.bounce(DEFENDANT_ID, step.ms);
        return;
      case "drumroll":
        await this.drumroll(step.ms);
        return;
      case "verdict":
        await this.verdict(step.verdict, step.ms);
        return;
    }
  }

  private setMood(mood: DefendantMood) {
    const d = this.actor(DEFENDANT_ID);
    if (!d) return;
    d.setFace(MOOD_FACES[mood], mood);
    // Капли пота, когда дела плохи (если настроение не нарисовано в ассете — там пот уже есть)
    this.sweatDrops = d.hasMood(mood) ? 0 : mood === "sweating" ? 3 : mood === "nervous" ? 1 : 0;
  }

  private drawSweat(now: number) {
    const g = this.sweatG;
    g.clear();
    for (let i = 0; i < this.sweatDrops; i++) {
      const t = (now / 900 + i / this.sweatDrops) % 1;
      g.circle(22 + i * 6, -112 + t * 30, 3 + (1 - t)).fill({ color: 0x9ed8ff, alpha: 1 - t });
    }
  }

  private async bounce(id: string, ms: number) {
    const a = this.actor(id);
    if (!a) return;
    const base = a.view.y;
    await this.clock.tween(ms, (t) => {
      a.view.y = base - Math.sin(t * Math.PI * 3) * 10 * (1 - t);
    });
    a.view.y = base;
  }

  private async banner(text: string, ms: number) {
    const t = new Text({
      text,
      style: { fontFamily: DISPLAY_FONT, fontSize: 54, fontWeight: "700", fill: 0xf0d48a, dropShadow: { color: 0x000000, alpha: 0.8, blur: 8, distance: 0 } },
    });
    t.anchor.set(0.5);
    t.position.set(STAGE.width / 2, 330);
    this.fxLayer.addChild(t);
    await this.clock.tween(ms, (k) => {
      t.alpha = k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1;
      t.scale.set(0.9 + 0.1 * easeOutBack(Math.min(1, k * 3)));
    });
    t.destroy();
  }

  private async shake(ms: number, amp: number) {
    await this.clock.tween(ms, (t) => {
      const k = (1 - t) * amp;
      this.world.position.set(Math.sin(t * 90) * k, Math.cos(t * 70) * k * 0.6);
    });
    this.world.position.set(0, 0);
  }

  private async gavel(ms: number) {
    // Есть видео удара — показываем крупный план, тряска в момент удара
    if (!this.gavelPlayed && (await this.cutaway("gavel", { at: 0.55, run: () => void this.shake(500, 8) }))) {
      this.gavelPlayed = true;
      return;
    }
    await this.gavelSprite(ms);
  }

  private async gavelSprite(ms: number) {
    const gavelTex = this.tex(this.opts.manifest.objects["gavel"]);
    const g = gavelTex ? new Sprite(gavelTex) : new Text({ text: "🔨", style: { fontFamily: FONT, fontSize: 64 } });
    if (gavelTex) {
      g.width = 96;
      g.scale.y = g.scale.x;
    }
    g.anchor.set(0.2, 0.8);
    g.position.set(SPOTS.judgeBench.x + 110, 150);
    this.fxLayer.addChild(g);
    await this.clock.tween(ms * 0.45, (t) => (g.rotation = -0.9 * (1 - easeInOut(t))));
    const ring = new Graphics();
    this.fxLayer.addChild(ring);
    await Promise.all([
      this.shake(ms * 0.55, 6),
      this.clock.tween(ms * 0.55, (t) => {
        ring.clear().circle(SPOTS.judgeBench.x + 95, 150, 10 + t * 70).stroke({ width: 4, color: 0xf0d48a, alpha: 1 - t });
      }),
    ]);
    ring.destroy();
    g.destroy();
  }

  private async drumroll(ms: number) {
    const t = new Text({ text: "🥁 Барабанная дробь…", style: { fontFamily: DISPLAY_FONT, fontSize: 34, fill: 0xf3e9d2, fontStyle: "italic" } });
    t.anchor.set(0.5);
    t.position.set(STAGE.width / 2, 330);
    this.fxLayer.addChild(t);
    await this.clock.tween(ms, (k) => {
      t.alpha = Math.min(1, k * 4, (1 - k) * 4);
      t.x = STAGE.width / 2 + Math.sin(k * 120) * 3;
    });
    t.destroy();
  }

  /* ---------------- Вердикт ---------------- */

  private clearVerdict() {
    if (this.verdictBg) this.verdictBg.alpha = 0;
    this.verdictView?.destroy({ children: true });
    this.verdictView = null;
    for (const c of this.confetti) c.destroy();
    this.confetti = [];
  }

  private buildVerdictPanel(v: Verdict) {
    const view = new Container();
    const dim = new Graphics().rect(0, 0, STAGE.width, STAGE.height).fill({ color: 0x000000, alpha: 0.45 });
    const panel = new Container();
    const outcome = OUTCOME_TEXT[v.outcome];
    const box = new Graphics()
      .roundRect(-300, -40, 600, 250, 24)
      .fill({ color: 0x140d08, alpha: 0.92 })
      .roundRect(-300, -40, 600, 250, 24)
      .stroke({ width: 4, color: 0xc99a35 });
    const plaqueTex = this.tex(this.opts.manifest.objects["verdict-plaque"]);
    const plaque = plaqueTex
      ? new Sprite(plaqueTex)
      : new Text({ text: "VERDICT", style: { fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: "700", fill: 0xc99a35, letterSpacing: 10 } });
    if (plaqueTex) {
      plaque.width = 300;
      plaque.scale.y = plaque.scale.x;
    }
    plaque.anchor.set(0.5);
    plaque.position.set(0, plaqueTex ? -40 : -8);
    const score = new Text({ text: "0%", style: { fontFamily: DISPLAY_FONT, fontSize: 104, fontWeight: "700", fill: 0xf0d48a } });
    score.anchor.set(0.5);
    score.position.set(0, 82);
    const title = new Text({ text: outcome.title, style: { fontFamily: DISPLAY_FONT, fontSize: 34, fontWeight: "700", fill: outcome.color } });
    title.anchor.set(0.5);
    title.position.set(0, 168);
    panel.addChild(box, plaque, score, title);
    panel.position.set(STAGE.width / 2, 200);
    view.addChild(dim, panel);
    return { view, dim, panel, score, title };
  }

  private showVerdictFinal(v: Verdict) {
    const { view, score } = this.buildVerdictPanel(v);
    score.text = `${v.success_score}%`;
    if (this.verdictBg) this.verdictBg.alpha = 1;
    this.fxLayer.addChild(view);
    this.verdictView = view;
    this.applyOutcomePose(v.outcome);
  }

  private applyOutcomePose(outcome: Verdict["outcome"]) {
    const d = this.actor(DEFENDANT_ID);
    if (!d) return;
    this.sweatDrops = 0;
    if (outcome === "acquitted") d.setFace(MOOD_FACES.ecstatic, "ecstatic");
    if (outcome === "conditional") d.setFace("📝", "calm");
    if (outcome === "guilty") d.setVisible(false);
  }

  private async verdict(v: Verdict, ms: number) {
    this.clearVerdict();
    await this.cutaway("verdict");
    const { view, dim, panel, score, title } = this.buildVerdictPanel(v);
    this.fxLayer.addChild(view);
    this.verdictView = view;
    title.alpha = 0;
    const verdictBg = this.verdictBg;
    await this.clock.tween(350, (t) => {
      if (verdictBg) verdictBg.alpha = t;
      dim.alpha = t;
      panel.scale.set(0.6 + 0.4 * easeOutBack(t));
      panel.alpha = t;
    });
    await this.clock.tween(ms * 0.35, (t) => (score.text = `${Math.round(v.success_score * easeInOut(t))}%`));
    await this.clock.tween(300, (t) => {
      title.alpha = t;
      title.scale.set(1.4 - 0.4 * t);
    });
    const d = this.actor(DEFENDANT_ID)!;
    const rest = ms * 0.65 - 650;
    if (v.outcome === "acquitted") {
      d.setFace(MOOD_FACES.ecstatic, "ecstatic");
      this.sweatDrops = 0;
      await Promise.all([this.confettiBurst(rest), this.bounce(DEFENDANT_ID, rest)]);
    } else if (v.outcome === "conditional") {
      // Подсудимому вручают список исправлений
      const list = new Text({ text: "📜", style: { fontFamily: FONT, fontSize: 44 } });
      list.anchor.set(0.5);
      this.fxLayer.addChild(list);
      const from = { x: SPOTS.judgeBench.x, y: 150 };
      const to = { x: SPOTS.dock.x + 40, y: SPOTS.dock.y - 90 };
      await this.clock.tween(rest * 0.6, (t) => {
        const k = easeInOut(t);
        list.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * 120);
        list.rotation = k * Math.PI * 2;
      });
      list.destroy();
      d.setFace("📝", "calm");
      this.sweatDrops = 0;
      await this.clock.wait(rest * 0.4);
    } else {
      // Подсудимого уводят
      d.setFace(MOOD_FACES.sweating, "sweating");
      this.sweatDrops = 3;
      await d.walkTo(SPOTS.exit, rest);
      d.setVisible(false);
    }
  }

  private async confettiBurst(ms: number) {
    const colors = [0xf0d48a, 0x7fd49a, 0x6da7ec, 0xe87ba4, 0xffffff, 0xd95926];
    const pieces = Array.from({ length: 140 }, (_, i) => {
      const g = new Graphics().rect(-4, -7, 8, 14).fill(colors[i % colors.length]);
      g.position.set(Math.random() * STAGE.width, -20 - Math.random() * 300);
      this.fxLayer.addChild(g);
      this.confetti.push(g);
      return { g, vy: 0.25 + Math.random() * 0.35, vx: (Math.random() - 0.5) * 0.15, spin: (Math.random() - 0.5) * 0.02, y0: g.y, x0: g.x };
    });
    await this.clock.tween(ms, (t) => {
      const elapsed = t * ms;
      for (const p of pieces) {
        p.g.y = p.y0 + elapsed * p.vy;
        p.g.x = p.x0 + elapsed * p.vx + Math.sin(elapsed / 200 + p.x0) * 12;
        p.g.rotation = elapsed * p.spin;
        p.g.alpha = t > 0.8 ? (1 - t) / 0.2 : 1;
      }
    });
    for (const p of pieces) p.g.destroy();
    this.confetti = [];
  }

  destroy() {
    this.destroyed = true;
    for (const v of this.videos.values()) {
      v.pause();
      v.removeAttribute("src");
      v.load();
    }
    this.clock.flush();
    this.app.destroy({ removeView: true }, { children: true });
  }
}
