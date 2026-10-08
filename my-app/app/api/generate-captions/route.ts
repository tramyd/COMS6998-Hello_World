import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const CAPTION_PROMPT =
  "Describe this photo in one clear sentence, focusing on the subjects, action, and mood.";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

function parseGeminiText(payload: GeminiResponse): string {
  return (
    payload.candidates
      ?.map(
        (candidate) =>
          candidate.content?.parts?.map((part) => part.text ?? "").join("\n") ??
          "",
      )
      .join("\n")
      .trim() ?? ""
  );
}

function isGeminiQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("Quota exceeded") ||
    message.includes("quota exceeded") ||
    message.includes("generate_content_free_tier_requests")
  );
}

function isRetryableGeminiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return !isGeminiQuotaError(error) &&
    (message.includes("503") ||
      message.includes("UNAVAILABLE") ||
      message.includes("429") ||
      message.includes("RATE_LIMIT") ||
      message.includes("RESOURCE_EXHAUSTED"));
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function callGeminiWithModel(
  imageBase64: string,
  mimeType: string,
  model: string,
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: CAPTION_PROMPT },
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: imageBase64,
                    },
                  },
                ],
              },
            ],
            generationConfig: { temperature: 0.8 },
          }),
        },
      );

      if (!response.ok) {
        const error = new Error(
          `Gemini request failed: ${await response.text()}`,
        );
        if (attempt < 3 && isRetryableGeminiError(error)) {
          await delay(750 * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      }

      return parseGeminiText((await response.json()) as GeminiResponse);
    } catch (error) {
      if (attempt < 3 && isRetryableGeminiError(error)) {
        await delay(750 * 2 ** (attempt - 1));
        continue;
      }
      throw error;
    }
  }

  return "";
}

async function generateCaption(imageBase64: string, mimeType: string) {
  const models = Array.from(
    new Set(
      [process.env.GEMINI_MODEL, "gemini-3.8-flash"].filter(
        (model): model is string => Boolean(model),
      ),
    ),
  );
  let lastError: unknown = null;

  for (const model of models) {
    try {
      const caption = await callGeminiWithModel(imageBase64, mimeType, model);
      if (caption.trim()) return caption.trim();
      lastError = new Error(`Gemini returned an empty response for ${model}.`);
    } catch (error) {
      if (isGeminiQuotaError(error)) throw error;
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  throw new Error("No Gemini model is configured.");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.error("Could not verify the caption request session:", authError);
    return NextResponse.json(
      { error: "Could not verify your session. Please sign in again." },
      { status: 401 },
    );
  }

  if (!user) {
    return NextResponse.json(
      { error: "Please sign in to generate a caption." },
      { status: 401 },
    );
  }

  const formData = await request.formData();
  const image = formData.get("image");

  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json(
      { error: "Please choose an image to caption." },
      { status: 400 },
    );
  }
  if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
    return NextResponse.json(
      { error: "Choose a JPEG, PNG, WebP, or GIF image." },
      { status: 400 },
    );
  }
  if (image.size > MAX_IMAGE_SIZE) {
    return NextResponse.json(
      { error: "Images must be 5 MB or smaller." },
      { status: 413 },
    );
  }

  try {
    const bytes = Buffer.from(await image.arrayBuffer());
    const caption = await generateCaption(bytes.toString("base64"), image.type);
    return NextResponse.json({ caption });
  } catch (error) {
    console.error("Caption generation failed:", error);
    const message =
      error instanceof Error &&
      error.message === "GEMINI_API_KEY is not configured."
        ? "Caption generation is not configured. Set GEMINI_API_KEY in the server environment."
        : isGeminiQuotaError(error)
          ? "Gemini API quota is exhausted for this model. Wait for the quota to reset or enable a plan with additional quota."
        : isRetryableGeminiError(error)
          ? "The caption service is temporarily busy. Please wait a moment and try again."
          : "Caption generation failed. Please try again.";
    return NextResponse.json(
      { error: message },
      {
        status: isGeminiQuotaError(error)
          ? 429
          : isRetryableGeminiError(error)
            ? 503
            : 502,
      },
    );
  }
}
