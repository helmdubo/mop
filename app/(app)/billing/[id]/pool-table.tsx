"use client";

import { useState, useTransition } from "react";
import type { PoolAsset } from "@/lib/billing/data";
import { sendToReview } from "@/lib/billing/actions";

export function PoolTable({
  periodId,
  assets,
}: {
  periodId: string;
  assets: PoolAsset[];
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: number, set: Set<number>, setter: (s: Set<number>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const allSelected = assets.length > 0 && selected.size === assets.length;

  const submit = () =>
    startTransition(async () => {
      setError(null);
      try {
        await sendToReview(periodId, Array.from(selected));
        setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
        <span className="text-sm text-neutral-500">
          Выбрано: <b>{selected.size}</b> из {assets.length}
        </span>
        {selected.size > 0 && (
          <button
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {pending ? "Отправляю…" : "Отправить в Review →"}
          </button>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(
                      allSelected ? new Set() : new Set(assets.map((a) => a.assetCardId))
                    )
                  }
                />
              </th>
              <th className="px-3 py-2">Ассет / этап</th>
              <th className="px-3 py-2">Тип</th>
              <th className="px-3 py-2">Проект</th>
              <th className="px-3 py-2">Исполнители</th>
              <th className="px-3 py-2 text-right">Часы</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <AssetRows
                key={a.assetCardId}
                asset={a}
                checked={selected.has(a.assetCardId)}
                expanded={expanded.has(a.assetCardId)}
                onCheck={() => toggle(a.assetCardId, selected, setSelected)}
                onExpand={() => toggle(a.assetCardId, expanded, setExpanded)}
              />
            ))}
            {assets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">
                  Кандидатов нет — все done-ассеты уже забиллены или в review
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AssetRows({
  asset,
  checked,
  expanded,
  onCheck,
  onExpand,
}: {
  asset: PoolAsset;
  checked: boolean;
  expanded: boolean;
  onCheck: () => void;
  onExpand: () => void;
}) {
  return (
    <>
      <tr className="border-b border-neutral-100 hover:bg-neutral-50">
        <td className="px-3 py-2">
          <input type="checkbox" checked={checked} onChange={onCheck} />
        </td>
        <td className="px-3 py-2 font-medium">
          <button onClick={onExpand} className="mr-2 text-neutral-400">
            {expanded ? "▾" : "▸"}
          </button>
          {asset.title}
        </td>
        <td className="px-3 py-2 text-neutral-400">ассет</td>
        <td className="px-3 py-2">{asset.projectName ?? "—"}</td>
        <td className="px-3 py-2" />
        <td className="px-3 py-2 text-right font-semibold">
          {asset.totalHours.toFixed(2)}
        </td>
      </tr>
      {expanded &&
        asset.stages.map((s) => (
          <tr key={s.cardId} className="border-b border-neutral-100 bg-neutral-50/50">
            <td className="px-3 py-1.5" />
            <td className="px-3 py-1.5 pl-12 text-neutral-600">{s.title}</td>
            <td className="px-3 py-1.5 text-neutral-500">{s.taskType ?? "—"}</td>
            <td className="px-3 py-1.5" />
            <td className="px-3 py-1.5 text-neutral-500">{s.userNames.join(", ")}</td>
            <td className="px-3 py-1.5 text-right">{s.hours.toFixed(2)}</td>
          </tr>
        ))}
    </>
  );
}
