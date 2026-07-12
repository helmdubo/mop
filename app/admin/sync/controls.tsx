"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Log = { text: string; error?: boolean };

async function callSync(body: Record<string, string>): Promise<string> {
  const res = await fetch("/api/admin/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return JSON.stringify(data.stats);
}

const monthWindow = (year: number, month: number): { from: string; to: string } => {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const mm = String(month + 1).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
};

export function SyncControls() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<Log[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());

  const push = (text: string, error = false) =>
    setLog((prev) => [{ text, error }, ...prev].slice(0, 30));

  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      push(`${label}: ${e instanceof Error ? e.message : e}`, true);
    } finally {
      setBusy(null);
      router.refresh();
    }
  };

  const simple = (label: string, action: string) =>
    run(label, async () => {
      push(`${label}: ${await callSync({ action })}`);
    });

  const importYear = () =>
    run(`Импорт ${year}`, async () => {
      for (let m = 0; m < 12; m++) {
        const { from, to } = monthWindow(year, m);
        if (new Date(from) > new Date()) break;
        push(`${from}…: ${await callSync({ action: "timelogs", from, to })}`);
      }
      push(`Импорт часов за ${year} завершён`);
    });

  const syncRecent = () =>
    run("Часы за 45 дней", async () => {
      const to = new Date();
      const from = new Date(to.getTime() - 45 * 86_400_000);
      const f = from.toISOString().slice(0, 10);
      const t = to.toISOString().slice(0, 10);
      push(`Часы ${f} → ${t}: ${await callSync({ action: "timelogs", from: f, to: t })}`);
    });

  const btn =
    "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-100 disabled:opacity-40";

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={!!busy} onClick={() => simple("Структура", "structure")}>
          Синк структуры
        </button>
        <button className={btn} disabled={!!busy} onClick={() => simple("Карточки (инкр.)", "cards_incremental")}>
          Карточки (инкрементально)
        </button>
        <button className={btn} disabled={!!busy} onClick={() => simple("Карточки (все)", "cards_full")}>
          Карточки (полностью)
        </button>
        <button className={btn} disabled={!!busy} onClick={syncRecent}>
          Часы за 45 дней
        </button>
        <span className="mx-2 h-6 w-px bg-neutral-200" />
        <label className="flex items-center gap-2 text-sm">
          Импорт истории часов за
          <input
            type="number"
            value={year}
            min={2020}
            max={2030}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-20 rounded-md border border-neutral-300 px-2 py-1.5"
          />
        </label>
        <button
          className={`${btn} border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700`}
          disabled={!!busy}
          onClick={importYear}
        >
          Импортировать год
        </button>
        {busy && <span className="text-sm text-amber-600">Выполняется: {busy}…</span>}
      </div>

      {log.length > 0 && (
        <div className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-md bg-neutral-50 p-3 font-mono text-xs">
          {log.map((l, i) => (
            <div key={i} className={l.error ? "text-red-600" : "text-neutral-600"}>
              {l.text}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
