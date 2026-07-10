import { createClient } from "@supabase/supabase-js";

/**
 * Service-role клиент. ЕДИНСТВЕННОЕ разрешённое место использования —
 * cron-роуты синка (app/api/cron/*). Обходит RLS: в пользовательском
 * коде запрещён (см. README, принцип 1).
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service credentials are not configured");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
