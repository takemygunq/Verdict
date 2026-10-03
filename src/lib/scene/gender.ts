export type Gender = "male" | "female";

const FEMALE_SURNAME = /(ова|ева|ёва|ина|ына|ая|яя|ская|цкая)$/;
const MALE_SURNAME = /(ов|ев|ёв|ин|ын|ий|ой|ый|ский|цкий)$/;
/** Мужские имена на -а/-я */
const MALE_NAMES = new Set(["илья", "никита", "кузьма", "фома", "лука", "савва", "миша", "саша", "женя", "ваня", "петя", "дима", "коля", "вова", "гоша", "лёва", "лева"]);

/**
 * Пол по русскому имени и фамилии — чтобы подобрать подходящий спрайт.
 * Эвристика: сначала фамилия, затем окончание имени. Неизвестно → null.
 */
export function guessGender(fullName: string): Gender | null {
  const parts = fullName.toLowerCase().replace(/[^a-zа-яё\s-]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const surname = parts.length > 1 ? parts[parts.length - 1] : "";
  if (surname && FEMALE_SURNAME.test(surname)) return "female";
  if (surname && MALE_SURNAME.test(surname)) return "male";
  const first = parts[0];
  if (MALE_NAMES.has(first)) return "male";
  if (/[ая]$/.test(first)) return "female";
  if (/[бвгджзйклмнпрстфхцчшщь]$/.test(first)) return "male";
  return null;
}
