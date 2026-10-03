import type { MaterialType, Participant, Role } from "../trial/schemas";
import { guessGender, type Gender } from "./gender";

/** Логический размер сцены; канвас масштабируется под ширину контейнера. */
export const STAGE = { width: 1280, height: 720 } as const;

export interface Point {
  x: number;
  y: number;
}

/** Ключевые места зала (точки «под ногами» персонажа). */
export const SPOTS = {
  door: { x: 1165, y: 226 },
  judgeBench: { x: 640, y: 205 },
  secretaryDesk: { x: 420, y: 265 },
  witnessStand: { x: 900, y: 285 },
  podium: { x: 640, y: 470 },
  prosecutorTable: { x: 400, y: 545 },
  defenseTable: { x: 880, y: 545 },
  dock: { x: 640, y: 660 },
  gallery: { x: 1185, y: 660 },
  exit: { x: 1340, y: 660 },
} satisfies Record<string, Point>;

/** Ложа присяжных (спрайт из ассетов): центр по x, низ, ширина. */
export const JURY_BOX = { x: 192, bottom: 470, width: 350 } as const;

/** Места в ложе присяжных (слева, два ряда). */
const JURY_SEATS: Point[] = [
  // Шахматный порядок: второй ряд не закрывает лица и имена первого
  { x: 80, y: 300 },
  { x: 235, y: 300 },
  { x: 158, y: 412 },
  { x: 305, y: 412 },
  { x: 80, y: 445 },
  { x: 305, y: 300 },
];

/** Где сидит участник в начале и куда возвращается после выступления. */
export function seatOf(p: Participant, all: Participant[]): Point {
  switch (p.role) {
    case "judge":
      return SPOTS.judgeBench;
    case "secretary":
      return SPOTS.secretaryDesk;
    case "prosecutor":
      return SPOTS.prosecutorTable;
    case "defense":
      return SPOTS.defenseTable;
    case "witness":
      return SPOTS.gallery;
    case "juror": {
      const i = all.filter((x) => x.role === "juror").findIndex((x) => x.id === p.id);
      return JURY_SEATS[Math.max(0, i) % JURY_SEATS.length];
    }
  }
}

/** Куда участник выходит выступать. */
export function speakingSpot(p: Participant): Point {
  return p.role === "witness" ? SPOTS.witnessStand : SPOTS.podium;
}

/** 2.5D: чем ниже на сцене, тем ближе к зрителю и крупнее. */
export const depthScale = (y: number) => 0.78 + (y / STAGE.height) * 0.42;

export const ROLE_COLORS: Record<Role | "defendant", number> = {
  judge: 0x2b2b33,
  secretary: 0x6b5a8e,
  prosecutor: 0xa8433a,
  defense: 0x3d6fa8,
  witness: 0x4f8f6a,
  juror: 0x8a7350,
  defendant: 0xc99a35,
};

export type DefendantKind = "film" | "scroll" | "folder" | "frame";

/** Внешность подсудимого зависит от типа материала. */
export function defendantKind(type: MaterialType): DefendantKind {
  switch (type) {
    case "video_ad":
      return "film";
    case "image_ad":
      return "frame";
    case "strategy":
    case "media_plan":
      return "folder";
    default:
      return "scroll";
  }
}

export const DEFENDANT_ICONS: Record<DefendantKind, string> = {
  film: "🎞️",
  scroll: "📜",
  folder: "📁",
  frame: "🖼️",
};

/** Как нарисованы присяжные в ассетах (см. scripts/assets/sources.json). */
export const JUROR_SPRITES: Record<Gender, string[]> = {
  male: ["juror-1", "juror-4", "juror-5"],
  female: ["juror-2", "juror-3", "juror-6"],
};

/**
 * Ключ персонажа в манифесте ассетов. Присяжным подбирается спрайт подходящего пола
 * (по имени), свидетелю-женщине — witness-female, если такой ассет есть.
 */
export function assetKey(p: Participant, all: Participant[], available?: Set<string>): string {
  if (p.role === "witness") {
    return guessGender(p.name) === "female" && available?.has("witness-female") ? "witness-female" : "witness";
  }
  if (p.role !== "juror") return p.role;
  const jurors = all.filter((x) => x.role === "juror");
  const used = new Set<string>();
  // Распределяем по порядку: каждому — первый свободный спрайт своего пола, иначе любой свободный
  for (const j of jurors) {
    const gender = guessGender(j.name);
    const pool = [...(gender ? JUROR_SPRITES[gender] : []), ...JUROR_SPRITES.male, ...JUROR_SPRITES.female];
    const key = pool.find((k) => !used.has(k)) ?? "juror-1";
    used.add(key);
    if (j.id === p.id) return key;
  }
  return "juror-1";
}
