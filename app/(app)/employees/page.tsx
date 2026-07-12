import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createEmployee,
  linkKaitenUser,
  setEmployeeStatus,
  unlinkKaitenUser,
} from "./actions";

export const dynamic = "force-dynamic";

const STATUSES = [
  ["probation", "испытательный"],
  ["active", "в штате"],
  ["terminated", "уволен"],
] as const;

export default async function EmployeesPage() {
  const appUser = await getCurrentAppUser();
  if (!appUser) redirect("/");
  const canEdit = ["owner", "pm"].includes(appUser.role);

  const supabase = await createClient();
  const [{ data: employees }, { data: kaitenUsers }] = await Promise.all([
    supabase.schema("app").from("employees").select("*").order("full_name"),
    supabase
      .schema("kaiten")
      .from("users")
      .select("id, full_name, email, activated")
      .order("full_name"),
  ]);

  const linkedIds = new Set(
    (employees ?? []).map((e) => e.kaiten_user_id).filter(Boolean)
  );
  const freeKaitenUsers = (kaitenUsers ?? []).filter(
    (u) => !linkedIds.has(u.id) && u.activated
  );
  const kaitenById = new Map((kaitenUsers ?? []).map((u) => [u.id, u]));

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="mb-2 text-2xl font-semibold">Сотрудники</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Реестр MOP первичен: сотрудник заводится с найма. Связь с Kaiten-аккаунтом —
        отдельный шаг; несвязанные пользователи Kaiten: {freeKaitenUsers.length}.
      </p>

      {canEdit && (
        <form
          action={createEmployee}
          className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4"
        >
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">ФИО</span>
            <input
              name="full_name"
              required
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Страна</span>
            <select name="country" className="rounded-md border border-neutral-300 px-3 py-2 text-sm">
              <option value="AM">Армения</option>
              <option value="RU">Россия</option>
              <option value="KG">Кыргызстан</option>
              <option value="GE">Грузия</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Тип</span>
            <select
              name="employment_type"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="contractor">контракт</option>
              <option value="staff">штат</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Дата найма</span>
            <input
              name="hire_date"
              type="date"
              required
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Грейд</span>
            <input
              name="grade"
              placeholder="junior/middle/senior"
              className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Роль</span>
            <input
              name="role_title"
              placeholder="3D Artist"
              className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            Добавить
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Сотрудник</th>
              <th className="px-4 py-2">Страна</th>
              <th className="px-4 py-2">Тип</th>
              <th className="px-4 py-2">Грейд / роль</th>
              <th className="px-4 py-2">Статус</th>
              <th className="px-4 py-2">Kaiten</th>
            </tr>
          </thead>
          <tbody>
            {(employees ?? []).map((e) => {
              const ku = e.kaiten_user_id ? kaitenById.get(e.kaiten_user_id) : null;
              return (
                <tr key={e.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="px-4 py-2">
                    <div className="font-medium">{e.full_name}</div>
                    <div className="text-xs text-neutral-400">с {e.hire_date}</div>
                  </td>
                  <td className="px-4 py-2">{e.country}</td>
                  <td className="px-4 py-2">
                    {e.employment_type === "staff" ? "штат" : "контракт"}
                  </td>
                  <td className="px-4 py-2">
                    {[e.grade, e.role_title].filter(Boolean).join(" / ") || "—"}
                  </td>
                  <td className="px-4 py-2">
                    {canEdit ? (
                      <form action={setEmployeeStatus} className="flex items-center gap-1">
                        <input type="hidden" name="employee_id" value={e.id} />
                        <select
                          name="status"
                          defaultValue={e.status}
                          className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                        >
                          {STATUSES.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <button className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">
                          ✓
                        </button>
                      </form>
                    ) : (
                      e.status
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {ku ? (
                      <form action={unlinkKaitenUser} className="flex items-center gap-1">
                        <input type="hidden" name="employee_id" value={e.id} />
                        <span className="rounded-full bg-sky-50 px-2 py-1 text-xs text-sky-800">
                          {ku.full_name ?? ku.email ?? e.kaiten_user_id}
                        </span>
                        {canEdit && (
                          <button className="text-xs text-neutral-400 hover:text-neutral-700" title="Отвязать">
                            ×
                          </button>
                        )}
                      </form>
                    ) : canEdit && freeKaitenUsers.length > 0 ? (
                      <form action={linkKaitenUser} className="flex items-center gap-1">
                        <input type="hidden" name="employee_id" value={e.id} />
                        <select
                          name="kaiten_user_id"
                          className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                        >
                          {freeKaitenUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name ?? u.email}
                            </option>
                          ))}
                        </select>
                        <button className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">
                          Связать
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-neutral-400">не связан</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {(employees ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">
                  Сотрудников пока нет — добавьте первого
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
