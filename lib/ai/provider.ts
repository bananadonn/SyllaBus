import type { CourseContext } from "../schema";

export interface ProviderInput {
  context: CourseContext;
  /** Plain syllabus text, when we could extract it. */
  text?: string;
  /** A file with no text layer (scanned PDF, photo) for multimodal models to read directly. */
  file?: { mime: string; data: Uint8Array };
  /** Aborts the request (used for per-provider timeouts). */
  signal?: AbortSignal;
}

export interface LLMProvider {
  /** Unique id, e.g. "groq:llama-3.3-70b-versatile". Used for logging and cooldowns. */
  readonly id: string;
  /** Whether the provider can read PDFs/images directly (needed for scans and photos). */
  readonly supportsFiles: boolean;
  /** Returns the model's raw (unvalidated) JSON. Throws ProviderError on failure. */
  extract(input: ProviderInput): Promise<unknown>;
}

export type ProviderErrorKind =
  | "rate_limit" // 429 / quota exhausted
  | "unavailable" // 5xx, overloaded, timeout, network
  | "config" // bad/missing key, model not found
  | "too_large" // input over this provider's limits
  | "bad_output" // malformed JSON
  | "unsupported" // e.g. an image on a text-only provider
  | "other";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    /** Seconds the provider asked us to wait, if it said. */
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

/** Maps an HTTP status from any provider to an error kind. */
export function kindForStatus(status: number, body = ""): ProviderErrorKind {
  if (status === 429) return /too large|context length|maximum context|tokens per/i.test(body) ? "too_large" : "rate_limit";
  if (status === 413) return "too_large";
  if (status === 401 || status === 403 || status === 404) return "config";
  if (status === 408 || status >= 500) return "unavailable";
  if (status === 400 && /context|too long|too large|maximum/i.test(body)) return "too_large";
  return "other";
}

/** Parses JSON from a model reply, tolerating ```json fences or text around the object. */
export function parseModelJson(raw: string): unknown {
  const trimmed = raw
    .replace(/<think>[^]*?<\/think>/gi, "") // reasoning models (e.g. Qwen) may think out loud first
    .trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new ProviderError("Model returned malformed JSON", "bad_output");
  }
}

const list = (v: string | undefined, fallback: string[]) =>
  v ? v.split(",").map((s) => s.trim()).filter(Boolean) : fallback;

/**
 * Every configured free provider/model, in the order we try them.
 * A provider is included only if its API key is set. Order: AI_PROVIDER_ORDER (default gemini,groq,openrouter).
 * Each model has its own free quota, so listing several models per provider adds capacity.
 */
export async function getProviders(env: Record<string, string | undefined> = process.env): Promise<LLMProvider[]> {
  const order = list(env.AI_PROVIDER_ORDER, ["gemini", "groq", "openrouter"]);
  const out: LLMProvider[] = [];

  for (const name of order) {
    if (name === "gemini" && env.GEMINI_API_KEY) {
      const { GeminiProvider } = await import("./gemini");
      const models = list(env.GEMINI_MODELS ?? env.GEMINI_MODEL, ["gemini-flash-latest", "gemini-flash-lite-latest"]);
      for (const m of models) out.push(new GeminiProvider(env.GEMINI_API_KEY, m));
    }
    if (name === "groq" && env.GROQ_API_KEY) {
      const { OpenAICompatProvider } = await import("./openaiCompat");
      // Each model has its own free per-minute quota on Groq.
      const models = list(env.GROQ_MODELS, ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]);
      for (const m of models) {
        out.push(
          new OpenAICompatProvider({ name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: env.GROQ_API_KEY, model: m }),
        );
      }
    }
    if (name === "openrouter" && env.OPENROUTER_API_KEY) {
      const { OpenAICompatProvider } = await import("./openaiCompat");
      const models = list(env.OPENROUTER_MODELS, ["openrouter/free"]);
      for (const m of models) {
        out.push(
          new OpenAICompatProvider({
            name: "openrouter",
            baseUrl: "https://openrouter.ai/api/v1",
            apiKey: env.OPENROUTER_API_KEY,
            model: m,
            headers: { "X-Title": "SyllaBus" },
          }),
        );
      }
    }
  }
  return out;
}
