"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

export async function createEmployee(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const hireDate = String(formData.get("hire_date") ?? "");
  if (!fullName || !hireDate) throw new Error("Имя и дата найма обязательны");

  const { error } = await supabase.schema("app").from("employees").insert({
    full_name: fullName,
    country: String(formData.get("country") ?? "AM"),
    employment_type: String(formData.get("employment_type") ?? "contractor"),
    hire_date: hireDate,
    status: String(formData.get("status") ?? "probation"),
    grade: String(formData.get("grade") ?? "") || null,
    role_title: String(formData.get("role_title") ?? "") || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/employees");
}

/** Связать сотрудника MOP с пользователем Kaiten */
export async function linkKaitenUser(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();
  const kaitenUserId = Number(formData.get("kaiten_user_id"));
  if (!kaitenUserId) return;

  const { error } = await supabase
    .schema("app")
    .from("employees")
    .update({ kaiten_user_id: kaitenUserId })
    .eq("id", String(formData.get("employee_id")));
  if (error) throw new Error(error.message);
  revalidatePath("/employees");
}

export async function unlinkKaitenUser(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();
  const { error } = await supabase
    .schema("app")
    .from("employees")
    .update({ kaiten_user_id: null })
    .eq("id", String(formData.get("employee_id")));
  if (error) throw new Error(error.message);
  revalidatePath("/employees");
}

export async function setEmployeeStatus(formData: FormData) {
  await requireRole("owner", "pm");
  const supabase = await createClient();
  const status = String(formData.get("status"));
  const patch: Record<string, unknown> = { status };
  if (status === "terminated") {
    patch.termination_date = new Date().toISOString().slice(0, 10);
  }
  const { error } = await supabase
    .schema("app")
    .from("employees")
    .update(patch)
    .eq("id", String(formData.get("employee_id")));
  if (error) throw new Error(error.message);
  revalidatePath("/employees");
}
