import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createProject,
  linkKaitenTag,
  setProjectStatus,
  unlinkKaitenTag,
} from "./actions";

export const dynamic = "force-dynamic";

const STATUSES = [
  ["presale", "пресейл"],
  ["active", "в продакшене"],
  ["on_hold", "на паузе"],
  ["completed", "завершён"],
  ["archived", "архив"],
] as const;

const STATUS_LABEL = Object.fromEntries(STATUSES);

export default async function ProjectsPage() {
  const appUser = await getCurrentAppUser();
  if (!appUser) redirect("/");
  const canEdit = ["owner", "pm"].includes(appUser.role);

  const supabase = await createClient();
  const [{ data: projects }, { data: clients }, { data: mappings }, { data: tags }] =
    await Promise.all([
      supabase
        .schema("app")
        .from("projects")
        .select("id, name, status, notes, clients(name)")
        .order("created_at"),
      supabase.schema("app").from("clients").select("id, name").order("name"),
      supabase
        .schema("app")
        .from("project_tag_mappings")
        .select("id, project_id, kaiten_tag_id, kaiten_tag_name"),
      supabase.schema("kaiten").from("tags").select("id, name").order("name"),
    ]);

  const mappedTagIds = new Set((mappings ?? []).map((m) => m.kaiten_tag_id));
  const freeTags = (tags ?? []).filter((t) => !mappedTagIds.has(t.id));
  const mappingsByProject = new Map<string, typeof mappings>();
  for (const m of mappings ?? []) {
    const list = mappingsByProject.get(m.project_id) ?? [];
    list.push(m);
    mappingsByProject.set(m.project_id, list);
  }

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="mb-2 text-2xl font-semibold">Проекты</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Проекты MOP первичны: проект заводится с пресейла. Связь с Kaiten (теги) —
        отдельный шаг, после которого MOP видит его производственные данные.
      </p>

      {canEdit && (
        <form
          action={createProject}
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
            <span className="mb-1 block text-neutral-500">Статус</span>
            <select
              name="status"
              defaultValue="presale"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              {STATUSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            Создать проект
          </button>
        </form>
      )}

      <div className="space-y-3">
        {(projects ?? []).map((p) => {
          const links = mappingsByProject.get(p.id) ?? [];
          return (
            <div key={p.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-48">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-neutral-500">
                    {(p.clients as unknown as { name: string } | null)?.name}
                  </div>
                </div>
                {canEdit ? (
                  <form action={setProjectStatus} className="flex items-center gap-1">
                    <input type="hidden" name="project_id" value={p.id} />
                    <select
                      name="status"
                      defaultValue={p.status}
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
                  <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs">
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                )}

                <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                  {links.length === 0 && (
                    <span className="text-xs text-neutral-400">
                      не связан с Kaiten
                    </span>
                  )}
                  {links.map((m) => (
                    <form key={m!.id} action={unlinkKaitenTag}>
                      <input type="hidden" name="mapping_id" value={m!.id} />
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-xs text-sky-800">
                        тег: {m!.kaiten_tag_name ?? m!.kaiten_tag_id}
                        {canEdit && (
                          <button className="text-sky-400 hover:text-sky-700" title="Отвязать">
                            ×
                          </button>
                        )}
                      </span>
                    </form>
                  ))}
                  {canEdit && freeTags.length > 0 && (
                    <form action={linkKaitenTag} className="flex items-center gap-1">
                      <input type="hidden" name="project_id" value={p.id} />
                      <select
                        name="kaiten_tag_id"
                        className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                      >
                        {freeTags.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <button className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">
                        Связать тег
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {(projects ?? []).length === 0 && (
          <p className="py-6 text-center text-neutral-400">Проектов пока нет</p>
        )}
      </div>
    </main>
  );
}
