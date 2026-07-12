import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth";
import { signOut } from "./login/actions";

export default async function CockpitPage() {
  const appUser = await getCurrentAppUser();
  if (!appUser) {
    // Залогинен в Supabase, но не приглашён в app_users или деактивирован
    redirect("/login?error=1");
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Кокпит</h1>
          <p className="text-sm text-neutral-500">
            {appUser.email} · роль: {appUser.role}
          </p>
        </div>
        <form action={signOut}>
          <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
            Выйти
          </button>
        </form>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <a
          href="/admin/sync"
          className="rounded-xl border border-neutral-200 bg-white p-4 hover:border-neutral-400"
        >
          <h2 className="text-sm font-medium text-neutral-500">Синк Kaiten</h2>
          <p className="mt-2 text-sm">Статус, ручной запуск, импорт истории →</p>
        </a>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-medium text-neutral-500">Биллинг</h2>
          <p className="mt-2 text-sm">Фаза 1 — после фундамента</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-medium text-neutral-500">Утилизация</h2>
          <p className="mt-2 text-sm">Фаза 2</p>
        </div>
      </section>
    </main>
  );
}
