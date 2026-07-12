"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

export async function createProject(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  const clientId = String(formData.get("client_id") ?? "");
  if (!name || !clientId) throw new Error("Название и клиент обязательны");

  const { error } = await supabase.schema("app").from("projects").insert({
    name,
    client_id: clientId,
    status: String(formData.get("status") ?? "presale"),
    notes: String(formData.get("notes") ?? "") || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/projects");
}

export async function setProjectStatus(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();
  const { error } = await supabase
    .schema("app")
    .from("projects")
    .update({ status: String(formData.get("status")) })
    .eq("id", String(formData.get("project_id")));
  if (error) throw new Error(error.message);
  revalidatePath("/projects");
}

/** Связать проект MOP с тегом Kaiten — с этого момента MOP «видит» его продакшен */
export async function linkKaitenTag(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();
  const projectId = String(formData.get("project_id"));
  const tagId = Number(formData.get("kaiten_tag_id"));
  if (!projectId || !tagId) return;

  const { data: tag } = await supabase
    .schema("kaiten")
    .from("tags")
    .select("name")
    .eq("id", tagId)
    .maybeSingle();

  const { error } = await supabase.schema("app").from("project_tag_mappings").insert({
    project_id: projectId,
    kaiten_tag_id: tagId,
    kaiten_tag_name: tag?.name ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/projects");
}

export async function unlinkKaitenTag(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();
  const { error } = await supabase
    .schema("app")
    .from("project_tag_mappings")
    .delete()
    .eq("id", String(formData.get("mapping_id")));
  if (error) throw new Error(error.message);
  revalidatePath("/projects");
}
