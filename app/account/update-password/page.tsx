"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const init = async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const errDesc = hash.get("error_description");
      if (errDesc) {
        setError(decodeURIComponent(errDesc));
        setReady(true);
        return;
      }
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (error) {
          setError("Ссылка недействительна или устарела. Запросите новую.");
        } else {
          window.history.replaceState(null, "", window.location.pathname);
        }
        setReady(true);
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setError("Нет активной сессии. Откройте эту страницу по ссылке из письма восстановления пароля.");
      }
      setReady(true);
    };
    void init();
  }, [supabase]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) {
      setError("Пароль должен быть не короче 8 символов");
      return;
    }
    if (pw !== pw2) {
      setError("Пароли не совпадают");
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/");
  };

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold">Задать новый пароль</h1>
        {!ready && <p className="text-sm text-neutral-500">Проверка ссылки…</p>}
        {error && (
          <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>
        )}
        <input
          type="password"
          required
          minLength={8}
          placeholder="новый пароль (мин. 8 символов)"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <input
          type="password"
          required
          placeholder="повторите пароль"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={!ready || saving}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {saving ? "Сохраняю…" : "Сохранить пароль"}
        </button>
      </form>
    </main>
  );
}
