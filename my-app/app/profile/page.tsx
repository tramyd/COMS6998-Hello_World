import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkSuperadmin, getAdminPanelUrl } from "@/lib/superadmin";
import { ProfileForm } from "@/components/profile-form";
import { ProfilePosts } from "@/components/profile-posts";
import Link from "next/link";

async function ProfileContent() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.error("Failed to verify profile session:", authError);
    return (
      <p role="alert">Could not verify your session. Please sign in again.</p>
    );
  }
  if (!user) redirect("/auth/login");

  const access = await checkSuperadmin(supabase, user.id);
  if (access.error) {
    console.error("Failed to verify superadmin access:", access.error);
  }

  const [
    { data: profile, error: profileError },
    { data: posts, error: postsError },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, first_name, last_name, profile_picture_url")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("posts")
      .select("id, created_at, post_owner, image_url, caption, likes, dislikes")
      .eq("post_owner", user.id)
      .order("created_at", { ascending: false }),
  ]);

  if (profileError) {
    console.error("Failed to load profile:", profileError);
    return <p role="alert">Could not load your profile. Please try again.</p>;
  }

  if (postsError) {
    console.error("Failed to load profile posts:", postsError);
  }

  const profileData = {
    id: user.id,
    email: user.email ?? "",
    first_name: profile?.first_name ?? null,
    last_name: profile?.last_name ?? null,
    profile_picture_url: profile?.profile_picture_url ?? null,
  };

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/home"
          className="text-xl font-semibold text-foreground transition hover:opacity-80"
        >
          AI Meme Caption Generator
        </Link>
        <nav className="flex items-center gap-2" aria-label="Profile navigation">
          {access.isSuperadmin ? (
            <a
              href={getAdminPanelUrl()}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-accent"
            >
              Admin Panel
            </a>
          ) : null}
          <Link
            href="/home"
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-accent"
          >
            Home
          </Link>
        </nav>
      </header>

      <section className="min-h-[80vh] pt-6">
        <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start">
          <div className="flex justify-center lg:justify-start">
            <ProfileForm profile={profileData} />
          </div>

          <ProfilePosts initialPosts={posts ?? []} userId={user.id} />
        </div>
      </section>
    </>
  );
}

export default function ProfilePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">
              Loading profile...
            </p>
          }
        >
          <ProfileContent />
        </Suspense>
      </div>
    </main>
  );
}
