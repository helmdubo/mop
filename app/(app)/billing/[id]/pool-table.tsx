"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { PoolAsset } from "@/lib/billing/data";
import { sendToReview } from "@/lib/billing/actions";

export function PoolTable({
  periodId,
  assets,
}: {
  periodId: string;
  assets: PoolAsset[];
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set()); // cardIds этапов
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const allCardIds = assets.flatMap((a) => a.stages.map((s) => s.cardId));

  const toggleCard = (cardId: number) => {
    const next = new Set(selected);
    if (next.has(cardId)) next.delete(cardId);
    else next.add(cardId);
    setSelected(next);
  };

  const toggleAsset = (asset: PoolAsset) => {
    const ids = asset.stages.map((s) => s.cardId);
    const allIn = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    ids.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
    setSelected(next);
  };

  const toggleExpand = (assetId: number) => {
    const next = new Set(expanded);
    if (next.has(assetId)) next.delete(assetId);
    else next.add(assetId);
    setExpanded(next);
  };

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const res = await sendToReview(periodId, Array.from(selected));
      if (res.ok) setSelected(new Set());
      else setError(res.error);
    });

  const selectedHours = assets
    .flatMap((a) => a.stages)
    .filter((s) => selected.has(s.cardId))
    .reduce((sum, s) => sum + s.hours, 0);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 px-4 py-3">
        <span className="text-sm text-neutral-500">
          Выбрано строк: <b>{selected.size}</b> ({selectedHours.toFixed(2)} ч)
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
                  checked={allCardIds.length > 0 && selected.size === allCardIds.length}
                  onChange={() =>
                    setSelected(
                      selected.size === allCardIds.length
                        ? new Set()
                        : new Set(allCardIds)
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
                selected={selected}
                expanded={expanded.has(a.assetCardId)}
                onToggleAsset={() => toggleAsset(a)}
                onToggleCard={toggleCard}
                onExpand={() => toggleExpand(a.assetCardId)}
              />
            ))}
            {assets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">
                  Кандидатов нет — все done-ассеты уже забиллены, в review или в архиве
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
  selected,
  expanded,
  onToggleAsset,
  onToggleCard,
  onExpand,
}: {
  asset: PoolAsset;
  selected: Set<number>;
  expanded: boolean;
  onToggleAsset: () => void;
  onToggleCard: (cardId: number) => void;
  onExpand: () => void;
}) {
  const ids = asset.stages.map((s) => s.cardId);
  const selCount = ids.filter((id) => selected.has(id)).length;
  const allIn = selCount === ids.length && ids.length > 0;
  const someIn = selCount > 0 && !allIn;

  const assetCb = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (assetCb.current) assetCb.current.indeterminate = someIn;
  }, [someIn]);

  return (
    <>
      <tr className="border-b border-neutral-100 hover:bg-neutral-50">
        <td className="px-3 py-2">
          <input type="checkbox" ref={assetCb} checked={allIn} onChange={onToggleAsset} />
        </td>
        <td className="px-3 py-2 font-medium">
          <button onClick={onExpand} className="mr-2 text-neutral-400">
            {expanded ? "▾" : "▸"}
          </button>
          {asset.title}
        </td>
        <td className="px-3 py-2 text-neutral-400">
          ассет · {asset.stages.length} стр.
        </td>
        <td className="px-3 py-2">{asset.projectName ?? "—"}</td>
        <td className="px-3 py-2" />
        <td className="px-3 py-2 text-right font-semibold">
          {asset.totalHours.toFixed(2)}
        </td>
      </tr>
      {expanded &&
        asset.stages.map((s) => (
          <tr key={s.cardId} className="border-b border-neutral-100 bg-neutral-50/50">
            <td className="px-3 py-1.5 pl-6">
              <input
                type="checkbox"
                checked={selected.has(s.cardId)}
                onChange={() => onToggleCard(s.cardId)}
              />
            </td>
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
