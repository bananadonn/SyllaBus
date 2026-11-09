import { z } from "zod";
import { type LLMProvider, type ProviderErrorKind, type ProviderInput, ProviderError } from "./provider";

interface Attempt {
  provider: string;
  ok: boolean;
  kind?: ProviderErrorKind;
  ms: number;
  retryAfterSec?: number;
  message?: string;
}

export class AllProvidersFailedError extends Error {
  constructor(
    readonly attempts: Attempt[],
    /** True if at least one failure was a rate limit / outage, i.e. trying again later should help. */
    readonly temporary: boolean,
    /** True if the input was a scan/photo, which only file-capable providers (Gemini) can read. */
    readonly neededFiles = false,
  ) {
    super(`All AI providers failed: ${attempts.map((a) => `${a.provider}=${a.kind}`).join(", ")}`);
  }
}

export class NoProvidersError extends Error {}

interface FallbackOptions {
  /** Max time for one provider before we give up on it. */
  perAttemptTimeoutMs?: number;
  /** Stop starting new attempts after this much total time. */
  totalBudgetMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** A usable reply must at least contain an "events" array (course info is optional). */
const ReplyShape = z.object({ events: z.array(z.unknown()) });

/** How long to skip a provider after a failure (ms). Per-input problems get no cooldown. */
const COOLDOWN_MS: Partial<Record<ProviderErrorKind, number>> = {
  rate_limit: 60_000,
  // An overloaded model can take ~30 s just to say so; skip it for a while.
  unavailable: 120_000,
  config: 10 * 60_000,
};
const MAX_COOLDOWN_MS = 10 * 60_000;

/** Shared across requests on this server instance so busy providers are skipped right away. */
const cooldownUntil = new Map<string, number>();

export function resetCooldowns() {
  cooldownUntil.clear();
}

/** Longest provider-requested wait we'll sit through for a second try within one request. */
const MAX_RETRY_WAIT_MS = 20_000;

/**
 * Tries each provider in order and returns the first valid result.
 * Providers that recently failed are skipped (tried last only if everything else is cooling down).
 * If every provider failed, the ones that hit a short rate limit are retried once after waiting.
 */
export async function extractWithFallback(
  providers: LLMProvider[],
  input: Omit<ProviderInput, "signal">,
  opts: FallbackOptions = {},
): Promise<{ raw: unknown; provider: string; attempts: Attempt[] }> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const perAttempt = opts.perAttemptTimeoutMs ?? 45_000;
  const budget = opts.totalBudgetMs ?? 100_000;
  const started = now();
  const needsFiles = !!input.file && !input.text;

  const eligible = providers.filter((p) => p.supportsFiles || !needsFiles);
  if (!eligible.length) {
    throw new NoProvidersError(
      providers.length
        ? "No configured AI provider can read scans or photos. Add GEMINI_API_KEY."
        : "No AI provider is configured. Set GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY in .env.local.",
    );
  }

  const attempts: Attempt[] = [];
  const failedAt = new Map<string, number>();
  const tryOne = async (p: LLMProvider): Promise<unknown | undefined> => {
    const begin = now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), perAttempt);
    try {
      const raw = await p.extract({ ...input, signal: ctrl.signal });
      if (!ReplyShape.safeParse(raw).success) {
        throw new ProviderError(`${p.id} returned JSON in the wrong shape`, "bad_output");
      }
      cooldownUntil.delete(p.id);
      attempts.push({ provider: p.id, ok: true, ms: now() - begin });
      return raw;
    } catch (err) {
      const e =
        err instanceof ProviderError
          ? err
          : new ProviderError(err instanceof Error ? err.message : String(err), ctrl.signal.aborted ? "unavailable" : "other");
      attempts.push({
        provider: p.id,
        ok: false,
        kind: e.kind,
        ms: now() - begin,
        retryAfterSec: e.retryAfterSec,
        message: e.message.slice(0, 300),
      });
      failedAt.set(p.id, now());
      const base = COOLDOWN_MS[e.kind];
      if (base) {
        const wait = Math.min(Math.max(base, (e.retryAfterSec ?? 0) * 1000), MAX_COOLDOWN_MS);
        cooldownUntil.set(p.id, now() + wait);
      }
      console.warn(`[ai] ${p.id} failed (${e.kind}): ${e.message.slice(0, 200)}`);
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  };

  // Pass 1: everything, providers not cooling down first.
  const t = now();
  const ready = eligible.filter((p) => (cooldownUntil.get(p.id) ?? 0) <= t);
  const cooling = eligible
    .filter((p) => (cooldownUntil.get(p.id) ?? 0) > t)
    .sort((a, b) => cooldownUntil.get(a.id)! - cooldownUntil.get(b.id)!);
  for (const p of [...ready, ...cooling]) {
    if (attempts.length && now() - started > budget) break;
    const raw = await tryOne(p);
    if (raw !== undefined) return { raw, provider: p.id, attempts };
  }

  // Pass 2: per-minute limits reset quickly, so wait out the shortest ones and try those again.
  const retryable = eligible
    .map((p) => ({ p, a: attempts.findLast((a) => a.provider === p.id) }))
    .filter(({ a }) => a?.kind === "rate_limit")
    .map(({ p, a }) => ({ p, readyAt: failedAt.get(p.id)! + (a!.retryAfterSec ?? 5) * 1000 }))
    .filter(({ p, readyAt }) => readyAt - failedAt.get(p.id)! <= MAX_RETRY_WAIT_MS)
    .sort((x, y) => x.readyAt - y.readyAt);
  for (const { p, readyAt } of retryable) {
    if (readyAt - started > budget) break;
    const wait = Math.max(0, readyAt - now());
    console.warn(`[ai] all providers busy; retrying ${p.id} in ${Math.round(wait / 1000)}s`);
    if (wait > 0) await sleep(wait);
    const raw = await tryOne(p);
    if (raw !== undefined) return { raw, provider: p.id, attempts };
  }

  const temporary = attempts.some((a) => a.kind === "rate_limit" || a.kind === "unavailable");
  throw new AllProvidersFailedError(attempts, temporary, needsFiles);
}

const PROVIDER_LABEL: Record<string, string> = { gemini: "Gemini", groq: "Groq", openrouter: "OpenRouter" };
const KIND_LABEL: Record<string, string> = {
  rate_limit: "free limit reached",
  unavailable: "overloaded or down",
  config: "key or model problem",
  too_large: "syllabus too long",
  bad_output: "unreadable answer",
  unsupported: "can't read this file type",
  other: "error",
};

/** One short phrase per provider, e.g. "Gemini: overloaded or down · Groq: free limit reached". */
export function summarizeAttempts(attempts: Attempt[]): string {
  const byFamily = new Map<string, Set<string>>();
  for (const a of attempts) {
    if (a.ok || !a.kind) continue;
    const fam = a.provider.split(":")[0];
    const label = PROVIDER_LABEL[fam] ?? fam;
    byFamily.set(label, (byFamily.get(label) ?? new Set()).add(KIND_LABEL[a.kind] ?? a.kind));
  }
  return [...byFamily].map(([fam, kinds]) => `${fam}: ${[...kinds].join(", ")}`).join(" · ");
}
