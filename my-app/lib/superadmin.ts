import type { SupabaseClient } from "@supabase/supabase-js";

const ADMIN_PANEL_PRODUCTION_URL = "https://coms-6998-admin-panel.vercel.app";

export async function checkSuperadmin(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("superadmins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  return { isSuperadmin: Boolean(data) && !error, error };
}

export function getAdminPanelUrl() {
  return (
    process.env.ADMIN_PANEL_URL?.trim() ||
    (process.env.VERCEL
      ? ADMIN_PANEL_PRODUCTION_URL
      : "http://localhost:3001")
  );
}
