"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { loadMappings, loadPoolRows } from "./data";

const EDITABLE_STATUSES = ["draft", "internal_review"];

export type ActionResult = { ok: true } | { ok: false; error: string };

const fail = (e: unknown): ActionResult => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e),
});

export async function createPeriod(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();

  const clientId = String(formData.get("client_id") ?? "");
  const start = String(formData.get("period_start") ?? "");
  const end = String(formData.get("period_end") ?? "");
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!clientId || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    throw new Error("Некорректные данные");
  }
  if (start > end) throw new Error("Дата начала позже даты конца");

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

async function getEditablePeriod(
  supabase: Awaited<ReturnType<typeof createClient>>,
  periodId: string
) {
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

/**
 * Выбранные карточки (этапы и/или собственные логи ассета) → строки review.
 * Гранула — карточка: этапы одного ассета могут уходить в разные инвойсы.
 */
export async function sendToReview(
  periodId: string,
  cardIds: number[]
): Promise<ActionResult> {
  try {
    await requireRole("owner", "pm");
    if (cardIds.length === 0) return { ok: true };
    const supabase = await createClient();
    const period = await getEditablePeriod(supabase, periodId);

    const [mappings, rows] = await Promise.all([
      loadMappings(supabase),
      loadPoolRows(supabase, period.client_id),
    ]);

    const wanted = new Set(cardIds);
    const selectedRows = rows.filter(
      (r) => wanted.has(r.card_id) && Number(r.hours ?? 0) > 0
    );
    if (selectedRows.length === 0) {
      return { ok: false, error: "У выбранных строк нет часов для биллинга" };
    }

    // мета ассетов: название и проект (по тегам ассета, fallback — теги этапа)
    const assetMeta = new Map<number, { title: string; projectId: string | null }>();
    for (const r of rows) {
      if (r.is_asset && !assetMeta.has(r.asset_card_id)) {
        const project =
          (r.tag_ids ?? []).map((t) => mappings.projectByTag.get(t)).find(Boolean) ?? null;
        assetMeta.set(r.asset_card_id, { title: r.title, projectId: project?.id ?? null });
      }
    }
    for (const r of selectedRows) {
      if (!assetMeta.has(r.asset_card_id)) {
        const project =
          (r.tag_ids ?? []).map((t) => mappings.projectByTag.get(t)).find(Boolean) ?? null;
        assetMeta.set(r.asset_card_id, {
          title: r.title, // лучший доступный fallback
          projectId: project?.id ?? null,
        });
      }
    }

    const itemRows = selectedRows.map((r) => {
      const meta = assetMeta.get(r.asset_card_id)!;
      const hours = Number(r.hours ?? 0);
      return {
        billing_period_id: periodId,
        project_id: meta.projectId,
        asset_card_id: r.asset_card_id,
        asset_title: meta.title,
        kaiten_card_id: r.card_id,
        stage_title: r.is_asset ? null : r.title,
        task_type: r.type_id
          ? (mappings.taskTypeByCardType.get(r.type_id) ?? "misc")
          : "misc",
        kaiten_user_id: r.user_id,
        employee_id:
          r.user_id != null
            ? (mappings.employeeByKaitenUser.get(r.user_id) ?? null)
            : null,
        hours_raw: hours,
        hours_internal: hours,
      };
    });

    const { error: itemsErr } = await supabase
      .schema("app")
      .from("billing_items")
      .insert(itemRows);
    if (itemsErr) throw new Error(itemsErr.message);

    const touchedAssets = Array.from(new Set(selectedRows.map((r) => r.asset_card_id)));
    const { error: statusErr } = await supabase
      .schema("app")
      .from("billing_asset_status")
      .upsert(
        touchedAssets.map((assetId) => ({
          billing_period_id: periodId,
          asset_card_id: assetId,
          project_id: assetMeta.get(assetId)?.projectId ?? null,
        })),
        { onConflict: "billing_period_id,asset_card_id", ignoreDuplicates: true }
      );
    if (statusErr) throw new Error(statusErr.message);

    revalidatePath(`/billing/${periodId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Вернуть строки review (по карточкам) обратно в пул */
export async function returnToPool(
  periodId: string,
  cardIds: number[]
): Promise<ActionResult> {
  try {
    await requireRole("owner", "pm");
    if (cardIds.length === 0) return { ok: true };
    const supabase = await createClient();
    await getEditablePeriod(supabase, periodId);

    const { error } = await supabase
      .schema("app")
      .from("billing_items")
      .delete()
      .eq("billing_period_id", periodId)
      .in("kaiten_card_id", cardIds);
    if (error) throw new Error(error.message);

    // статусы ассетов, у которых в периоде не осталось строк, подчищаем
    const { data: remaining } = await supabase
      .schema("app")
      .from("billing_items")
      .select("asset_card_id")
      .eq("billing_period_id", periodId);
    const alive = new Set((remaining ?? []).map((r) => r.asset_card_id));
    const { data: statuses } = await supabase
      .schema("app")
      .from("billing_asset_status")
      .select("asset_card_id")
      .eq("billing_period_id", periodId);
    const orphans = (statuses ?? [])
      .map((s) => s.asset_card_id)
      .filter((id) => !alive.has(id));
    if (orphans.length > 0) {
      await supabase
        .schema("app")
        .from("billing_asset_status")
        .delete()
        .eq("billing_period_id", periodId)
        .in("asset_card_id", orphans);
    }

    revalidatePath(`/billing/${periodId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
