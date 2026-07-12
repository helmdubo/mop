"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { assemblePool, loadMappings, loadPoolRows } from "./data";

const EDITABLE_STATUSES = ["draft", "internal_review"];

export async function createPeriod(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();

  const clientId = String(formData.get("client_id") ?? "");
  const month = String(formData.get("month") ?? ""); // YYYY-MM
  if (!clientId || !/^\d{4}-\d{2}$/.test(month)) throw new Error("Некорректные данные");

  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

  const { data: client } = await supabase
    .schema("app")
    .from("clients")
    .select("admin_percent")
    .eq("id", clientId)
    .single();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .schema("app")
    .from("billing_periods")
    .insert({
      client_id: clientId,
      period_start: start,
      period_end: end,
      admin_percent: client?.admin_percent ?? 18,
      created_by: user!.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  redirect(`/billing/${data.id}`);
}

async function getEditablePeriod(supabase: Awaited<ReturnType<typeof createClient>>, periodId: string) {
  const { data: period, error } = await supabase
    .schema("app")
    .from("billing_periods")
    .select("id, client_id, status")
    .eq("id", periodId)
    .single();
  if (error || !period) throw new Error("Период не найден");
  if (!EDITABLE_STATUSES.includes(period.status)) {
    throw new Error(`Период в статусе ${period.status} — пул заморожен`);
  }
  return period;
}

/** Выбранные ассеты из пула → строки review (все накопленные часы поддерева) */
export async function sendToReview(periodId: string, assetCardIds: number[]) {
  await requireRole("owner", "pm");
  if (assetCardIds.length === 0) return;
  const supabase = await createClient();
  const period = await getEditablePeriod(supabase, periodId);

  const mappings = await loadMappings(supabase);
  const pool = assemblePool(await loadPoolRows(supabase, period.client_id), mappings);
  const selected = pool.filter((a) => assetCardIds.includes(a.assetCardId));

  const rows = await loadPoolRows(supabase, period.client_id);
  const itemRows: Record<string, unknown>[] = [];
  for (const asset of selected) {
    for (const r of rows) {
      if (r.asset_card_id !== asset.assetCardId) continue;
      const hours = Number(r.hours ?? 0);
      if (hours <= 0) continue;
      itemRows.push({
        billing_period_id: periodId,
        project_id: asset.projectId,
        asset_card_id: asset.assetCardId,
        asset_title: asset.title,
        kaiten_card_id: r.card_id,
        stage_title: r.is_asset ? null : r.title,
        task_type: r.type_id
          ? (mappings.taskTypeByCardType.get(r.type_id) ?? "misc")
          : "misc",
        kaiten_user_id: r.user_id,
        employee_id: r.user_id != null
          ? (mappings.employeeByKaitenUser.get(r.user_id) ?? null)
          : null,
        hours_raw: hours,
        hours_internal: hours,
      });
    }
  }
  if (itemRows.length === 0) return;

  const { error: itemsErr } = await supabase
    .schema("app")
    .from("billing_items")
    .insert(itemRows);
  if (itemsErr) throw new Error(itemsErr.message);

  const { error: statusErr } = await supabase
    .schema("app")
    .from("billing_asset_status")
    .upsert(
      selected.map((a) => ({
        billing_period_id: periodId,
        asset_card_id: a.assetCardId,
        project_id: a.projectId,
      })),
      { onConflict: "billing_period_id,asset_card_id", ignoreDuplicates: true }
    );
  if (statusErr) throw new Error(statusErr.message);

  revalidatePath(`/billing/${periodId}`);
}

export async function returnToPool(periodId: string, assetCardIds: number[]) {
  await requireRole("owner", "pm");
  if (assetCardIds.length === 0) return;
  const supabase = await createClient();
  await getEditablePeriod(supabase, periodId);

  const { error } = await supabase
    .schema("app")
    .from("billing_items")
    .delete()
    .eq("billing_period_id", periodId)
    .in("asset_card_id", assetCardIds);
  if (error) throw new Error(error.message);

  await supabase
    .schema("app")
    .from("billing_asset_status")
    .delete()
    .eq("billing_period_id", periodId)
    .in("asset_card_id", assetCardIds);

  revalidatePath(`/billing/${periodId}`);
}
