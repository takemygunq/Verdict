import type { DefendantMood } from "@/lib/trial/events";
import type { Emotion, Role, Verdict } from "@/lib/trial/schemas";

export const STATUS_TITLES = {
  draft: "черновик",
  preparing: "подготовка",
  ready: "готово к заседанию",
  running: "идёт заседание",
  done: "вердикт вынесен",
  failed: "заседание сорвано",
} as const;

export const OUTCOME_TITLES: Record<Verdict["outcome"], string> = {
  acquitted: "Оправдан",
  conditional: "Условно, с доработками",
  guilty: "Виновен в скучности",
};

export const OUTCOME_STYLES: Record<Verdict["outcome"], string> = {
  acquitted: "bg-verdict-green/20 text-verdict-green border-verdict-green/40",
  conditional: "bg-brass-500/20 text-brass-300 border-brass-500/40",
  guilty: "bg-verdict-red/20 text-verdict-red border-verdict-red/40",
};

export const CONFIDENCE_TITLES: Record<Verdict["confidence"], string> = {
  low: "низкая",
  medium: "средняя",
  high: "высокая",
};

export const LEVEL_TITLES = { high: "высокое", medium: "среднее", low: "низкое" } as const;
export const EFFORT_TITLES = { high: "высокие", medium: "средние", low: "низкие" } as const;

export const ROLE_ICONS: Record<Role, string> = {
  secretary: "📜",
  judge: "⚖️",
  prosecutor: "🗡️",
  defense: "🛡️",
  witness: "🙋",
  juror: "🎓",
};

export const EMOTION_ICONS: Record<Emotion, string> = {
  calm: "😌",
  confident: "😎",
  angry: "😠",
  skeptical: "🤨",
  surprised: "😲",
  laughing: "😂",
  thinking: "🤔",
  sad: "😢",
};

export const MOOD: Record<DefendantMood, { icon: string; text: string }> = {
  ecstatic: { icon: "🤩", text: "Подсудимый ликует" },
  happy: { icon: "😊", text: "Подсудимый приободрился" },
  calm: { icon: "😐", text: "Подсудимый держится спокойно" },
  nervous: { icon: "😰", text: "Подсудимый нервничает" },
  sweating: { icon: "🥵", text: "Подсудимый обливается потом" },
};
