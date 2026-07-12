import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createPeriod } from "@/lib/billing/actions";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  draft: "черновик",
  internal_review: "внутренний апрув",
  client_review: "у клиента",
  approved: "согласован",
  invoiced: "инвойс выставлен",
};

export default async function BillingPage() {
  const appUser = await getCurrentAppUser();
  if (!appUser) redirect("/");

  const supabase = await createClient();
  const [{ data: periods }, { data: clients }] = await Promise.all([
    supabase
      .schema("app")
      .from("billing_periods")
      .select("id, period_start, period_end, status, clients(name)")
      .order("period_start", { ascending: false }),
    supabase.schema("app").from("clients").select("id, name").order("name"),
  ]);

  const canEdit = ["owner", "pm"].includes(appUser.role);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">Биллинг</h1>

      {canEdit && (
        <form
          action={createPeriod}
          className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4"
        >
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Клиент</span>
            <select
              name="client_id"
              required
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Период (месяц)</span>
            <input
              type="month"
              name="month"
              required
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            Создать период
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Клиент</th>
              <th className="px-4 py-2">Период</th>
              <th className="px-4 py-2">Статус</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {(periods ?? []).map((p) => (
              <tr key={p.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                <td className="px-4 py-2">
                  {(p.clients as unknown as { name: string } | null)?.name}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {p.period_start} → {p.period_end}
                </td>
                <td className="px-4 py-2">{STATUS_LABELS[p.status] ?? p.status}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/billing/${p.id}`} className="text-sky-700 hover:underline">
                    Открыть →
                  </Link>
                </td>
              </tr>
            ))}
            {(periods ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                  Периодов ещё нет — создайте первый
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
