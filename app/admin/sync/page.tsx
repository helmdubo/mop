import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SyncControls } from "./controls";

export const dynamic = "force-dynamic";

export default async function SyncAdminPage() {
  const appUser = await getCurrentAppUser();
  if (!appUser || !["owner", "pm"].includes(appUser.role)) redirect("/");

  const supabase = await createClient();
  const [{ data: runs }, { data: state }] = await Promise.all([
    supabase
      .schema("app")
      .from("sync_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(25),
    supabase.schema("app").from("sync_state").select("*"),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Синхронизация Kaiten</h1>
          <p className="text-sm text-neutral-500">
            Курсор карточек:{" "}
            {state?.find((s) => s.entity === "cards")?.last_cursor ?? "—"}
          </p>
        </div>
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          ← Кокпит
        </Link>
      </header>

      <SyncControls />

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium">Последние запуски</h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2">Сущность</th>
                <th className="px-4 py-2">Режим</th>
                <th className="px-4 py-2">Окно</th>
                <th className="px-4 py-2">Статус</th>
                <th className="px-4 py-2">Статистика</th>
                <th className="px-4 py-2">Начат</th>
              </tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="border-b border-neutral-100">
                  <td className="px-4 py-2">{r.entity}</td>
                  <td className="px-4 py-2">{r.mode}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {r.window_from ? `${r.window_from} → ${r.window_to}` : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        r.status === "completed"
                          ? "text-green-700"
                          : r.status === "failed"
                            ? "text-red-700"
                            : "text-amber-600"
                      }
                    >
                      {r.status}
                    </span>
                    {r.error && (
                      <div className="max-w-xs truncate text-xs text-red-500" title={r.error}>
                        {r.error}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.stats ? JSON.stringify(r.stats) : "—"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-xs">
                    {new Date(r.started_at).toLocaleString("ru-RU")}
                  </td>
                </tr>
              ))}
              {(runs ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">
                    Запусков ещё не было
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
