import { createHash } from "node:crypto";
import { AllProvidersFailedError, extractWithFallback, NoProvidersError, summarizeAttempts } from "@/lib/ai/fallback";
import { getProviders } from "@/lib/ai/provider";
import { cleanText, extractText, UnsupportedFileError, type ExtractedInput } from "@/lib/parse/extractText";
import { CourseContextSchema, type ExtractResponse } from "@/lib/schema";
import { buildEvents } from "@/lib/validate";

// Room to fall back through several free providers.
export const maxDuration = 120;

const MAX_FILE_BYTES = 4 * 1024 * 1024; // stays under Vercel's 4.5 MB request limit

// Best-effort in-memory cache so re-uploading the same syllabus doesn't burn free-tier quota.
// (Per server instance; resets on cold start. Syllabi themselves are never stored.)
const CACHE_MAX = 100;
const cache = new Map<string, { raw: unknown; provider: string }>();

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected multipart form data." }, 400);
  }

  // Course name and term dates come from the syllabus itself; the browser only sends its timezone.
  const ctxParse = CourseContextSchema.safeParse({ timezone: form.get("timezone") || undefined });
  if (!ctxParse.success) return json({ error: "Invalid timezone." }, 400);
  const ctx = ctxParse.data;

  let input: ExtractedInput;
  const file = form.get("file");
  const pasted = form.get("text");
  try {
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) return json({ error: "File is too large (max 4 MB)." }, 413);
      input = await extractText(file);
    } else if (typeof pasted === "string" && pasted.trim()) {
      input = { kind: "text", format: "text", text: cleanText(pasted) };
    } else {
      return json({ error: "Upload a syllabus file or paste its text." }, 400);
    }
  } catch (err) {
    if (err instanceof UnsupportedFileError) return json({ error: err.message }, 415);
    console.error("Text extraction failed", err);
    return json({ error: "Couldn't read that file. Try another format or paste the text." }, 422);
  }

  try {
    const providers = await getProviders();
    const key = createHash("sha256")
      .update(JSON.stringify(ctx))
      .update(input.kind === "file" ? input.data : input.text)
      .digest("hex");

    let hit = cache.get(key);
    const cached = hit !== undefined;
    if (!hit) {
      const result = await extractWithFallback(
        providers,
        input.kind === "file"
          ? { context: ctx, file: { mime: input.mime, data: input.data } }
          : { context: ctx, text: input.text },
      );
      hit = { raw: result.raw, provider: result.provider };
      cache.set(key, hit);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    const { raw, provider } = hit;

    const result = buildEvents(raw, input.kind === "file" ? "" : input.text, ctx);
    if (input.kind === "file") {
      result.warnings.unshift(
        input.format === "image"
          ? "The AI read your photo directly, so quotes couldn't be checked against the text. Review every date carefully."
          : "This PDF looks scanned (no selectable text), so the AI read the image directly and quotes couldn't be checked. Review every date carefully.",
      );
    }
    if (result.events.length === 0) result.warnings.push("No dated items were found.");

    const sourceText = input.kind === "file" ? "" : input.text;
    const body: ExtractResponse = { ...result, sourceText, model: provider, cached };
    return json(body);
  } catch (err) {
    if (err instanceof NoProvidersError) return json({ error: err.message }, 500);
    if (err instanceof AllProvidersFailedError) {
      console.error(err.message);
      const details = summarizeAttempts(err.attempts);
      if (err.neededFiles) {
        const error =
          "Scans and photos can only be read by Gemini, which is busy right now. Try again in a few minutes, or upload a PDF or Word file with selectable text.";
        return json({ error, details }, 429);
      }
      return err.temporary
        ? json({ error: "All of our free AI services are busy right now. Please try again in a minute.", details }, 429)
        : json({ error: "We couldn't read this syllabus. Try pasting the text instead.", details }, 502);
    }
    console.error("Extraction failed", err);
    return json({ error: "Something went wrong reading the syllabus. Please try again." }, 502);
  }
}
