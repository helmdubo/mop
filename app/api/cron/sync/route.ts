import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { dailySync, hasActiveRun } from "@/lib/sync/engine";

export const maxDuration = 60;

/** Ежедневный синк (Vercel Cron, Authorization: Bearer CRON_SECRET) */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  if (await hasActiveRun(db)) {
    return NextResponse.json({ ok: true, skipped: "sync already running" });
  }

  try {
    const stats = await dailySync(db);
    return NextResponse.json({ ok: true, stats });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
