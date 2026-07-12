/**
 * Движок синка Kaiten → зеркало kaiten.*.
 * Принципы (уроки v1): каждый запуск виден в app.sync_runs; ошибки не глотаются;
 * деструктивный replace тайм-логов — только через транзакционную RPC
 * app.replace_time_logs (advisory lock внутри); ручных полей в зеркале нет.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { kaiten, KaitenEntity } from "@/lib/kaiten/client";

type Stats = Record<string, number>;

const BATCH = 500;
const iso = (v: unknown): string | null =>
  typeof v === "string" && v ? new Date(v).toISOString() : null;

async function startRun(
  db: SupabaseClient,
  entity: string,
  mode: string,
  window?: { from: string; to: string }
): Promise<number> {
  const { data, error } = await db
    .schema("app")
    .from("sync_runs")
    .insert({
      entity,
      mode,
      window_from: window?.from ?? null,
      window_to: window?.to ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

async function finishRun(db: SupabaseClient, id: number, stats: Stats) {
  await db
    .schema("app")
    .from("sync_runs")
    .update({ status: "completed", stats, finished_at: new Date().toISOString() })
    .eq("id", id);
}

async function failRun(db: SupabaseClient, id: number, err: unknown) {
  await db
    .schema("app")
    .from("sync_runs")
    .update({
      status: "failed",
      error: String(err instanceof Error ? err.message : err).slice(0, 1000),
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
}

/** Есть ли живой запуск (защита от параллельных синков поверх RPC-лока) */
export async function hasActiveRun(db: SupabaseClient): Promise<boolean> {
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data } = await db
    .schema("app")
    .from("sync_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", cutoff)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function upsertBatches(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[]
): Promise<number> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db
      .schema("kaiten")
      .from(table)
      .upsert(rows.slice(i, i + BATCH), { onConflict: "id" });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
  return rows.length;
}

const now = () => new Date().toISOString();

function slim(raw: KaitenEntity, drop: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...raw };
  for (const k of drop) delete copy[k];
  return copy;
}

function transformCard(c: KaitenEntity): Record<string, unknown> {
  const tags = Array.isArray(c.tags) ? (c.tags as KaitenEntity[]) : [];
  const members = Array.isArray(c.members) ? (c.members as KaitenEntity[]) : [];
  return {
    id: c.id,
    board_id: c.board_id,
    column_id: c.column_id ?? null,
    title: c.title ?? "",
    type_id: c.type_id ?? null,
    parent_ids: (c.parents_ids as number[] | null) ?? [],
    tag_ids: tags.map((t) => t.id),
    member_ids: members.map((m) => m.id),
    state: c.state != null ? String(c.state) : null,
    archived: Boolean(c.archived),
    estimate_workload: (c.estimate_workload as number | null) ?? null,
    completed_at: iso(c.completed_at),
    kaiten_created_at: iso(c.created),
    kaiten_updated_at: iso(c.updated),
    synced_at: now(),
    raw: slim(c, ["board", "column", "lane", "members", "description_html"]),
  };
}

function transformTimeLog(t: KaitenEntity): Record<string, unknown> {
  return {
    id: t.id,
    card_id: t.card_id ?? (t.card as KaitenEntity | undefined)?.id ?? null,
    user_id: t.user_id ?? t.author_id ?? null,
    minutes: t.time_spent ?? 0,
    log_date: t.for_date ?? null,
    comment: (t.comment as string | null) || null,
    kaiten_created_at: iso(t.created),
    kaiten_updated_at: iso(t.updated),
    synced_at: now(),
    raw: slim(t, ["card", "user", "author", "owner", "role"]),
  };
}

/** Справочники и структура: spaces, boards, users, tags, card_types */
export async function syncStructure(db = createServiceClient()): Promise<Stats> {
  const runId = await startRun(db, "structure", "full");
  try {
    const stats: Stats = {};

    const spaces = await kaiten.spaces();
    stats.spaces = await upsertBatches(
      db,
      "spaces",
      spaces.map((s) => ({
        id: s.id,
        title: s.title ?? "",
        archived: Boolean(s.archived),
        kaiten_updated_at: iso(s.updated),
        synced_at: now(),
        raw: s,
      }))
    );

    let boardCount = 0;
    for (const s of spaces) {
      const boards = await kaiten.spaceBoards(s.id);
      boardCount += await upsertBatches(
        db,
        "boards",
        boards.map((b) => ({
          id: b.id,
          space_id: s.id,
          title: b.title ?? "",
          archived: Boolean(b.archived),
          kaiten_updated_at: iso(b.updated),
          synced_at: now(),
          raw: b,
        }))
      );
    }
    stats.boards = boardCount;

    const users = await kaiten.users();
    stats.users = await upsertBatches(
      db,
      "users",
      users.map((u) => ({
        id: u.id,
        full_name: (u.full_name as string | null) ?? null,
        email: (u.email as string | null) ?? null,
        activated: u.activated !== false,
        kaiten_updated_at: iso(u.updated),
        synced_at: now(),
        raw: slim(u, ["email_settings", "beta_features", "apps_permissions"]),
      }))
    );

    const tags = await kaiten.tags();
    stats.tags = await upsertBatches(
      db,
      "tags",
      tags.map((t) => ({ id: t.id, name: t.name ?? "", synced_at: now(), raw: t }))
    );

    const types = await kaiten.cardTypes();
    stats.card_types = await upsertBatches(
      db,
      "card_types",
      types.map((t) => ({ id: t.id, name: t.name ?? "", synced_at: now(), raw: t }))
    );

    await finishRun(db, runId, stats);
    return stats;
  } catch (e) {
    await failRun(db, runId, e);
    throw e;
  }
}

/** Карточки: full или инкрементально по updated_after (курсор в sync_state) */
export async function syncCards(
  mode: "full" | "incremental",
  db = createServiceClient()
): Promise<Stats> {
  const runId = await startRun(db, "cards", mode);
  try {
    let updatedAfter: string | undefined;
    if (mode === "incremental") {
      const { data } = await db
        .schema("app")
        .from("sync_state")
        .select("last_cursor")
        .eq("entity", "cards")
        .maybeSingle();
      updatedAfter = data?.last_cursor ?? undefined;
    }
    // перекрытие 10 минут против гонок часов
    const cursor = new Date(Date.now() - 10 * 60_000).toISOString();

    const cards = await kaiten.cards({ updatedAfter });
    const count = await upsertBatches(db, "cards", cards.map(transformCard));

    await db
      .schema("app")
      .from("sync_state")
      .upsert({ entity: "cards", last_cursor: cursor }, { onConflict: "entity" });

    const stats = { cards: count };
    await finishRun(db, runId, stats);
    return stats;
  } catch (e) {
    await failRun(db, runId, e);
    throw e;
  }
}

/**
 * Тайм-логи за окно дат: fetch из Kaiten → атомарный replace через RPC.
 * Окно покрывает ретро-логирование и правки; удаление+вставка в одной транзакции.
 */
export async function syncTimeLogsWindow(
  from: string,
  to: string,
  db = createServiceClient()
): Promise<Stats> {
  const runId = await startRun(db, "time_logs", "window_replace", { from, to });
  try {
    const logs = await kaiten.timeLogs(from, to);
    const rows = logs.map(transformTimeLog).filter((r) => r.log_date && r.card_id);

    const { data, error } = await db
      .schema("app")
      .rpc("replace_time_logs", { p_from: from, p_to: to, p_rows: rows });
    if (error) throw new Error(`replace_time_logs: ${error.message}`);

    const stats: Stats = {
      fetched: logs.length,
      inserted: (data as Stats | null)?.inserted ?? rows.length,
      deleted: (data as Stats | null)?.deleted ?? 0,
    };
    await finishRun(db, runId, stats);
    return stats;
  } catch (e) {
    await failRun(db, runId, e);
    throw e;
  }
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

/** Стандартный ежедневный прогон: структура + карточки + окно логов 45 дней */
export async function dailySync(db = createServiceClient()): Promise<Stats> {
  const structure = await syncStructure(db);
  const cards = await syncCards("incremental", db);
  const to = new Date();
  const from = new Date(to.getTime() - 45 * 86_400_000);
  const logs = await syncTimeLogsWindow(fmt(from), fmt(to), db);
  return { ...structure, ...cards, time_logs_inserted: logs.inserted };
}
