import { NextResponse } from "next/server";

export const maxDuration = 60;

/**
 * Часовой инкрементальный синк (Фаза 0, в разработке).
 * Vercel Cron шлёт GET с заголовком Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO(Фаза 0): инкрементальный синк spaces/boards/users/cards,
  // оконный replace time_logs через RPC app.replace_time_logs
  return NextResponse.json({ ok: true, message: "sync engine not implemented yet" });
}
