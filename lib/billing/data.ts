import { SupabaseClient } from "@supabase/supabase-js";

export interface PoolStage {
  cardId: number;
  title: string;
  isAssetOwnLogs: boolean;
  taskType: string | null;
  hours: number;
  userNames: string[];
}

export interface PoolAsset {
  assetCardId: number;
  title: string;
  completedAt: string | null;
  projectId: string | null;
  projectName: string | null;
  totalHours: number;
  stages: PoolStage[];
}

export interface Mappings {
  taskTypeByCardType: Map<number, string>;
  taskTypeLabels: { code: string; label: string; sort: number }[];
  projectByTag: Map<number, { id: string; name: string }>;
  userNames: Map<number, string>;
  employeeByKaitenUser: Map<number, string>;
}

export interface PoolRow {
  asset_card_id: number;
  card_id: number;
  title: string;
  is_asset: boolean;
  type_id: number | null;
  tag_ids: number[] | null;
  archived: boolean;
  completed_at: string | null;
  user_id: number | null;
  hours: number | string | null;
}

export async function loadMappings(db: SupabaseClient): Promise<Mappings> {
  const [ttm, tt, ptm, users, employees] = await Promise.all([
    db.schema("app").from("task_type_mappings").select("task_type, kaiten_card_type_id"),
    db.schema("app").from("task_types").select("code, invoice_label, sort_order"),
    db
      .schema("app")
      .from("project_tag_mappings")
      .select("kaiten_tag_id, project_id, projects(name)"),
    db.schema("kaiten").from("users").select("id, full_name"),
    db.schema("app").from("employees").select("id, kaiten_user_id"),
  ]);

  const taskTypeByCardType = new Map<number, string>();
  for (const m of ttm.data ?? []) {
    if (m.kaiten_card_type_id) taskTypeByCardType.set(m.kaiten_card_type_id, m.task_type);
  }
  const projectByTag = new Map<number, { id: string; name: string }>();
  for (const m of ptm.data ?? []) {
    const name = (m.projects as unknown as { name: string } | null)?.name ?? "";
    projectByTag.set(m.kaiten_tag_id, { id: m.project_id, name });
  }
  const userNames = new Map<number, string>();
  for (const u of users.data ?? []) userNames.set(u.id, u.full_name ?? String(u.id));
  const employeeByKaitenUser = new Map<number, string>();
  for (const e of employees.data ?? []) {
    if (e.kaiten_user_id) employeeByKaitenUser.set(e.kaiten_user_id, e.id);
  }
  const taskTypeLabels = (tt.data ?? [])
    .map((t) => ({ code: t.code, label: t.invoice_label, sort: t.sort_order }))
    .sort((a, b) => a.sort - b.sort);

  return { taskTypeByCardType, taskTypeLabels, projectByTag, userNames, employeeByKaitenUser };
}

export async function loadPoolRows(
  db: SupabaseClient,
  clientId: string
): Promise<PoolRow[]> {
  const { data, error } = await db
    .schema("app")
    .rpc("billing_pool_candidates", { p_client_id: clientId });
  if (error) throw new Error(`billing_pool_candidates: ${error.message}`);
  return (data ?? []) as PoolRow[];
}

export function assemblePool(rows: PoolRow[], m: Mappings): PoolAsset[] {
  const assets = new Map<number, PoolAsset>();
  const stageMap = new Map<number, PoolStage & { assetId: number }>();

  for (const r of rows) {
    if (!assets.has(r.asset_card_id) && r.is_asset) {
      const project =
        (r.tag_ids ?? []).map((t) => m.projectByTag.get(t)).find(Boolean) ?? null;
      assets.set(r.asset_card_id, {
        assetCardId: r.asset_card_id,
        title: r.title,
        completedAt: r.completed_at,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        totalHours: 0,
        stages: [],
      });
    }
  }

  for (const r of rows) {
    const hours = Number(r.hours ?? 0);
    let stage = stageMap.get(r.card_id);
    if (!stage) {
      stage = {
        assetId: r.asset_card_id,
        cardId: r.card_id,
        title: r.is_asset ? "(логи на самом ассете)" : r.title,
        isAssetOwnLogs: r.is_asset,
        taskType: r.type_id ? (m.taskTypeByCardType.get(r.type_id) ?? null) : null,
        hours: 0,
        userNames: [],
      };
      stageMap.set(r.card_id, stage);
    }
    if (hours > 0) {
      stage.hours = Math.round((stage.hours + hours) * 100) / 100;
      if (r.user_id != null) {
        const name = m.userNames.get(r.user_id) ?? String(r.user_id);
        if (!stage.userNames.includes(name)) stage.userNames.push(name);
      }
    }
  }

  for (const stage of stageMap.values()) {
    if (stage.hours === 0) continue; // без часов биллить нечего
    const asset = assets.get(stage.assetId);
    if (!asset) continue;
    asset.stages.push(stage);
    asset.totalHours = Math.round((asset.totalHours + stage.hours) * 100) / 100;
  }

  return Array.from(assets.values())
    .filter((a) => a.stages.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export interface ReviewRow {
  key: string;
  assetCardId: number;
  title: string;
  subtitle: string | null; // название ассета для строк-этапов
  collapsed: boolean;      // ассет свёрнут в одну строку (все этапы забиллены)
  projectName: string | null;
  total: number;
  byType: Record<string, number>;
  cardIds: number[];
  clientApproved: boolean;
  specification: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function loadReview(
  db: SupabaseClient,
  periodId: string,
  assetsStillInPool: Set<number>
): Promise<{ rows: ReviewRow[]; usedTypes: Set<string> }> {
  const [items, statuses] = await Promise.all([
    db
      .schema("app")
      .from("billing_items")
      .select(
        "asset_card_id, asset_title, kaiten_card_id, stage_title, task_type, hours_internal, project_id, projects(name)"
      )
      .eq("billing_period_id", periodId),
    db
      .schema("app")
      .from("billing_asset_status")
      .select("asset_card_id, client_approved, specification")
      .eq("billing_period_id", periodId),
  ]);

  const statusByAsset = new Map((statuses.data ?? []).map((s) => [s.asset_card_id, s]));
  const usedTypes = new Set<string>();

  interface Item {
    asset_card_id: number;
    asset_title: string;
    kaiten_card_id: number;
    stage_title: string | null;
    task_type: string | null;
    hours_internal: number | string;
    projects: unknown;
  }
  const byAsset = new Map<number, Item[]>();
  for (const it of (items.data ?? []) as Item[]) {
    if (!byAsset.has(it.asset_card_id)) byAsset.set(it.asset_card_id, []);
    byAsset.get(it.asset_card_id)!.push(it);
    const h = Number(it.hours_internal ?? 0);
    if (h > 0) usedTypes.add(it.task_type ?? "misc");
  }

  const rows: ReviewRow[] = [];
  for (const [assetId, list] of byAsset) {
    const st = statusByAsset.get(assetId);
    const projectName =
      (list[0].projects as { name: string } | null)?.name ?? null;
    const collapsed = !assetsStillInPool.has(assetId);

    if (collapsed) {
      const byType: Record<string, number> = {};
      let total = 0;
      for (const it of list) {
        const h = Number(it.hours_internal ?? 0);
        const tt = it.task_type ?? "misc";
        byType[tt] = r2((byType[tt] ?? 0) + h);
        total = r2(total + h);
      }
      rows.push({
        key: `a-${assetId}`,
        assetCardId: assetId,
        title: list[0].asset_title,
        subtitle: null,
        collapsed: true,
        projectName,
        total,
        byType,
        cardIds: Array.from(new Set(list.map((i) => i.kaiten_card_id))),
        clientApproved: st?.client_approved ?? false,
        specification: st?.specification ?? null,
      });
    } else {
      // ассет ещё не полностью в review — этапы отдельными строками
      const byCard = new Map<number, Item[]>();
      for (const it of list) {
        if (!byCard.has(it.kaiten_card_id)) byCard.set(it.kaiten_card_id, []);
        byCard.get(it.kaiten_card_id)!.push(it);
      }
      for (const [cardId, cardItems] of byCard) {
        const byType: Record<string, number> = {};
        let total = 0;
        for (const it of cardItems) {
          const h = Number(it.hours_internal ?? 0);
          const tt = it.task_type ?? "misc";
          byType[tt] = r2((byType[tt] ?? 0) + h);
          total = r2(total + h);
        }
        rows.push({
          key: `c-${cardId}`,
          assetCardId: assetId,
          title: cardItems[0].stage_title ?? "(логи на самом ассете)",
          subtitle: cardItems[0].asset_title,
          collapsed: false,
          projectName,
          total,
          byType,
          cardIds: [cardId],
          clientApproved: st?.client_approved ?? false,
          specification: st?.specification ?? null,
        });
      }
    }
  }

  rows.sort((a, b) => (a.subtitle ?? a.title).localeCompare(b.subtitle ?? b.title));
  return { rows, usedTypes };
}
