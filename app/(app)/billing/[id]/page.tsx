import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  assemblePool,
  loadMappings,
  loadPoolRows,
  loadReview,
} from "@/lib/billing/data";
import { PoolTable } from "./pool-table";
import { ReviewTable } from "./review-table";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function BillingPeriodPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const appUser = await getCurrentAppUser();
  if (!appUser) redirect("/");

  const supabase = await createClient();
  const { data: period } = await supabase
    .schema("app")
    .from("billing_periods")
    .select("id, client_id, period_start, period_end, status, admin_percent, clients(name)")
    .eq("id", id)
    .maybeSingle();
  if (!period) notFound();

  const canEdit =
    ["owner", "pm"].includes(appUser.role) &&
    ["draft", "internal_review"].includes(period.status);

  const [mappings, poolRows] = await Promise.all([
    loadMappings(supabase),
    canEdit ? loadPoolRows(supabase, period.client_id) : Promise.resolve([]),
  ]);
  // пул уже исключает забилленные карточки; ассет остаётся, пока есть
  // незабилленные этапы — по этому же признаку review решает, сворачивать ли строку
  const poolVisible = assemblePool(poolRows, mappings);
  const assetsStillInPool = new Set(poolVisible.map((a) => a.assetCardId));
  const review = await loadReview(supabase, id, assetsStillInPool);

  const columns = mappings.taskTypeLabels.filter((t) => review.usedTypes.has(t.code));
  const clientName = (period.clients as unknown as { name: string } | null)?.name;

  return (
    <main className="mx-auto max-w-7xl p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {clientName}: {period.period_start} → {period.period_end}
          </h1>
          <p className="text-sm text-neutral-500">
            Статус: {period.status} · Administration: {Number(period.admin_percent)}%
          </p>
        </div>
        <Link href="/billing" className="text-sm text-neutral-500 hover:underline">
          ← Все периоды
        </Link>
      </header>

      {canEdit && (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-medium">
            Выполненные задачи (кандидаты в пул)
          </h2>
          <p className="mb-3 text-sm text-neutral-500">
            Done-ассеты billable-досок, ещё не биллившиеся. Биллятся все накопленные
            часы ассета.
          </p>
          <PoolTable periodId={id} assets={poolVisible} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-medium">На проверке (Review)</h2>
        <ReviewTable
          periodId={id}
          rows={review.rows}
          columns={columns}
          adminPercent={Number(period.admin_percent)}
          canEdit={canEdit}
        />
      </section>
    </main>
  );
}
