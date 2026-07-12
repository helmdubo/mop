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

interface PoolRow {
  asset_card_id: number;
  card_id: number;
  title: string;
  is_asset: boolean;
  type_id: number | null;
  tag_ids: number[] | null;
  archived: boolean;
  completed_at: string | null;
  user_id: number | null;
  hours: number | null;
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
    const asset = assets.get(stage.assetId);
    if (!asset) continue;
    if (stage.isAssetOwnLogs && stage.hours === 0) continue; // пустые собственные логи не показываем
    asset.stages.push(stage);
    asset.totalHours = Math.round((asset.totalHours + stage.hours) * 100) / 100;
  }

  return Array.from(assets.values())
    .filter((a) => a.stages.length > 0 || a.totalHours > 0)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export interface ReviewAssetRow {
  assetCardId: number;
  title: string;
  projectName: string | null;
  total: number;
  byType: Record<string, number>;
  specification: string | null;
  clientApproved: boolean;
}

export async function loadReview(
  db: SupabaseClient,
  periodId: string
): Promise<{ rows: ReviewAssetRow[]; usedTypes: Set<string> }> {
  const [items, statuses] = await Promise.all([
    db
      .schema("app")
      .from("billing_items")
      .select("asset_card_id, asset_title, task_type, hours_internal, project_id, projects(name)")
      .eq("billing_period_id", periodId),
    db
      .schema("app")
      .from("billing_asset_status")
      .select("asset_card_id, client_approved, specification")
      .eq("billing_period_id", periodId),
  ]);

  const statusByAsset = new Map(
    (statuses.data ?? []).map((s) => [s.asset_card_id, s])
  );
  const rows = new Map<number, ReviewAssetRow>();
  const usedTypes = new Set<string>();

  for (const it of items.data ?? []) {
    let row = rows.get(it.asset_card_id);
    if (!row) {
      const st = statusByAsset.get(it.asset_card_id);
      row = {
        assetCardId: it.asset_card_id,
        title: it.asset_title,
        projectName: (it.projects as unknown as { name: string } | null)?.name ?? null,
        total: 0,
        byType: {},
        specification: st?.specification ?? null,
        clientApproved: st?.client_approved ?? false,
      };
      rows.set(it.asset_card_id, row);
    }
    const h = Number(it.hours_internal ?? 0);
    const tt = it.task_type ?? "misc";
    row.byType[tt] = Math.round(((row.byType[tt] ?? 0) + h) * 100) / 100;
    row.total = Math.round((row.total + h) * 100) / 100;
    if (h > 0) usedTypes.add(tt);
  }

  return {
    rows: Array.from(rows.values()).sort((a, b) => a.title.localeCompare(b.title)),
    usedTypes,
  };
}
