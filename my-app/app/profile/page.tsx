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
    return (
      <p role="alert">Could not verify your session. Please sign in again.</p>
    );
  }
  if (!user) redirect("/auth/login");

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
    <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start">
      <div className="flex justify-center lg:justify-start">
        <ProfileForm profile={profileData} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold">Your posts</h2>
          <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
            {posts?.length ?? 0}
          </span>
        </div>

        {!posts || posts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-muted-foreground">
            No posts yet. Share your first captioned image from the home feed.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {posts.map((post) => (
              <article
                key={post.id}
                className="overflow-hidden rounded-xl border border-border bg-background"
              >
                {post.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={post.image_url}
                    alt={post.caption ?? "User post"}
                    className="h-56 w-full object-cover"
                  />
                ) : null}
                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <time dateTime={post.created_at}>
                      {new Date(post.created_at).toLocaleString()}
                    </time>
                    <span>
                      {post.likes} likes · {post.dislikes} dislikes
                    </span>
                  </div>
                  {post.caption ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {post.caption}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No caption provided.
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
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
            AI Meme Caption Generator
          </Link>
          <Link
            href="/home"
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-accent"
          >
            Home
          </Link>
        </header>

        <section className="min-h-[80vh] pt-6">
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
