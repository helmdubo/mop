import { signIn } from "./actions";

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await props.searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form
        action={signIn}
        className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold">MOP — вход</h1>
        <p className="text-sm text-neutral-500">
          Доступ только по приглашению администратора.
        </p>
        {error && (
          <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">
            Неверный email или пароль
          </p>
        )}
        <input
          name="email"
          type="email"
          required
          placeholder="email"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="пароль"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Войти
        </button>
      </form>
    </main>
  );
}
