import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/profile-form";

async function ProfileContent() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/auth/login");

    const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, first_name, last_name, profile_picture_url")
        .eq("id", user.id)
        .single();

    return (
        <ProfileForm
            profile={
                profile ?? {
                    id: user.id,
                    email: user.email ?? "",
                    first_name: null,
                    last_name: null,
                    profile_picture_url: null,
                }
            }
        />
    );
}

export default function ProfilePage() {
    return (
        <main className="flex min-h-svh w-full items-center justify-center p-6">
            <Suspense fallback={<p className="text-sm text-muted-foreground">Loading profile...</p>}>
                <ProfileContent />
            </Suspense>
        </main>
    );
}