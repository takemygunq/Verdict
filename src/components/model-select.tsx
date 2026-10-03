"use client";

import type { ProviderView } from "@/lib/store/providers";
import type { ModelRef } from "@/lib/trial/schemas";
import { inputCls } from "./ui";

/** Выбор модели из всех включённых провайдеров. */
export function ModelSelect({
  value,
  providers,
  onChange,
  emptyLabel,
  className = "",
}: {
  value: ModelRef | null;
  providers: ProviderView[];
  onChange: (v: ModelRef | null) => void;
  /** Если задан — можно выбрать «пусто» */
  emptyLabel?: string;
  className?: string;
}) {
  const encoded = value ? `${value.providerId}|${value.modelId}` : "";
  const available = providers.filter((p) => p.enabled && p.models.length);
  const known = !value || available.some((p) => p.id === value.providerId && p.models.some((m) => m.id === value.modelId));
  return (
    <select
      className={`${inputCls} ${className}`}
      value={encoded}
      onChange={(e) => {
        const [providerId, ...rest] = e.target.value.split("|");
        onChange(providerId ? { providerId, modelId: rest.join("|") } : null);
      }}
    >
      {(emptyLabel !== undefined || !value) && <option value="">{emptyLabel ?? "— выберите модель —"}</option>}
      {!known && value && <option value={encoded}>⚠ недоступна: {value.modelId}</option>}
      {available.map((p) => (
        <optgroup key={p.id} label={p.label}>
          {p.models.map((m) => (
            <option key={m.id} value={`${p.id}|${m.id}`}>
              {m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function modelLabel(ref: ModelRef | null, providers: ProviderView[]): string {
  if (!ref) return "модель не назначена";
  const p = providers.find((x) => x.id === ref.providerId);
  return p ? `${p.label} · ${ref.modelId}` : ref.modelId;
}
