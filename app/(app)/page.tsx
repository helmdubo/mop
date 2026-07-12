import Link from "next/link";

export default function CockpitPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">Кокпит</h1>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/billing"
          className="rounded-xl border border-neutral-200 bg-white p-4 hover:border-neutral-400"
        >
          <h2 className="text-sm font-medium text-neutral-500">Биллинг</h2>
          <p className="mt-2 text-sm">Пул задач, апрувы часов, инвойсы →</p>
        </Link>
        <Link
          href="/admin/sync"
          className="rounded-xl border border-neutral-200 bg-white p-4 hover:border-neutral-400"
        >
          <h2 className="text-sm font-medium text-neutral-500">Синк Kaiten</h2>
          <p className="mt-2 text-sm">Статус, ручной запуск, импорт истории →</p>
        </Link>
        <div className="rounded-xl border border-dashed border-neutral-300 p-4">
          <h2 className="text-sm font-medium text-neutral-400">Утилизация</h2>
          <p className="mt-2 text-sm text-neutral-400">Фаза 2</p>
        </div>
      </section>
    </main>
  );
}
