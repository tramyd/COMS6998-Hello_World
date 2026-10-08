import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/profile-form";
import Link from "next/link";

async function ProfileContent() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    console.error("Failed to verify profile session:", authError);
    return <p role="alert">Could not verify your session. Please sign in again.</p>;
  }
  if (!user) redirect("/auth/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, profile_picture_url")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load profile:", error);
    return <p role="alert">Could not load your profile. Please try again.</p>;
  }

  return (
    <ProfileForm
      profile={{
        id: user.id,
        email: user.email ?? "",
        first_name: profile?.first_name ?? null,
        last_name: profile?.last_name ?? null,
        profile_picture_url: profile?.profile_picture_url ?? null,
      }}
    />
  );
}

export default function ProfilePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <header className="flex items-center justify-between">
          <Link
            href="/home"
            className="text-xl font-semibold text-foreground transition hover:opacity-80"
          >
            AI Caption Generator
          </Link>
        </header>

        <section className="flex min-h-[80vh] flex-col items-center justify-center text-center">
          <Suspense
            fallback={
              <p className="text-sm text-muted-foreground">
                Loading profile...
              </p>
            }
          >
            <ProfileContent />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
