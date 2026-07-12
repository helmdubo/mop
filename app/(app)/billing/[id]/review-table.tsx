"use client";

import { useTransition, useState } from "react";
import type { ReviewAssetRow } from "@/lib/billing/data";
import { returnToPool } from "@/lib/billing/actions";

export function ReviewTable({
  periodId,
  rows,
  columns,
  adminPercent,
  canEdit,
}: {
  periodId: string;
  rows: ReviewAssetRow[];
  columns: { code: string; label: string }[];
  adminPercent: number;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const totals: Record<string, number> = {};
  let grandTotal = 0;
  for (const r of rows) {
    grandTotal += r.total;
    for (const c of columns) totals[c.code] = (totals[c.code] ?? 0) + (r.byType[c.code] ?? 0);
  }
  const adminHours = Math.round(grandTotal * adminPercent) / 100;

  const doReturn = (assetCardId: number) =>
    startTransition(async () => {
      setError(null);
      try {
        await returnToPool(periodId, [assetCardId]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });

  const num = (v: number | undefined) =>
    v && v > 0 ? v.toFixed(2) : <span className="text-neutral-300">—</span>;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      {error && <div className="px-4 py-2 text-sm text-red-600">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Ассет</th>
              <th className="px-3 py-2">Проект</th>
              <th className="px-3 py-2 text-right">Итого</th>
              {columns.map((c) => (
                <th key={c.code} className="px-3 py-2 text-right whitespace-nowrap">
                  {c.label}
                </th>
              ))}
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.assetCardId} className="border-b border-neutral-100 hover:bg-neutral-50">
                <td className="px-3 py-2 font-medium">{r.title}</td>
                <td className="px-3 py-2">{r.projectName ?? "—"}</td>
                <td className="px-3 py-2 text-right font-semibold">{r.total.toFixed(2)}</td>
                {columns.map((c) => (
                  <td key={c.code} className="px-3 py-2 text-right">
                    {num(r.byType[c.code])}
                  </td>
                ))}
                {canEdit && (
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => doReturn(r.assetCardId)}
                      disabled={pending}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
                    >
                      ← Вернуть
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={3 + columns.length + (canEdit ? 1 : 0)}
                  className="px-4 py-6 text-center text-neutral-400"
                >
                  В review пока пусто — выберите ассеты из пула выше
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold">
              <tr>
                <td className="px-3 py-2">Administration ({adminPercent}%)</td>
                <td />
                <td className="px-3 py-2 text-right">{adminHours.toFixed(2)}</td>
                <td colSpan={columns.length + (canEdit ? 1 : 0)} />
              </tr>
              <tr>
                <td className="px-3 py-2">Всего (с administration)</td>
                <td />
                <td className="px-3 py-2 text-right">
                  {(grandTotal + adminHours).toFixed(2)}
                </td>
                {columns.map((c) => (
                  <td key={c.code} className="px-3 py-2 text-right">
                    {(totals[c.code] ?? 0).toFixed(2)}
                  </td>
                ))}
                {canEdit && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
