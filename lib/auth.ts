import { createClient } from "@/lib/supabase/server";

export type AppRole = "owner" | "pm" | "lead";

export interface AppUser {
  auth_user_id: string;
  email: string;
  role: AppRole;
  employee_id: string | null;
  active: boolean;
}

/**
 * Текущий пользователь приложения (auth-сессия + строка app.app_users).
 * Возвращает null, если не залогинен или деактивирован.
 */
export async function getCurrentAppUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .schema("app")
    .from("app_users")
    .select("auth_user_id, email, role, employee_id, active")
    .eq("auth_user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  return (data as AppUser | null) ?? null;
}

export async function requireRole(...roles: AppRole[]): Promise<AppUser> {
  const appUser = await getCurrentAppUser();
  if (!appUser || !roles.includes(appUser.role)) {
    throw new Error("Forbidden");
  }
  return appUser;
}
