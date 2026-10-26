import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_GEMINI_ATTEMPTS = 2;
const CAPTION_IMPROVEMENT_TIMEOUT_MS = 120_000;
const PROMPT_LOG_TIMEOUT_MS = 3_000;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const CAPTION_PROMPT =
  "Write exactly one short, witty meme caption for this photo, focusing on the subjects, action, and mood. Return only the caption as plain text. Use standard punctuation only where it reads naturally. Do not add quotation marks, decorative or repeated punctuation, labels, markdown, or alternative captions.";
const IMPROVE_CAPTION_PROMPT =
  "Improve the draft meme caption that follows. Make it concise, witty, and natural while preserving its meaning and factual details. Return exactly one improved caption as plain text. Do not add explanations, quotation marks, labels, markdown, or decorative or repeated punctuation.";

class CaptionGenerationTimeoutError extends Error {}

class GeminiApiError extends Error {
  constructor(
    readonly status: number,
    readonly providerStatus: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "GeminiApiError";
  }
}

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

type GeminiContents = Array<{ parts: GeminiPart[] }>;

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
      ?? ""
  );
}

function isGeminiQuotaError(error: unknown) {
  if (
    error instanceof GeminiApiError &&
    (error.status === 429 || error.providerStatus === "RESOURCE_EXHAUSTED")
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("Quota exceeded") ||
    message.includes("quota exceeded") ||
    message.includes("generate_content_free_tier_requests")
  );
}

function isRetryableGeminiError(error: unknown) {
  if (error instanceof GeminiApiError) {
    return error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    !isGeminiQuotaError(error) &&
    (message.includes("503") ||
      message.includes("UNAVAILABLE") ||
      message.includes("429") ||
      message.includes("RATE_LIMIT") ||
      message.includes("RESOURCE_EXHAUSTED"))
  );
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function logPromptChainStep(
  supabase: SupabaseClient,
  step: {
    chainId: string;
    userId: string;
    stage: "draft" | "improve";
    model: string;
    prompt: string;
    response: string;
    imageMimeType: string;
  },
) {
  try {
    const { error } = await supabase
      .from("prompt_chain_steps")
      .insert({
        chain_id: step.chainId,
        user_id: step.userId,
        stage: step.stage,
        model: step.model,
        prompt: step.prompt,
        response: step.response,
        image_mime_type: step.imageMimeType,
      })
      .abortSignal(AbortSignal.timeout(PROMPT_LOG_TIMEOUT_MS));
    if (error) {
      console.error("Failed to save prompt chain step:", error);
    }
  } catch (error) {
    console.error("Failed to save prompt chain step:", error);
  }
}

async function callGeminiWithModel(
  contents: GeminiContents,
  model: string,
  options: { signal?: AbortSignal; maxAttempts?: number } = {},
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const maxAttempts = options.maxAttempts ?? MAX_GEMINI_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            generationConfig: { temperature: 0.3 },
          }),
          signal: options.signal,
        },
      );

      if (!response.ok) {
        const responseBody = await response.text();
        let providerMessage = responseBody;
        let providerStatus: string | undefined;
        try {
          const payload = JSON.parse(responseBody) as {
            error?: { message?: string; status?: string };
          };
          providerMessage = payload.error?.message || responseBody;
          providerStatus = payload.error?.status;
        } catch {
          // Keep the response text for diagnostic logging when it is not JSON.
        }
        const error = new GeminiApiError(
          response.status,
          providerStatus,
          `Gemini request failed (${response.status}${providerStatus ? ` ${providerStatus}` : ""}): ${providerMessage}`,
        );
        if (
          attempt < maxAttempts &&
          isRetryableGeminiError(error)
        ) {
          await delay(750 * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      }

      return parseGeminiText((await response.json()) as GeminiResponse);
    } catch (error) {
      if (options.signal?.aborted) {
        throw new CaptionGenerationTimeoutError(
          "Caption improvement exceeded its time limit.",
        );
      }
      if (attempt < maxAttempts && isRetryableGeminiError(error)) {
        await delay(750 * 2 ** (attempt - 1));
        continue;
      }
      throw error;
    }
  }

  return "";
}

async function generateCaption(
  supabase: SupabaseClient,
  userId: string,
  imageBase64: string,
  mimeType: string,
) {
  const models = Array.from(
    new Set(
      [process.env.GEMINI_MODEL, "gemini-3.8-flash"].filter(
        (model): model is string => Boolean(model),
      ),
    ),
  );
  let lastError: unknown = null;

  for (const model of models) {
    const chainId = randomUUID();
    let draft: string;
    try {
      draft = await callGeminiWithModel(
        [
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
        model,
      );
    } catch (error) {
      if (isGeminiQuotaError(error) || error instanceof CaptionGenerationTimeoutError) {
        throw error;
      }
      lastError = error;
      continue;
    }

    await logPromptChainStep(supabase, {
      chainId,
      userId,
      stage: "draft",
      model,
      prompt: CAPTION_PROMPT,
      response: draft,
      imageMimeType: mimeType,
    });
    if (!draft.trim()) {
      lastError = new Error(`Gemini returned an empty draft for ${model}.`);
      continue;
    }

    const draftCaption = draft.trim();
    const improvePrompt = `${IMPROVE_CAPTION_PROMPT}\n\nDraft caption:\n${draftCaption}`;
    try {
      const improvedCaption = await callGeminiWithModel(
        [{ parts: [{ text: improvePrompt }] }],
        model,
        {
          signal: AbortSignal.timeout(CAPTION_IMPROVEMENT_TIMEOUT_MS),
          maxAttempts: 1,
        },
      );
      await logPromptChainStep(supabase, {
        chainId,
        userId,
        stage: "improve",
        model,
        prompt: improvePrompt,
        response: improvedCaption,
        imageMimeType: mimeType,
      });
      if (improvedCaption.trim()) return improvedCaption.trim();
      console.warn(
        `Gemini returned an empty improved caption for ${model}; returning the draft.`,
      );
    } catch (error) {
      console.warn(
        `Caption improvement failed for ${model}; returning the draft.`,
        error,
      );
    }

    return draftCaption;
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
    const caption = await generateCaption(
      supabase,
      user.id,
      bytes.toString("base64"),
      image.type,
    );
    return NextResponse.json({ caption });
  } catch (error) {
    console.error("Caption generation failed:", error);
    const message =
      error instanceof Error &&
      error.message === "GEMINI_API_KEY is not configured."
        ? "Caption generation is not configured. Set GEMINI_API_KEY in the server environment."
        : error instanceof CaptionGenerationTimeoutError
          ? "Caption generation is taking too long. Please try again."
          : isGeminiQuotaError(error)
            ? "Gemini API quota is exhausted for this model. Wait for the quota to reset or enable a plan with additional quota."
            : error instanceof GeminiApiError &&
                (error.status === 400 || error.status === 404)
              ? "Gemini rejected the request or configured model. Check GEMINI_MODEL and the server logs for the provider's error details."
              : error instanceof GeminiApiError &&
                  (error.status === 401 || error.status === 403)
                ? "Gemini rejected the API credentials or access. Check the API key and model permissions."
            : isRetryableGeminiError(error)
              ? "The caption service is temporarily busy. Please wait a moment and try again."
              : "Caption generation failed. Please try again.";
    return NextResponse.json(
      { error: message },
      {
        status: isGeminiQuotaError(error)
          ? 429
          : error instanceof CaptionGenerationTimeoutError
            ? 504
            : isRetryableGeminiError(error)
              ? 503
              : 502,
      },
    );
  }
}
