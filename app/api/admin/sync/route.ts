import { NextResponse } from "next/server";
import { getCurrentAppUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  hasActiveRun,
  syncCards,
  syncStructure,
  syncTimeLogsWindow,
} from "@/lib/sync/engine";

export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ручной запуск синка со страницы /admin/sync (owner/pm).
 * body: { action: 'structure' | 'cards_full' | 'cards_incremental' | 'timelogs',
 *         from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }
 */
export async function POST(request: Request) {
  const appUser = await getCurrentAppUser();
  if (!appUser || !["owner", "pm"].includes(appUser.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");

  const db = createServiceClient();
  if (await hasActiveRun(db)) {
    return NextResponse.json({ error: "Синк уже выполняется" }, { status: 409 });
  }

  try {
    switch (action) {
      case "structure":
        return NextResponse.json({ ok: true, stats: await syncStructure(db) });
      case "cards_full":
        return NextResponse.json({ ok: true, stats: await syncCards("full", db) });
      case "cards_incremental":
        return NextResponse.json({ ok: true, stats: await syncCards("incremental", db) });
      case "timelogs": {
        const { from, to } = body;
        if (!DATE_RE.test(from ?? "") || !DATE_RE.test(to ?? "")) {
          return NextResponse.json({ error: "from/to: YYYY-MM-DD" }, { status: 400 });
        }
        return NextResponse.json({
          ok: true,
          stats: await syncTimeLogsWindow(from, to, db),
        });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
