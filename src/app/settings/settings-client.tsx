"use client";

import { useState } from "react";
import { ModelSelect } from "@/components/model-select";
import { Section, btnCls, inputCls, primaryBtnCls } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { ProviderKind } from "@/lib/providers/types";
import type { ProviderView } from "@/lib/store/providers";
import type { Settings } from "@/lib/store/settings";

const KIND_TITLES: Record<ProviderKind, string> = {
  anthropic: "Anthropic API",
  openai: "OpenAI API",
  gemini: "Google Gemini API",
  openrouter: "OpenRouter",
  ollama: "Ollama (локальные модели)",
  "claude-cli": "Claude Code (подписка)",
  "codex-cli": "Codex CLI (подписка ChatGPT)",
  "gemini-cli": "Gemini CLI (аккаунт Google)",
  demo: "Демо (без модели)",
};

const KEY_HELP: Record<ProviderKind, string> = {
  anthropic: "Ключ: console.anthropic.com → API Keys",
  openai: "Ключ: platform.openai.com → API keys",
  gemini: "Ключ: aistudio.google.com → Get API key",
  openrouter: "Ключ: openrouter.ai → Keys. Проще — кнопка «Войти через OpenRouter» выше.",
  ollama:
    "Ключ не нужен. Установите Ollama (ollama.com), скачайте модель (ollama pull llama3.2) и держите запущенным ollama serve.",
  "claude-cli":
    "Ключ не нужен. Нужна программа Claude Code (npm i -g @anthropic-ai/claude-code) и вход в терминале: claude auth login.",
  "codex-cli": "Ключ не нужен. Нужна программа Codex (npm i -g @openai/codex) и вход в терминале: codex login.",
  "gemini-cli":
    "Ключ не нужен. Нужна программа Gemini CLI (npm i -g @google/gemini-cli); запустите gemini один раз и войдите через Google.",
  demo: "Ключ не нужен. Демо-провайдер разыгрывает правдоподобное заседание без реальных моделей — для проверки интерфейса.",
};

const KEYLESS: ProviderKind[] = ["demo", "ollama", "claude-cli", "codex-cli", "gemini-cli"];
const CLI: ProviderKind[] = ["claude-cli", "codex-cli", "gemini-cli"];

const CLI_TERMS =
  "Verdict вызывает установленную у вас программу от вашего имени. Использование подписки через сторонние приложения регулируется условиями провайдера — проверьте их самостоятельно.";

function addressLabel(kind: ProviderKind): { title: string; placeholder: string } {
  if (CLI.includes(kind)) return { title: "Путь к программе (если её нет в PATH)", placeholder: kind.replace("-cli", "") };
  if (kind === "ollama") return { title: "Адрес Ollama", placeholder: "http://localhost:11434/v1" };
  return { title: "Base URL (если используете прокси или совместимый шлюз)", placeholder: "https://…" };
}

export function SettingsClient({
  initialProviders,
  initialSettings,
  oauth,
}: {
  initialProviders: ProviderView[];
  initialSettings: Settings;
  oauth: { ok: boolean; message?: string } | null;
}) {
  const [providers, setProviders] = useState(initialProviders);

  const replace = (p: ProviderView) => setProviders((list) => list.map((x) => (x.id === p.id ? p : x)));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8">
      <h1 className="font-display text-3xl font-bold text-brass-400">Настройки</h1>

      <Section
        title="Провайдеры моделей"
        hint="Ключи хранятся локально в зашифрованном виде и не покидают ваш компьютер."
      >
        <div className="flex flex-col gap-4">
          {oauth && (
            <p
              className={`rounded-lg px-3 py-2 text-sm ${
                oauth.ok ? "bg-verdict-green/15 text-verdict-green" : "bg-verdict-red/15 text-verdict-red"
              }`}
            >
              {oauth.ok ? "OpenRouter подключён — ключ сохранён, модели загружены." : `Не удалось войти через OpenRouter: ${oauth.message ?? "неизвестная ошибка"}`}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-wood-700 bg-wood-800/40 p-4">
            <a className={primaryBtnCls} href="/api/openrouter/login">
              Войти через OpenRouter
            </a>
            <span className="text-sm text-parchment/60">
              Один аккаунт — сотни моделей разных компаний. Ключ создастся автоматически, вводить его не нужно.
            </span>
          </div>
          {providers.length === 0 && (
            <p className="text-sm text-parchment/60">Пока нет ни одного провайдера. Добавьте первый ниже.</p>
          )}
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              onChange={replace}
              onDelete={() => setProviders((list) => list.filter((x) => x.id !== p.id))}
            />
          ))}
          <AddProviderForm onAdded={(p) => setProviders((list) => [...list, p])} />
        </div>
      </Section>

      <SettingsForm initial={initialSettings} providers={providers} />
    </div>
  );
}

function StatusBadge({ check }: { check: ProviderView["lastCheck"] }) {
  if (!check)
    return <span className="rounded-full bg-wood-700 px-2 py-0.5 text-xs text-parchment/70">не проверен</span>;
  return check.ok ? (
    <span className="rounded-full bg-verdict-green/20 px-2 py-0.5 text-xs text-verdict-green">подключён</span>
  ) : (
    <span className="rounded-full bg-verdict-red/20 px-2 py-0.5 text-xs text-verdict-red">ошибка</span>
  );
}

function ProviderCard({
  provider: p,
  onChange,
  onDelete,
}: {
  provider: ProviderView;
  onChange: (p: ProviderView) => void;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newModel, setNewModel] = useState("");
  const [newKey, setNewKey] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const patch = (body: object) =>
    run("patch", async () => {
      const r = await api<{ provider: ProviderView }>(`/api/providers/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onChange(r.provider);
    });

  return (
    <div className={`rounded-xl border border-wood-700 bg-wood-800/60 p-4 ${p.enabled ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-medium">{p.label}</div>
        <span className="text-xs text-parchment/50">{KIND_TITLES[p.kind]}</span>
        <StatusBadge check={p.lastCheck} />
        <label className="ml-auto flex items-center gap-2 text-xs text-parchment/70">
          <input type="checkbox" checked={p.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
          включён
        </label>
      </div>

      {KEYLESS.includes(p.kind) && p.baseUrl && (
        <div className="mt-2 text-sm text-parchment/70">{addressLabel(p.kind).title.split(" (")[0]}: {p.baseUrl}</div>
      )}
      {CLI.includes(p.kind) && <p className="mt-2 text-xs text-parchment/50">{CLI_TERMS}</p>}

      {!KEYLESS.includes(p.kind) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-parchment/70">
          <span>Ключ: {p.apiKeyHint ?? "—"}</span>
          {p.baseUrl && <span>· {p.baseUrl}</span>}
          {editingKey ? (
            <>
              <input
                type="password"
                className={inputCls}
                placeholder="Новый ключ"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                autoComplete="off"
              />
              <button
                className={btnCls}
                disabled={!newKey.trim() || !!busy}
                onClick={async () => {
                  await patch({ apiKey: newKey.trim() });
                  setNewKey("");
                  setEditingKey(false);
                }}
              >
                Сохранить
              </button>
              <button className={btnCls} onClick={() => setEditingKey(false)}>
                Отмена
              </button>
            </>
          ) : (
            <button className="text-xs underline hover:text-brass-300" onClick={() => setEditingKey(true)}>
              заменить
            </button>
          )}
        </div>
      )}

      {p.models.length > 0 && (
        <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-parchment/70">
          Модель по умолчанию для участников:
          <select
            className={inputCls}
            value={p.defaultModel ?? ""}
            onChange={(e) => patch({ defaultModel: e.target.value || null })}
          >
            <option value="">первая в списке ({p.models[0].id})</option>
            {p.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id}
              </option>
            ))}
          </select>
        </label>
      )}

      {p.lastCheck && !p.lastCheck.ok && p.lastCheck.error && (
        <p className="mt-2 text-sm text-verdict-red">{p.lastCheck.error}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className={btnCls}
          disabled={!!busy}
          onClick={() =>
            run("check", async () => {
              onChange(
                (await api<{ provider: ProviderView }>(`/api/providers/${p.id}/check`, { method: "POST" })).provider,
              );
            })
          }
        >
          {busy === "check" ? "Проверяю…" : "Проверить подключение"}
        </button>
        <button
          className={btnCls}
          disabled={!!busy}
          onClick={() =>
            run("models", async () => {
              onChange(
                (await api<{ provider: ProviderView }>(`/api/providers/${p.id}/models`, { method: "POST" })).provider,
              );
            })
          }
        >
          {busy === "models" ? "Загружаю…" : "Подтянуть список моделей"}
        </button>
        {confirmDelete ? (
          <>
            <button
              className={`${btnCls} border-verdict-red text-verdict-red`}
              disabled={!!busy}
              onClick={() =>
                run("delete", async () => {
                  await api(`/api/providers/${p.id}`, { method: "DELETE" });
                  onDelete();
                })
              }
            >
              Точно удалить
            </button>
            <button className={btnCls} onClick={() => setConfirmDelete(false)}>
              Отмена
            </button>
          </>
        ) : (
          <button className={`${btnCls} ml-auto`} onClick={() => setConfirmDelete(true)}>
            Удалить
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-verdict-red">{error}</p>}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-parchment/70 hover:text-brass-300">
          Модели ({p.models.length})
        </summary>
        <div className="mt-2 flex max-h-60 flex-wrap gap-1.5 overflow-y-auto">
          {p.models.map((m) => (
            <span
              key={m.id}
              className="flex items-center gap-1 rounded-md bg-wood-950 px-2 py-1 text-xs"
              title={m.label}
            >
              {m.id}
              <button
                className="text-parchment/40 hover:text-verdict-red"
                aria-label={`Убрать ${m.id}`}
                onClick={() => patch({ models: p.models.filter((x) => x.id !== m.id) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const id = newModel.trim();
            if (!id || p.models.some((m) => m.id === id)) return;
            patch({ models: [...p.models, { id }] });
            setNewModel("");
          }}
        >
          <input
            className={`${inputCls} flex-1`}
            placeholder="ID модели вручную"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
          />
          <button className={btnCls} type="submit">
            Добавить
          </button>
        </form>
      </details>
    </div>
  );
}

function AddProviderForm({ onAdded }: { onAdded: (p: ProviderView) => void }) {
  const [kind, setKind] = useState<ProviderKind>("anthropic");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { provider } = await api<{ provider: ProviderView }>("/api/providers", {
        method: "POST",
        body: JSON.stringify({ kind, label: label.trim() || KIND_TITLES[kind], apiKey, baseUrl: baseUrl.trim() }),
      });
      // Сразу проверяем подключение и подтягиваем модели — так провайдер готов к работе одним действием.
      let current = (await api<{ provider: ProviderView }>(`/api/providers/${provider.id}/check`, { method: "POST" }))
        .provider;
      if (current.lastCheck?.ok) {
        current = (await api<{ provider: ProviderView }>(`/api/providers/${provider.id}/models`, { method: "POST" }))
          .provider;
      }
      onAdded(current);
      setLabel("");
      setApiKey("");
      setBaseUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-dashed border-wood-600 p-4">
      <div className="mb-3 text-sm font-medium">Добавить провайдера</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-parchment/70">
          Тип
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)}>
            {(Object.keys(KIND_TITLES) as ProviderKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_TITLES[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-parchment/70">
          Название
          <input
            className={inputCls}
            placeholder={KIND_TITLES[kind]}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        {KEYLESS.includes(kind) ? (
          <div className="flex flex-col gap-1 text-xs text-parchment/60 sm:col-span-2">
            <p>{KEY_HELP[kind]}</p>
            {CLI.includes(kind) && <p className="text-brass-300/80">{CLI_TERMS}</p>}
          </div>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-parchment/70 sm:col-span-2">
            API-ключ
            <input
              type="password"
              className={inputCls}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              required
            />
            <span className="text-parchment/50">{KEY_HELP[kind]}</span>
          </label>
        )}
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-xs text-parchment/60">Дополнительно</summary>
          <label className="mt-2 flex flex-col gap-1 text-xs text-parchment/70">
            {addressLabel(kind).title}
            <input
              className={inputCls}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={addressLabel(kind).placeholder}
            />
          </label>
        </details>
      </div>
      {error && <p className="mt-3 text-sm text-verdict-red">{error}</p>}
      <button className={`${primaryBtnCls} mt-4`} disabled={busy || (!KEYLESS.includes(kind) && !apiKey.trim())}>
        {busy ? "Добавляю и проверяю…" : "Добавить и проверить"}
      </button>
    </form>
  );
}

function SettingsForm({ initial, providers }: { initial: Settings; providers: ProviderView[] }) {
  const [s, setS] = useState(initial);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setS((prev) => ({ ...prev, [key]: value }));
    setStatus(null);
  };

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: JSON.stringify(s) });
      setS(r.settings);
      setStatus({ ok: true, text: "Сохранено" });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const num = (key: "minRounds" | "maxRounds" | "spreadThreshold" | "budgetUsd", step = 1) => (
    <input
      type="number"
      step={step}
      className={`${inputCls} w-28`}
      value={s[key]}
      onChange={(e) => set(key, Number(e.target.value))}
    />
  );

  return (
    <>
      <Section
        title="Модели по умолчанию"
        hint="Секретарь ведёт заседание, судья выносит вердикт. Лучше выбрать сильные модели разных провайдеров."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Секретарь суда
            <ModelSelect
              value={s.secretaryModel}
              providers={providers}
              emptyLabel="— выбрать автоматически —"
              onChange={(v) => set("secretaryModel", v)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Судья
            <ModelSelect
              value={s.judgeModel}
              providers={providers}
              emptyLabel="— выбрать автоматически —"
              onChange={(v) => set("judgeModel", v)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Модель расшифровки речи в видео (провайдер OpenAI)
            <input
              className={`${inputCls} max-w-xs`}
              value={s.transcriptionModel}
              onChange={(e) => set("transcriptionModel", e.target.value)}
            />
            <span className="text-xs text-parchment/50">
              Нужна, только если нет Gemini: тогда видео разбирается по кадрам, а речь расшифровывает эта модель.
            </span>
          </label>
        </div>
      </Section>

      <Section title="Заседание">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            Минимум заседаний {num("minRounds")}
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Максимум заседаний {num("maxRounds")}
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Порог разброса оценок
              <span className="block text-xs text-parchment/50">
                стандартное отклонение, при котором слушания закрываются
              </span>
            </span>
            {num("spreadThreshold")}
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Лимит бюджета на дело, $ {num("budgetUsd", 0.5)}
          </label>
        </div>
        <div className="mt-4 text-sm">
          Веса ролей при подсчёте итоговой оценки (взвешенная медиана)
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["prosecutor", "Прокурор"],
                ["defense", "Адвокат"],
                ["witness", "Свидетель"],
                ["juror", "Присяжный"],
              ] as const
            ).map(([role, title]) => (
              <label key={role} className="flex flex-col gap-1 text-xs text-parchment/70">
                {title}
                <input
                  type="number"
                  step={0.05}
                  className={inputCls}
                  value={s.roleWeights[role]}
                  onChange={(e) => set("roleWeights", { ...s.roleWeights, [role]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Интерфейс">
        <div className="flex flex-col gap-4 text-sm">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={s.sound} onChange={(e) => set("sound", e.target.checked)} />
            Звук (молоток, шум зала, барабанная дробь)
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={s.fastMode} onChange={(e) => set("fastMode", e.target.checked)} />
            Быстрый режим — без сцены, сразу протокол и отчёт
          </label>
          <label className="flex items-center gap-3">
            Скорость анимации
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.25}
              value={s.animationSpeed}
              onChange={(e) => set("animationSpeed", Number(e.target.value))}
            />
            <span className="w-10 tabular-nums">{s.animationSpeed}x</span>
          </label>
        </div>
      </Section>

      <div className="sticky bottom-4 flex items-center justify-end gap-4 rounded-xl border border-wood-700 bg-wood-900/95 px-4 py-3 shadow-lg backdrop-blur">
        {status && (
          <span className={`text-sm ${status.ok ? "text-verdict-green" : "text-verdict-red"}`}>{status.text}</span>
        )}
        <button className={primaryBtnCls} onClick={save} disabled={busy}>
          {busy ? "Сохраняю…" : "Сохранить настройки"}
        </button>
      </div>
    </>
  );
}
