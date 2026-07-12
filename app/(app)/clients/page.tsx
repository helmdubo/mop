import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addContact, addRateCard, createClientRecord } from "./actions";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const appUser = await getCurrentAppUser();
  if (!appUser) redirect("/");
  const canEdit = ["owner", "pm"].includes(appUser.role);

  const supabase = await createClient();
  const [{ data: clients }, { data: contacts }, { data: rates }] = await Promise.all([
    supabase
      .schema("app")
      .from("clients")
      .select("id, name, admin_percent, kaiten_space_id")
      .order("name"),
    supabase.schema("app").from("client_contacts").select("*").order("full_name"),
    supabase
      .schema("app")
      .from("rate_cards")
      .select("*")
      .order("valid_from", { ascending: false }),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">Клиенты</h1>

      {canEdit && (
        <form
          action={createClientRecord}
          className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4"
        >
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Название</span>
            <input
              name="name"
              required
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Administration, %</span>
            <input
              name="admin_percent"
              type="number"
              step="0.5"
              defaultValue={18}
              className="w-24 rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            Добавить клиента
          </button>
        </form>
      )}

      <div className="space-y-4">
        {(clients ?? []).map((c) => {
          const clientContacts = (contacts ?? []).filter((x) => x.client_id === c.id);
          const clientRates = (rates ?? []).filter(
            (x) => x.client_id === c.id && !x.project_id
          );
          return (
            <div key={c.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-lg font-medium">{c.name}</h2>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">
                  administration {Number(c.admin_percent)}%
                </span>
                {c.kaiten_space_id && (
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800">
                    Kaiten space {c.kaiten_space_id}
                  </span>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-xs font-medium uppercase text-neutral-400">
                    Ставки (T&M)
                  </h3>
                  <ul className="space-y-0.5 text-sm">
                    {clientRates.map((r) => (
                      <li key={r.id}>
                        {Number(r.hourly_rate)} {r.currency}/ч · с {r.valid_from}
                        {r.valid_to ? ` по ${r.valid_to}` : " (текущая)"}
                      </li>
                    ))}
                    {clientRates.length === 0 && (
                      <li className="text-neutral-400">нет ставок</li>
                    )}
                  </ul>
                  {canEdit && (
                    <form action={addRateCard} className="mt-2 flex flex-wrap items-center gap-1">
                      <input type="hidden" name="client_id" value={c.id} />
                      <input
                        name="hourly_rate"
                        type="number"
                        step="0.01"
                        placeholder="ставка"
                        required
                        className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      />
                      <select
                        name="currency"
                        className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      >
                        <option>USD</option>
                        <option>EUR</option>
                      </select>
                      <input
                        name="valid_from"
                        type="date"
                        required
                        className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      />
                      <button className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">
                        Новая ставка
                      </button>
                    </form>
                  )}
                </div>

                <div>
                  <h3 className="mb-1 text-xs font-medium uppercase text-neutral-400">
                    Контакты (art managers)
                  </h3>
                  <ul className="space-y-0.5 text-sm">
                    {clientContacts.map((ct) => (
                      <li key={ct.id}>
                        {ct.full_name}
                        {ct.role ? ` — ${ct.role}` : ""}
                      </li>
                    ))}
                    {clientContacts.length === 0 && (
                      <li className="text-neutral-400">нет контактов</li>
                    )}
                  </ul>
                  {canEdit && (
                    <form action={addContact} className="mt-2 flex flex-wrap items-center gap-1">
                      <input type="hidden" name="client_id" value={c.id} />
                      <input
                        name="full_name"
                        placeholder="имя"
                        required
                        className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      />
                      <input
                        name="role"
                        placeholder="роль"
                        className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      />
                      <button className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">
                        Добавить
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
