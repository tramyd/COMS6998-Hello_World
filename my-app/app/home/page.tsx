import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getPostVotes, getPosts } from "@/lib/posts";
import type { PostVote } from "@/lib/posts";
import { HomeFeed } from "@/components/home-feed";

const PAGE_SIZE = 12;

async function HomePageContent() {
  const supabase = await createClient();
  const [
    { data: posts, error: postsError },
    {
      data: { user },
      error: authError,
    },
  ] = await Promise.all([getPosts(supabase, 0, PAGE_SIZE - 1), supabase.auth.getUser()]);

  if (postsError) console.error("Failed to load posts:", postsError);
  const hasMissingSession = authError?.name === "AuthSessionMissingError";
  if (authError && !hasMissingSession) {
    console.error("Failed to verify viewer session:", authError);
  }

  let votes: PostVote[] = [];
  let voteErrorMessage: string | null = null;
  if (user && posts && !postsError) {
    const { data, error } = await getPostVotes(
      supabase,
      user.id,
      posts.map((post) => post.id),
    );
    if (error) {
      console.error("Failed to load post votes:", error);
      voteErrorMessage = "Could not load your votes. Please refresh the page.";
    } else {
      votes = data ?? [];
    }
  }

  return (
    <HomeFeed
      initialPosts={postsError ? [] : posts ?? []}
      initialVotes={votes}
      initialUserId={
        authError && !hasMissingSession ? null : (user?.id ?? null)
      }
      initialHasMore={!postsError && (posts?.length ?? 0) === PAGE_SIZE}
      loadError={
        postsError ? "Could not load posts. Please refresh the page." : null
      }
      initialVoteError={voteErrorMessage}
    />
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-background px-6 py-12 text-center text-muted-foreground">
          Loading posts...
        </main>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
