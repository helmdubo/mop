"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

export async function createClientRecord(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Название обязательно");

  const { error } = await supabase.schema("app").from("clients").insert({
    name,
    admin_percent: Number(formData.get("admin_percent") ?? 18),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/clients");
}

export async function addContact(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) return;

  const { error } = await supabase.schema("app").from("client_contacts").insert({
    client_id: String(formData.get("client_id")),
    full_name: fullName,
    role: String(formData.get("role") ?? "") || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/clients");
}

export async function addRateCard(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();
  const clientId = String(formData.get("client_id"));
  const rate = Number(formData.get("hourly_rate"));
  const validFrom = String(formData.get("valid_from"));
  if (!clientId || !rate || !validFrom) throw new Error("Ставка и дата обязательны");

  // закрываем текущую открытую ставку днём раньше новой
  const { error: closeErr } = await supabase
    .schema("app")
    .from("rate_cards")
    .update({
      valid_to: new Date(new Date(validFrom).getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10),
    })
    .eq("client_id", clientId)
    .is("valid_to", null)
    .is("project_id", null);
  if (closeErr) throw new Error(closeErr.message);

  const { error } = await supabase.schema("app").from("rate_cards").insert({
    client_id: clientId,
    hourly_rate: rate,
    currency: String(formData.get("currency") ?? "USD"),
    valid_from: validFrom,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/clients");
}
