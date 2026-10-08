import type { SupabaseClient } from "@supabase/supabase-js";

export type Profile = {
  id: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
};

export type Post = {
  id: string;
  created_at: string;
  post_owner: string;
  image_url: string;
  caption: string | null;
  likes: number;
  dislikes: number;
};

export type PostVote = {
  post_id: string;
  user_id: string;
  vote: 1 | -1;
};

export type PostWithProfile = Post & {
  profiles: Profile | null;
};

export async function getPosts(
  supabase: SupabaseClient,
  from: number,
  to: number,
) {
  const { data: posts, error: postsError } = await supabase
    .from("posts")
    .select("id, created_at, post_owner, image_url, caption, likes, dislikes")
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<Post[]>();

  if (postsError || !posts) return { data: null, error: postsError };

  const ownerIds = Array.from(new Set(posts.map((post) => post.post_owner)));
  if (ownerIds.length === 0) {
    return { data: [] as PostWithProfile[], error: null };
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, created_at, first_name, last_name, profile_picture_url")
    .in("id", ownerIds)
    .returns<Profile[]>();

  if (profilesError) return { data: null, error: profilesError };

  const profilesById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );

  return {
    data: posts.map((post) => ({
      ...post,
      profiles: profilesById.get(post.post_owner) ?? null,
    })),
    error: null,
  };
}

export async function getPostVotes(
  supabase: SupabaseClient,
  userId: string,
  postIds: string[],
) {
  if (postIds.length === 0) return { data: [] as PostVote[], error: null };

  const { data, error } = await supabase
    .from("post_votes")
    .select("post_id, user_id, vote")
    .eq("user_id", userId)
    .in("post_id", postIds)
    .returns<PostVote[]>();

  return { data, error };
}

export async function createPost(
  supabase: SupabaseClient,
  post: Pick<Post, "post_owner" | "image_url" | "caption">,
) {
  return supabase.from("posts").insert(post).select("id").single();
}

export async function savePostVote(
  supabase: SupabaseClient,
  vote: PostVote,
) {
  return supabase
    .from("post_votes")
    .upsert(vote, { onConflict: "post_id,user_id" });
}

export async function removePostVote(
  supabase: SupabaseClient,
  postId: string,
  userId: string,
) {
  return supabase
    .from("post_votes")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", userId);
}

export async function deletePost(
  supabase: SupabaseClient,
  postId: string,
  userId: string,
) {
  return supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("post_owner", userId)
    .select("id")
    .maybeSingle();
}

export async function uploadPostImage(
  supabase: SupabaseClient,
  path: string,
  file: File,
) {
  return supabase.storage.from("post-images").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
}

export async function removePostImage(supabase: SupabaseClient, path: string) {
  return supabase.storage.from("post-images").remove([path]);
}
