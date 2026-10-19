import Link from "next/link";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";
import { checkSuperadmin, getAdminPanelUrl } from "@/lib/superadmin";

export async function AuthButton() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  let showAdminPanel = false;

  if (error && error.name !== "AuthSessionMissingError") {
    console.error("Failed to verify signed-in user:", error);
  }
  if (user) {
    const access = await checkSuperadmin(supabase, user.id);
    if (access.error) {
      console.error("Failed to verify superadmin access:", access.error);
    } else {
      showAdminPanel = access.isSuperadmin;
    }
  }

  return user ? (
    <div className="flex items-center gap-4">
      Hey, {user.email}!
      {showAdminPanel ? (
        <Button asChild size="sm" variant="outline">
          <a href={getAdminPanelUrl()} target="_blank" rel="noreferrer">
            Admin panel
          </a>
        </Button>
      ) : null}
      <LogoutButton />
    </div>
  ) : (
    <div className="flex gap-2">
      <Button asChild size="sm" variant={"outline"}>
        <Link href="/auth/login">Sign in</Link>
      </Button>
      <Button asChild size="sm" variant={"default"}>
        <Link href="/auth/sign-up">Sign up</Link>
      </Button>
    </div>
  );
}
