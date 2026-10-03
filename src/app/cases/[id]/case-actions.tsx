"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Section, btnCls, inputCls, primaryBtnCls } from "@/components/ui";
import { api, errorText } from "@/lib/client/api";
import type { CaseView } from "@/lib/store/cases";
import type { CaseDetails, CaseLink } from "@/lib/trial/case-details";
import { hasActualResult, type ActualResult } from "@/lib/trial/schemas";
import { OUTCOME_TITLES, STATUS_TITLES } from "./labels";
import { Report } from "./report";

/** Отчёт и всё, что с ним делают: апелляция, экспорт, фактический результат. */
export function ReportBlock({ details, onChange }: { details: CaseDetails; onChange: (c: CaseView) => void }) {
  const c = details.case;
  const [appealOpen, setAppealOpen] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <Report caseView={c} />
      <div className="flex flex-wrap gap-2">
        <button className={primaryBtnCls} onClick={() => setAppealOpen((o) => !o)}>
          ⚖️ Подать апелляцию
        </button>
        {!c.parentId && (
          <Link
            className={btnCls}
            href={`/?revisionOf=${c.id}`}
            title="Доработали материал по советам суда? Суд рассмотрит новую версию с учётом своего прошлого вердикта"
          >
            📝 Подать новую версию
          </Link>
        )}
        <a className={btnCls} href={`/api/cases/${c.id}/export`}>
          ⬇️ Экспорт в Markdown
        </a>
        <a className={btnCls} href={`/cases/${c.id}/print`} target="_blank" rel="noreferrer">
          🖨️ Экспорт в PDF
        </a>
      </div>
      {appealOpen && <AppealPanel details={details} onClose={() => setAppealOpen(false)} />}
      {details.appeals.length > 0 && <AppealsList appeals={details.appeals} />}
      <ActualResultForm caseView={c} onSaved={onChange} />
    </div>
  );
}

/** Шапка дела-апелляции: ссылка на исходное дело и зафиксированная аудитория. */
export function AppealBanner({ details }: { details: CaseDetails }) {
  const { appeal } = details.case;
  if (!appeal || !details.parent) return null;
  return (
    <div className="rounded-xl border border-brass-500/40 bg-brass-500/10 px-4 py-3 text-sm">
      ⚖️ <b>Апелляция</b> по делу{" "}
      <Link href={`/cases/${details.parent.id}`} className="underline hover:text-brass-300">
        «{details.parent.title}»
      </Link>
      {details.parent.score !== null && <span className="text-parchment/60"> (было {details.parent.score}%)</span>}. Аудитория:{" "}
      <b>
        {appeal.segment}, {appeal.age_from}–{appeal.age_to} лет
      </b>
      {appeal.note && <span className="text-parchment/70"> · {appeal.note}</span>}
    </div>
  );
}

function AppealsList({ appeals }: { appeals: CaseLink[] }) {
  return (
    <Section title="Апелляции">
      <ul className="flex flex-col gap-2">
        {appeals.map((a) => (
          <li key={a.id}>
            <Link
              href={`/cases/${a.id}`}
              className="flex items-center gap-3 rounded-lg border border-wood-700 px-3 py-2 text-sm hover:border-brass-500"
            >
              <span className="flex-1">
                {a.appeal?.segment}, {a.appeal?.age_from}–{a.appeal?.age_to} лет
              </span>
              {a.score !== null && a.outcome ? (
                <span>
                  {OUTCOME_TITLES[a.outcome]} · <b className="text-brass-300">{a.score}%</b>
                </span>
              ) : (
                <span className="text-parchment/50">{STATUS_TITLES[a.status]}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AppealPanel({ details, onClose }: { details: CaseDetails; onClose: () => void }) {
  const router = useRouter();
  const audiences = [...(details.case.verdict?.audiences ?? [])].sort((a, b) => b.fit - a.fit);
  const [choice, setChoice] = useState<number | "custom">(audiences.length ? 0 : "custom");
  const [custom, setCustom] = useState({ segment: "", age_from: 25, age_to: 45 });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const a = choice === "custom" ? custom : audiences[choice];
    setBusy(true);
    setError(null);
    try {
      const { case: child } = await api<{ case: CaseView }>(`/api/cases/${details.case.id}/appeal`, {
        method: "POST",
        body: JSON.stringify({ segment: a.segment, age_from: a.age_from, age_to: a.age_to, note }),
      });
      router.push(`/cases/${child.id}?fresh=1`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-brass-500/40 bg-wood-900 p-5">
      <h2 className="font-display text-xl font-bold">Апелляция</h2>
      <p className="mt-1 text-sm text-parchment/60">
        Суд проведёт короткое слушание (2–3 заседания) для выбранной аудитории и предложит изменения именно под неё.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {audiences.map((a, i) => (
          <label key={i} className="flex cursor-pointer items-start gap-3 rounded-lg border border-wood-700 p-3 hover:border-brass-500">
            <input type="radio" name="audience" checked={choice === i} onChange={() => setChoice(i)} className="mt-1" />
            <span className="flex-1 text-sm">
              <b>{a.segment}</b>, {a.age_from}–{a.age_to} лет <span className="text-brass-300">· {a.fit}%</span>
              <span className="block text-parchment/60">{a.why}</span>
            </span>
          </label>
        ))}
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-wood-700 p-3 hover:border-brass-500">
          <input type="radio" name="audience" checked={choice === "custom"} onChange={() => setChoice("custom")} className="mt-1" />
          <span className="flex flex-1 flex-wrap items-center gap-2 text-sm">
            Своя аудитория:
            <input
              className={`${inputCls} min-w-56 flex-1`}
              placeholder="например, молодые мамы в декрете"
              value={custom.segment}
              onFocus={() => setChoice("custom")}
              onChange={(e) => setCustom({ ...custom, segment: e.target.value })}
            />
            <span className="flex items-center gap-1">
              от
              <input
                type="number"
                className={`${inputCls} w-20`}
                value={custom.age_from}
                onFocus={() => setChoice("custom")}
                onChange={(e) => setCustom({ ...custom, age_from: Number(e.target.value) })}
              />
              до
              <input
                type="number"
                className={`${inputCls} w-20`}
                value={custom.age_to}
                onFocus={() => setChoice("custom")}
                onChange={(e) => setCustom({ ...custom, age_to: Number(e.target.value) })}
              />
              лет
            </span>
          </span>
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1 text-sm text-parchment/70">
        Пожелания к суду (необязательно)
        <textarea
          className={`${inputCls} min-h-16`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Например: бюджет тот же, канал — только Telegram"
        />
      </label>
      {error && <p className="mt-2 text-sm text-verdict-red">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button className={primaryBtnCls} disabled={busy || (choice === "custom" && !custom.segment.trim())}>
          {busy ? "Подаём апелляцию…" : "Подать апелляцию"}
        </button>
        <button type="button" className={btnCls} onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  );
}

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** Что получилось на самом деле — чтобы потом сравнить с прогнозом суда. */
function ActualResultForm({ caseView: c, onSaved }: { caseView: CaseView; onSaved: (c: CaseView) => void }) {
  const r = c.actualResult;
  const [form, setForm] = useState({ ctr: str(r?.ctr), conversion: str(r?.conversion), sales: str(r?.sales), note: r?.note ?? "" });
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: ActualResult = { ctr: num(form.ctr), conversion: num(form.conversion), sales: num(form.sales), note: form.note };
    if ([body.ctr, body.conversion, body.sales].some((x) => x !== null && Number.isNaN(x))) {
      setStatus({ ok: false, text: "Числа введены с ошибкой" });
      return;
    }
    try {
      const { case: updated } = await api<{ case: CaseView }>(`/api/cases/${c.id}/result`, { method: "PUT", body: JSON.stringify(body) });
      onSaved(updated);
      setStatus({ ok: true, text: hasActualResult(updated.actualResult) ? "Сохранено" : "Очищено" });
    } catch (err) {
      setStatus({ ok: false, text: errorText(err) });
    }
  }

  const field = (key: "ctr" | "conversion" | "sales", label: string) => (
    <label className="flex flex-col gap-1 text-xs text-parchment/70">
      {label}
      <input
        className={inputCls}
        inputMode="decimal"
        value={form[key]}
        onChange={(e) => {
          setForm({ ...form, [key]: e.target.value });
          setStatus(null);
        }}
      />
    </label>
  );

  return (
    <Section
      title="Фактический результат"
      hint={
        c.verdict
          ? `Когда кампания отработает, запишите, что вышло на самом деле: потом в архиве будет видно, насколько суд был прав (прогноз — ${c.verdict.success_score}%).`
          : undefined
      }
    >
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-3">
        {field("ctr", "CTR, %")}
        {field("conversion", "Конверсия, %")}
        {field("sales", "Продажи (шт. или ₽)")}
        <label className="flex flex-col gap-1 text-xs text-parchment/70 sm:col-span-3">
          Заметка
          <textarea
            className={`${inputCls} min-h-16`}
            value={form.note}
            placeholder="Что сработало, что нет, сколько потратили…"
            onChange={(e) => {
              setForm({ ...form, note: e.target.value });
              setStatus(null);
            }}
          />
        </label>
        <div className="flex items-center gap-3 sm:col-span-3">
          <button className={btnCls}>Сохранить результат</button>
          {status && <span className={`text-sm ${status.ok ? "text-verdict-green" : "text-verdict-red"}`}>{status.text}</span>}
        </div>
      </form>
    </Section>
  );
}
