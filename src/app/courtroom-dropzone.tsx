"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";

export type DefendantLook = "film" | "frame" | "folder" | "scroll";

const LOOK_PRIORITY: DefendantLook[] = ["film", "frame", "folder", "scroll"];
const LOOK_TITLES: Record<DefendantLook, string> = {
  film: "Подсудимый-кинопленка",
  frame: "Подсудимый-рамка",
  folder: "Подсудимый-папка",
  scroll: "Подсудимый-свиток",
};

/** Как выглядит подсудимый для файла этого типа. */
export function lookOf(mime: string, name = ""): DefendantLook {
  const n = name.toLowerCase();
  if (mime.startsWith("video/") || /\.(mp4|mov|webm|m4v|avi|mkv)$/.test(n)) return "film";
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(n)) return "frame";
  if (mime === "application/pdf" || mime.includes("officedocument") || /\.(pdf|docx)$/.test(n)) return "folder";
  return "scroll";
}

/** Главный подсудимый — по самому «яркому» вложению: видео > картинка > документ > текст. */
export function primaryLook(looks: DefendantLook[]): DefendantLook | null {
  return LOOK_PRIORITY.find((l) => looks.includes(l)) ?? null;
}

const sprite = (look: DefendantLook) => `/assets/characters/defendant-${look}/idle.webp`;

export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/*,.mp4,.mov,.webm,.m4v,application/pdf,.pdf,.docx,text/plain,.txt,.md,.csv";

/**
 * Пустой зал суда: скамья подсудимых — зона перетаскивания.
 * Пока файл тащат, у курсора — карточка-персонаж; после броска его «уводят» и садят на скамью.
 */
export function CourtroomDropzone({
  look,
  onFiles,
  disabled,
}: {
  /** Кто сейчас сидит на скамье (null — пусто) */
  look: DefendantLook | null;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; look: DefendantLook } | null>(null);
  const [landing, setLanding] = useState<{ x: number; y: number; toX: number; toY: number; look: DefendantLook } | null>(null);
  const depth = useRef(0);

  const local = (e: React.DragEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // Во время перетаскивания доступны только типы файлов, не имена
  const draggedLook = (e: React.DragEvent): DefendantLook =>
    primaryLook([...e.dataTransfer.items].filter((i) => i.kind === "file").map((i) => lookOf(i.type))) ?? "scroll";

  function accept(files: File[], from?: { x: number; y: number }) {
    if (!files.length) return;
    const l = primaryLook(files.map((f) => lookOf(f.type, f.name)))!;
    if (from && ref.current) {
      // Куда «садят»: на скамью подсудимых (размеры совпадают с позицией сидящего подсудимого)
      const { clientWidth: w, clientHeight: h } = ref.current;
      setLanding({ ...from, toX: w / 2 - (h * 0.42 * 0.75) / 2, toY: h * 0.49, look: l });
    }
    onFiles(files);
  }

  const dockLeft = "50%";
  const seated = look && !landing;

  return (
    <div
      ref={ref}
      className={`relative aspect-[16/8] w-full select-none overflow-hidden rounded-2xl border-2 bg-wood-900 bg-cover bg-center transition-colors ${
        drag ? "border-brass-400" : "border-wood-700"
      }`}
      style={{ backgroundImage: "url(/assets/bg/default.jpg)" }}
      onDragEnter={(e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current++;
        setDrag({ ...local(e), look: draggedLook(e) });
      }}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        const p = local(e);
        setDrag((d) => (d ? { ...d, ...p } : { ...p, look: draggedLook(e) }));
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDrag(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        const from = local(e);
        setDrag(null);
        if (!disabled) accept([...e.dataTransfer.files], from);
      }}
    >
      {/* Затемнение снизу, чтобы подсказки читались */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-wood-950/70 via-transparent to-wood-950/30" />

      {/* Стол судьи — декорация */}
      {/* eslint-disable-next-line @next/next/no-img-element -- статичные ассеты */}
      <img src="/assets/objects/judge-bench.webp" alt="" className="pointer-events-none absolute left-1/2 top-[14%] w-[30%] -translate-x-1/2" />

      {/* Подсудимый на скамье */}
      <AnimatePresence>
        {seated && (
          <motion.img
            key={look}
            src={sprite(look)}
            alt={LOOK_TITLES[look]}
            initial={{ y: -40, opacity: 0, scale: 0.8 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 260, damping: 14 }}
            className="pointer-events-none absolute bottom-[9%] h-[42%] -translate-x-1/2"
            style={{ left: dockLeft }}
          />
        )}
      </AnimatePresence>

      {/* Скамья подсудимых — перила стоят перед подсудимым */}
      {/* eslint-disable-next-line @next/next/no-img-element -- статичные ассеты */}
      <img src="/assets/objects/dock.webp" alt="" className="pointer-events-none absolute bottom-[4%] left-1/2 w-[26%] -translate-x-1/2" />

      {/* Пустая скамья: подсказка и кнопка выбора */}
      {!look && !drag && (
        <div className="absolute inset-x-0 bottom-[30%] flex flex-col items-center gap-2 text-center">
          <div className="rounded-full bg-wood-950/80 px-4 py-2 font-display text-lg text-parchment shadow-lg">
            Перетащите подсудимого на скамью
          </div>
          <div className="text-sm text-parchment/80">картинка, видео, PDF, DOCX или текстовый файл</div>
        </div>
      )}

      {/* Подсветка скамьи как цели броска */}
      {drag && (
        <motion.div
          className="pointer-events-none absolute bottom-[3%] left-1/2 h-[46%] w-[30%] -translate-x-1/2 rounded-3xl border-4 border-dashed border-brass-400 bg-brass-400/10"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
      )}

      {/* Карточка-персонаж у курсора */}
      {drag && (
        <motion.div
          className="pointer-events-none absolute z-10 flex w-28 flex-col items-center rounded-2xl border-2 border-brass-400 bg-wood-950/90 p-2 shadow-2xl"
          animate={{ left: drag.x - 56, top: drag.y - 90, rotate: [-4, 4, -4] }}
          transition={{ left: { type: "spring", stiffness: 500, damping: 40 }, top: { type: "spring", stiffness: 500, damping: 40 }, rotate: { duration: 0.8, repeat: Infinity } }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- статичные ассеты */}
          <img src={sprite(drag.look)} alt="" className="h-24" />
          <span className="text-center text-[11px] leading-tight text-parchment/80">{LOOK_TITLES[drag.look]}</span>
        </motion.div>
      )}

      {/* «Уводят» на скамью: полёт от точки броска */}
      {landing && (
        <motion.img
          src={sprite(landing.look)}
          alt=""
          className="pointer-events-none absolute z-10 h-[42%]"
          initial={{ left: landing.x - 50, top: landing.y - 100, scale: 0.7, rotate: -10 }}
          animate={{ left: landing.toX, top: landing.toY, scale: 1, rotate: 0 }}
          transition={{ duration: 0.7, ease: [0.3, 1.4, 0.5, 1] }}
          onAnimationComplete={() => setLanding(null)}
        />
      )}

      {!disabled && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="absolute right-3 top-3 rounded-lg bg-wood-950/80 px-3 py-1.5 text-sm text-parchment hover:text-brass-300"
        >
          📎 Выбрать файлы
        </button>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          accept([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
