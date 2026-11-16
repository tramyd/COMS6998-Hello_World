"use client";

import { useState } from "react";
import { deletePost, type Post } from "@/lib/posts";
import { createClient } from "@/lib/supabase/client";

type ProfilePostsProps = {
  initialPosts: Post[];
  userId: string;
};

export function ProfilePosts({ initialPosts, userId }: ProfilePostsProps) {
  const [supabase] = useState(() => createClient());
  const [posts, setPosts] = useState(initialPosts);
  const [deletingPostIds, setDeletingPostIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async (postId: string) => {
    if (deletingPostIds.has(postId)) return;
    if (
      !window.confirm("Delete this post? It will no longer appear publicly.")
    ) {
      return;
    }

    setDeleteError(null);
    setDeletingPostIds((current) => new Set(current).add(postId));
    try {
      const { data, error } = await deletePost(supabase, postId, userId);
      if (error) throw error;
      if (!data) {
        setDeleteError("This post could not be found. Please refresh the page.");
        return;
      }

      setPosts((current) => current.filter((post) => post.id !== postId));
    } catch (error) {
      console.error("Failed to delete profile post:", error);
      setDeleteError("The post could not be deleted. Please try again.");
    } finally {
      setDeletingPostIds((current) => {
        const updated = new Set(current);
        updated.delete(postId);
        return updated;
      });
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold">Your posts</h2>
        <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
          {posts.length}
        </span>
      </div>

      {deleteError && (
        <p
          className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {deleteError}
        </p>
      )}

      {posts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-muted-foreground">
          No posts yet. Share your first captioned image from the home feed.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {posts.map((post) => {
            const isDeleting = deletingPostIds.has(post.id);

            return (
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
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleDelete(post.id)}
                      disabled={isDeleting}
                      className="rounded-full border border-destructive px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive hover:text-destructive-foreground disabled:opacity-60"
                    >
                      {isDeleting ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
