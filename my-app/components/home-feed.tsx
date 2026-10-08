"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  createPost,
  deletePost,
  getPostVotes,
  getPosts,
  removePostImage,
  removePostVote,
  savePostVote,
  uploadPostImage,
} from "@/lib/posts";
import type { PostWithProfile, PostVote } from "@/lib/posts";
import { createClient } from "@/lib/supabase/client";

const PAGE_SIZE = 12;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

type HomeFeedProps = {
  initialPosts: PostWithProfile[];
  initialVotes: PostVote[];
  initialUserId: string | null;
  initialHasMore: boolean;
  loadError: string | null;
  initialVoteError: string | null;
};

function getOwnerName(post: PostWithProfile) {
  const name = [post.profiles?.first_name, post.profiles?.last_name]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ");
  return name || "Anonymous user";
}

function imagePathFromPublicUrl(url: string) {
  const marker = "/post-images/";
  const markerIndex = url.indexOf(marker);
  if (markerIndex === -1) return null;

  try {
    return decodeURIComponent(url.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
}

export function HomeFeed({
  initialPosts,
  initialVotes,
  initialUserId,
  initialHasMore,
  loadError,
  initialVoteError,
}: HomeFeedProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const captionRequestIdRef = useRef(0);
  const [posts, setPosts] = useState(initialPosts);
  const [votes, setVotes] = useState<Record<string, 1 | -1>>(() =>
    Object.fromEntries(initialVotes.map(({ post_id, vote }) => [post_id, vote])),
  );
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [feedError, setFeedError] = useState(loadError);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [postingMessage, setPostingMessage] = useState<string | null>(null);
  const [busyPostIds, setBusyPostIds] = useState<Set<string>>(new Set());
  const [voteError, setVoteError] = useState<string | null>(initialVoteError);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  useEffect(() => {
    if (!postingMessage) return;
    const timeout = window.setTimeout(() => setPostingMessage(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [postingMessage]);

  const refreshFeed = async () => {
    const { data: refreshedPosts, error } = await getPosts(
      supabase,
      0,
      PAGE_SIZE - 1,
    );
    if (error) {
      console.error("Failed to refresh posts:", error);
      setFeedError("Could not refresh the posts. Please try again.");
      return;
    }

    setFeedError(null);
    const safePosts = refreshedPosts ?? [];
    setPosts(safePosts);
    setHasMore(safePosts.length === PAGE_SIZE);

    if (initialUserId) {
      const { data: refreshedVotes, error: votesError } = await getPostVotes(
        supabase,
        initialUserId,
        safePosts.map((post) => post.id),
      );
      if (votesError) {
        console.error("Failed to refresh post votes:", votesError);
        setVoteError("Could not load your votes. Please refresh the page.");
        return;
      }
      setVotes(
        Object.fromEntries(
          (refreshedVotes ?? []).map(({ post_id, vote }) => [post_id, vote]),
        ),
      );
    }
  };

  const validateImage = (file: File) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return "Choose a JPEG, PNG, WebP, or GIF image.";
    }
    if (file.size > MAX_IMAGE_SIZE) {
      return "Images must be 5 MB or smaller.";
    }
    return null;
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    setFormError(null);
    setCaption(null);

    if (!file) return;
    const validationError = validateImage(file);
    if (validationError) {
      setSelectedFile(null);
      setPreviewUrl(null);
      setFormError(validationError);
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleGenerateCaption = async () => {
    if (!selectedFile || isGenerating) return;
    const validationError = validateImage(selectedFile);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setIsGenerating(true);
    setFormError(null);
    setCaption(null);
    const requestId = ++captionRequestIdRef.current;
    try {
      const formData = new FormData();
      formData.append("image", selectedFile);
      const response = await fetch("/api/generate-captions", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        caption?: unknown;
        error?: string;
      };
      if (!response.ok) {
        if (response.status === 401) {
          router.push("/auth/login");
        }
        throw new Error(result.error || "Could not generate a caption.");
      }
      if (typeof result.caption !== "string" || !result.caption.trim()) {
        throw new Error("The caption response was empty. Please try again.");
      }
      if (captionRequestIdRef.current === requestId) {
        setCaption(result.caption.trim());
      }
    } catch (error) {
      if (captionRequestIdRef.current === requestId) {
        setFormError(
          error instanceof Error
            ? error.message
            : "Caption generation failed. Please try again.",
        );
      }
    } finally {
      if (captionRequestIdRef.current === requestId) {
        setIsGenerating(false);
      }
    }
  };

  const handleCancelPost = () => {
    captionRequestIdRef.current += 1;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    setCaption(null);
    setIsGenerating(false);
    setFormError(null);
    setPostingMessage(null);
  };

  const handleCreatePost = async () => {
    if (!selectedFile || !caption || isPosting) return;
    const validationError = validateImage(selectedFile);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setIsPosting(true);
    setFormError(null);
    setPostingMessage(null);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) throw new Error("Could not verify your session. Sign in again.");
      if (!user) {
        router.push("/auth/login");
        throw new Error("Please sign in to publish a post.");
      }

      const path = `${user.id}/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[selectedFile.type]}`;
      const { error: uploadError } = await uploadPostImage(
        supabase,
        path,
        selectedFile,
      );
      if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);

      try {
        const { data: insertedPost, error: insertError } = await createPost(
          supabase,
          {
            post_owner: user.id,
            image_url: supabase.storage.from("post-images").getPublicUrl(path)
              .data.publicUrl,
            caption,
          },
        );
        if (insertError || !insertedPost) {
          throw new Error(
            insertError?.message || "The post could not be created.",
          );
        }
      } catch (error) {
        try {
          const { error: cleanupError } = await removePostImage(supabase, path);
          if (cleanupError) {
            console.error(
              "Failed to remove orphaned post image:",
              cleanupError,
            );
          }
        } catch (cleanupError) {
          console.error("Failed to remove orphaned post image:", cleanupError);
        }
        throw error;
      }

      handleCancelPost();
      await refreshFeed();
      setPostingMessage("Post published.");
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Could not publish the post. Please try again.",
      );
    } finally {
      setIsPosting(false);
    }
  };

  const handleVote = async (postId: string, targetVote: 1 | -1) => {
    if (!initialUserId) {
      window.alert("Please log in to like or dislike a post.");
      router.push("/auth/login");
      return;
    }
    if (busyPostIds.has(postId)) return;

    const previousPost = posts.find((post) => post.id === postId);
    const oldVote = votes[postId] ?? null;
    const nextVote = oldVote === targetVote ? null : targetVote;

    setVoteError(null);
    setBusyPostIds((current) => new Set(current).add(postId));
    setVotes((current) => {
      const updated = { ...current };
      if (nextVote === null) delete updated[postId];
      else updated[postId] = nextVote;
      return updated;
    });
    setPosts((current) =>
      current.map((post) => {
        if (post.id !== postId) return post;
        return {
          ...post,
          likes:
            post.likes -
            (oldVote === 1 ? 1 : 0) +
            (nextVote === 1 ? 1 : 0),
          dislikes:
            post.dislikes -
            (oldVote === -1 ? 1 : 0) +
            (nextVote === -1 ? 1 : 0),
        };
      }),
    );

    try {
      const { error } =
        nextVote === null
          ? await removePostVote(supabase, postId, initialUserId)
          : await savePostVote(supabase, {
              post_id: postId,
              user_id: initialUserId,
              vote: nextVote,
            });
      if (error) throw error;
    } catch (error) {
      console.error("Failed to save post vote:", error);
      if (previousPost) {
        setPosts((current) =>
          current.map((post) => (post.id === postId ? previousPost : post)),
        );
      }
      setVotes((current) => {
        const updated = { ...current };
        if (oldVote === null) delete updated[postId];
        else updated[postId] = oldVote;
        return updated;
      });
      setVoteError("Your vote could not be saved. Please try again.");
    } finally {
      setBusyPostIds((current) => {
        const updated = new Set(current);
        updated.delete(postId);
        return updated;
      });
    }
  };

  const handleDeletePost = async (post: PostWithProfile) => {
    if (!initialUserId || post.post_owner !== initialUserId) return;
    if (!window.confirm("Delete this post? This cannot be undone.")) return;

    setBusyPostIds((current) => new Set(current).add(post.id));
    setVoteError(null);
    const { data, error } = await deletePost(supabase, post.id, initialUserId);
    if (error || !data) {
      console.error("Failed to delete post:", error);
      setVoteError(error?.message || "The post could not be deleted.");
      setBusyPostIds((current) => {
        const updated = new Set(current);
        updated.delete(post.id);
        return updated;
      });
      return;
    }

    setPosts((current) => current.filter(({ id }) => id !== post.id));
    setVotes((current) => {
      const updated = { ...current };
      delete updated[post.id];
      return updated;
    });
    const imagePath = imagePathFromPublicUrl(post.image_url);
    if (imagePath) {
      try {
        const { error: storageError } = await removePostImage(
          supabase,
          imagePath,
        );
        if (storageError) {
          console.error(
            "Post was deleted, but its image cleanup failed:",
            storageError,
          );
        }
      } catch (storageError) {
        console.error(
          "Post was deleted, but its image cleanup failed:",
          storageError,
        );
      }
    }
    setBusyPostIds((current) => {
      const updated = new Set(current);
      updated.delete(post.id);
      return updated;
    });
  };

  const handleLoadMore = async () => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    setFeedError(null);
    try {
      const { data: morePosts, error } = await getPosts(
        supabase,
        posts.length,
        posts.length + PAGE_SIZE - 1,
      );
      if (error) throw error;

      const newPosts = morePosts ?? [];
      if (initialUserId && newPosts.length > 0) {
        const { data: newVotes, error: newVotesError } = await getPostVotes(
          supabase,
          initialUserId,
          newPosts.map((post) => post.id),
        );
        if (newVotesError) throw newVotesError;
        setVotes((current) => ({
          ...current,
          ...Object.fromEntries(
            (newVotes ?? []).map(({ post_id, vote }) => [post_id, vote]),
          ),
        }));
      }
      setPosts((current) => [...current, ...newPosts]);
      setHasMore(newPosts.length === PAGE_SIZE);
    } catch (error) {
      console.error("Failed to load more posts:", error);
      setFeedError("Could not load more posts. Please try again.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <header className="mb-8 flex items-center justify-between">
          <Link href="/home" className="text-xl font-semibold">
            AI Caption Generator
          </Link>
          {initialUserId ? (
            <Link
              href="/profile"
              className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-accent"
            >
              Profile
            </Link>
          ) : (
            <Link
              href="/auth/login"
              className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-accent"
            >
              Log in
            </Link>
          )}
        </header>

        {initialUserId ? (
          <section className="mb-10 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h1 className="mb-4 text-xl font-semibold">Create a post</h1>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleFileChange}
              disabled={isGenerating || isPosting}
            />

            {!selectedFile ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
              >
                Choose image
              </button>
            ) : (
              caption ? (
                <div className="flex w-full flex-col items-center gap-4 text-center">
                  {previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt="Post preview"
                      className="max-h-96 w-full max-w-lg rounded-xl object-contain"
                    />
                  )}
                  <p className="w-full max-w-lg text-center leading-relaxed">
                    {caption}
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleCancelPost}
                      disabled={isPosting}
                      className="rounded-full border border-border bg-background px-6 py-3 text-sm font-semibold shadow-sm transition hover:bg-accent disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreatePost}
                      disabled={isPosting}
                      className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-60"
                    >
                      {isPosting ? "Posting..." : "Post"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex w-full flex-col items-start gap-4">
                  {previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt="Post preview"
                      className="max-h-96 w-full max-w-lg rounded-xl object-contain"
                    />
                  )}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleCancelPost}
                      disabled={isPosting || isGenerating}
                      className="rounded-full border border-border bg-background px-6 py-3 text-sm font-semibold shadow-sm transition hover:bg-accent disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleGenerateCaption}
                      disabled={isGenerating || isPosting}
                      className="rounded-full border border-border bg-background px-6 py-3 text-sm font-semibold shadow-sm transition hover:bg-accent disabled:opacity-60"
                    >
                      {isGenerating ? "Generating caption..." : "Generate caption"}
                    </button>
                  </div>
                </div>
              )
            )}
            {formError && (
              <p className="mt-3 text-sm text-red-600" role="alert">
                {formError}
              </p>
            )}
            {postingMessage && (
              <p className="mt-3 text-sm text-green-700" role="status">
                {postingMessage}
              </p>
            )}
          </section>
        ) : (
          <p className="mb-10 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <Link className="font-semibold text-foreground underline" href="/auth/login">
              Log in
            </Link>{" "}
            to create posts and vote.
          </p>
        )}

        <section
          aria-label="Posts feed"
          className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {feedError && (
            <p className="col-span-full rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700" role="alert">
              {feedError}
            </p>
          )}
          {voteError && (
            <p className="col-span-full rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700" role="alert">
              {voteError}
            </p>
          )}
          {posts.length === 0 && !feedError && (
            <p className="col-span-full rounded-xl border border-border p-6 text-center text-muted-foreground">
              No posts yet. Be the first to share one.
            </p>
          )}

          {posts.map((post) => {
            const ownerPicture = post.profiles?.profile_picture_url;
            const ownerName = getOwnerName(post);
            const selectedVote = votes[post.id];
            const isBusy = busyPostIds.has(post.id);

            return (
              <article
                key={post.id}
                className="overflow-hidden rounded-2xl border border-border bg-card text-sm shadow-sm"
              >
                <header className="flex items-center gap-2 p-3">
                  {ownerPicture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ownerPicture}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground"
                    >
                      {ownerName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate font-semibold">{ownerName}</p>
                    <time
                      dateTime={post.created_at}
                      className="text-xs text-muted-foreground"
                    >
                      {new Date(post.created_at).toLocaleString()}
                    </time>
                  </div>
                  {initialUserId === post.post_owner && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDeletePost(post)}
                      className="rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </header>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.image_url}
                  alt={post.caption || `Image posted by ${ownerName}`}
                  className="h-64 w-full bg-muted object-cover"
                />
                {post.caption && (
                  <p className="line-clamp-4 whitespace-pre-wrap px-3 pb-2 pt-3 text-left text-sm leading-relaxed">
                    {post.caption}
                  </p>
                )}
                <div className="flex items-center gap-2 px-3 pb-3 pt-1">
                  <button
                    type="button"
                    aria-pressed={selectedVote === 1}
                    disabled={isBusy}
                    onClick={() => void handleVote(post.id, 1)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                      selectedVote === 1
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    Like · {post.likes}
                  </button>
                  <button
                    type="button"
                    aria-pressed={selectedVote === -1}
                    disabled={isBusy}
                    onClick={() => void handleVote(post.id, -1)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                      selectedVote === -1
                        ? "border-destructive bg-destructive text-destructive-foreground"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    Dislike · {post.dislikes}
                  </button>
                </div>
              </article>
            );
          })}
        </section>

        {hasMore && (
          <div className="py-8 text-center">
            <button
              type="button"
              onClick={() => void handleLoadMore()}
              disabled={isLoadingMore}
              className="rounded-full border border-border bg-card px-6 py-3 text-sm font-semibold shadow-sm transition hover:bg-accent disabled:opacity-60"
            >
              {isLoadingMore ? "Loading posts..." : "Load more"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
