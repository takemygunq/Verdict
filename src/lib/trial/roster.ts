import type { ProviderView } from "../store/providers";
import type { Settings } from "../store/settings";
import type { ModelRef, Participant, SecretaryPrepare } from "./schemas";

/** По одной модели от каждого включённого провайдера: его модель по умолчанию или первая в списке. */
export function modelPool(providers: ProviderView[]): ModelRef[] {
  return providers
    .filter((p) => p.enabled && p.models.length)
    .map((p) => ({ providerId: p.id, modelId: p.defaultModel ?? p.models[0].id }));
}

function usable(ref: ModelRef | null, providers: ProviderView[]): ref is ModelRef {
  return !!ref && providers.some((p) => p.id === ref.providerId && p.enabled);
}

/** Модели секретаря и судьи: из настроек, иначе автоматически — по возможности от разных провайдеров. */
export function officialsModels(providers: ProviderView[], settings: Settings) {
  const pool = modelPool(providers);
  if (!pool.length) {
    throw new NoModelsError("Нет ни одного включённого провайдера с моделями. Добавьте провайдера в настройках.");
  }
  const secretary = usable(settings.secretaryModel, providers) ? settings.secretaryModel : pool[0];
  const judge = usable(settings.judgeModel, providers)
    ? settings.judgeModel
    : (pool.find((m) => m.providerId !== secretary.providerId) ?? secretary);
  return { secretary, judge, pool };
}

export class NoModelsError extends Error {}

/**
 * Состав суда из ответа секретаря. Модели спорящих сторон распределяются по провайдерам по кругу,
 * чтобы мнения были действительно разными.
 */
export function buildParticipants(
  prep: SecretaryPrepare,
  models: { secretary: ModelRef; judge: ModelRef; pool: ModelRef[] },
  names: { secretary: string; judge: string } = { secretary: "Секретарь Протоколова", judge: "Судья Вердиктов" },
): Participant[] {
  const debaters: Omit<Participant, "model">[] = [
    { id: "prosecutor", role: "prosecutor", name: prep.prosecutor.name, specialization: "", character: prep.prosecutor.character },
    { id: "defense", role: "defense", name: prep.defense.name, specialization: "", character: prep.defense.character },
    {
      id: "witness",
      role: "witness",
      name: prep.witness.name,
      specialization: `${prep.witness.segment}, ${prep.witness.age} лет`,
      character: prep.witness.character,
    },
    ...prep.jurors.map((j, i) => ({
      id: `juror-${i + 1}`,
      role: "juror" as const,
      name: j.name,
      specialization: j.specialization,
      character: j.character,
    })),
  ];

  // Начинаем распределение с провайдера, отличного от судьи, чтобы судья был «со стороны».
  const pool = models.pool.length ? models.pool : [models.secretary];
  const start = Math.max(0, pool.findIndex((m) => m.providerId !== models.judge.providerId));

  return [
    { id: "secretary", role: "secretary", name: names.secretary, specialization: "", character: "", model: models.secretary },
    { id: "judge", role: "judge", name: names.judge, specialization: "", character: "", model: models.judge },
    ...dedupeNames(debaters).map((d, i) => ({ ...d, model: pool[(start + i) % pool.length] })),
  ];
}

/** Имена должны быть уникальны: по ним участники обращаются друг к другу. */
function dedupeNames<T extends { name: string }>(list: T[]): T[] {
  const seen = new Map<string, number>();
  return list.map((p) => {
    const n = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, n);
    return n === 1 ? p : { ...p, name: `${p.name} ${n}` };
  });
}
