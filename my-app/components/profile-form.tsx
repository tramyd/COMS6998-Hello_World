"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoutButton } from "@/components/logout-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ProfileFormData = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
};

const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function ProfileForm({ profile }: { profile: ProfileFormData }) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [saved, setSaved] = useState(profile);
  const [firstName, setFirstName] = useState(profile.first_name ?? "");
  const [lastName, setLastName] = useState(profile.last_name ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);

  // Hide the photo message after 3 seconds
  useEffect(() => {
    if (!photoMessage) return;
    const timer = setTimeout(() => setPhotoMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [photoMessage]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [message]);

  const handleSave = async () => {
    setError(null);
    setMessage(null);

    if (!firstName.trim()) {
      setError("First name is required.");
      return;
    }

    setSaving(true);
    const { data, error } = await supabase
      .from("profiles")
      .update({ first_name: firstName.trim(), last_name: lastName.trim() })
      .eq("id", saved.id)
      .select("id, created_at, first_name, last_name, profile_picture_url")
      .maybeSingle();
    setSaving(false);

    if (error) {
      console.error("Failed to update profile name:", error);
      setError(error.message);
      return;
    }
    if (!data) {
      setError("Profile row not found, so nothing was updated.");
      return;
    }

    setSaved({
      ...saved,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
    });
    setEditing(false);
    setMessage("Name updated.");
  };

  const handleCancel = () => {
    setFirstName(saved.first_name ?? "");
    setLastName(saved.last_name ?? "");
    setEditing(false);
    setError(null);
  };

  const uploadFile = async (file: File) => {
    setError(null);
    setMessage(null);
    setPhotoMessage(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Please choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("Image must be 2 MB or smaller.");
      return;
    }

    setUploading(true);

    // One file per user, stored in their own folder and overwritten on re-upload
    const path = `${saved.id}/avatar`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      setUploading(false);
      console.error("Failed to upload profile picture:", uploadError);
      setError(uploadError.message);
      return;
    }

    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(path);
    // Cache-buster so the browser shows the new image after a replace
    const url = `${urlData.publicUrl}?v=${Date.now()}`;

    const { data: updatedProfile, error: updateError } = await supabase
      .from("profiles")
      .update({ profile_picture_url: url })
      .eq("id", saved.id)
      .select("id")
      .maybeSingle();

    setUploading(false);

    if (updateError) {
      console.error("Failed to save profile picture URL:", updateError);
      setError(updateError.message);
      return;
    }
    if (!updatedProfile) {
      setError("Profile row not found, so the picture URL was not updated.");
      return;
    }

    setSaved({ ...saved, profile_picture_url: url });
    setPhotoMessage("Profile picture updated.");
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = ""; // allow re-selecting the same file
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const openFilePicker = () => fileInputRef.current?.click();

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Your profile</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Hidden file input shared by both states */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onFileChosen}
          disabled={uploading}
        />

        {/* Profile picture */}
        <div className="flex flex-col gap-2">
          {saved.profile_picture_url ? (
            // Photo exists: show it with just an edit button
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={saved.profile_picture_url}
                alt="Profile picture"
                className="h-28 w-28 rounded-full object-cover"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openFilePicker}
                disabled={uploading}
              >
                {uploading ? "Uploading..." : "Change photo"}
              </Button>
              {photoMessage && (
                <p className="text-sm text-green-600">{photoMessage}</p>
              )}
            </div>
          ) : (
            // No photo yet: show the upload area
            <div
              role="button"
              tabIndex={0}
              onClick={openFilePicker}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") openFilePicker();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                dragOver
                  ? "border-primary bg-muted"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground">
                No photo
              </div>
              <p className="text-sm text-muted-foreground">
                {uploading
                  ? "Uploading..."
                  : "Click or drag an image here (JPG, PNG, WebP, max 2 MB)"}
              </p>
            </div>
          )}
        </div>

        {/* Email (read-only), directly under the picture */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={saved.email} disabled readOnly />
        </div>

        {/* Name fields */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="first_name">First name</Label>
            <Input
              id="first_name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={!editing}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="last_name">Last name</Label>
            <Input
              id="last_name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={!editing}
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {message && <p className="text-sm text-green-600">{message}</p>}

        <div className="flex gap-2">
          {editing ? (
            <>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(true);
                setMessage(null);
              }}
            >
              Edit name
            </Button>
          )}
        </div>

        <div className="flex justify-end">
          <LogoutButton />
        </div>
      </CardContent>
    </Card>
  );
}
