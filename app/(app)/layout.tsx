import Link from "next/link";
import { getCurrentAppUser } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

export default async function AppShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const appUser = await getCurrentAppUser();

  if (!appUser) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="max-w-sm space-y-4 rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Нет доступа</h1>
          <p className="text-sm text-neutral-500">
            Ваш аккаунт не приглашён в MOP или деактивирован. Обратитесь к администратору.
          </p>
          <form action={signOut}>
            <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
              Выйти
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="px-4 py-4 text-lg font-semibold tracking-tight">MOP</div>
        <nav className="flex-1 space-y-1 px-2 text-sm">
          <Link href="/" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
            Кокпит
          </Link>
          <Link href="/projects" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
            Проекты
          </Link>
          <Link href="/clients" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
            Клиенты
          </Link>
          <Link href="/employees" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
            Сотрудники
          </Link>
          <Link href="/billing" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
            Биллинг
          </Link>
          <Link href="/admin/sync" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
            Синк Kaiten
          </Link>
        </nav>
        <div className="border-t border-neutral-200 p-4 text-xs text-neutral-500">
          <div className="truncate">{appUser.email}</div>
          <div>роль: {appUser.role}</div>
          <form action={signOut} className="mt-2">
            <button className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100">
              Выйти
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1 bg-neutral-50">{children}</div>
    </div>
  );
}
