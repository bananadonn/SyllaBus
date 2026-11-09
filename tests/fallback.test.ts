import { beforeEach, describe, expect, it, vi } from "vitest";
import { AllProvidersFailedError, extractWithFallback, NoProvidersError, resetCooldowns, summarizeAttempts } from "@/lib/ai/fallback";
import { getProviders, kindForStatus, type LLMProvider, parseModelJson, ProviderError, type ProviderErrorKind } from "@/lib/ai/provider";

const noSleep = async () => {};
const GOOD = { course: { name: "CS 101", termStart: null, termEnd: null }, events: [] };
const input = { context: { courseName: "", termStart: "", termEnd: "", timezone: "UTC" }, text: "syllabus" };

function fake(id: string, behavior: "ok" | ProviderErrorKind | "wrong_shape" | "hang", supportsFiles = true) {
  const p: LLMProvider & { calls: number } = {
    id,
    supportsFiles,
    calls: 0,
    async extract({ signal }) {
      p.calls++;
      if (behavior === "ok") return GOOD;
      if (behavior === "wrong_shape") return { nope: true };
      if (behavior === "hang") {
        return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      }
      throw new ProviderError(`${id} failed`, behavior);
    },
  };
  return p;
}

beforeEach(() => {
  resetCooldowns();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("extractWithFallback", () => {
  it("uses the first provider when it works", async () => {
    const a = fake("a", "ok");
    const b = fake("b", "ok");
    const r = await extractWithFallback([a, b], input);
    expect(r.provider).toBe("a");
    expect(b.calls).toBe(0);
  });

  it("falls through rate limits, outages and bad output to the next provider", async () => {
    const r = await extractWithFallback(
      [fake("a", "rate_limit"), fake("b", "unavailable"), fake("c", "wrong_shape"), fake("d", "bad_output"), fake("e", "ok")],
      input,
    );
    expect(r.provider).toBe("e");
    expect(r.attempts.map((x) => x.kind ?? "ok")).toEqual(["rate_limit", "unavailable", "bad_output", "bad_output", "ok"]);
  });

  it("skips a rate-limited provider on the next request (cooldown)", async () => {
    const a = fake("a", "rate_limit");
    const b = fake("b", "ok");
    await extractWithFallback([a, b], input);
    await extractWithFallback([a, b], input);
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(2);
  });

  it("still tries cooling-down providers when nothing else is left", async () => {
    let t = 0;
    const now = () => t;
    const a = fake("a", "rate_limit");
    await expect(extractWithFallback([a], input, { now, sleep: noSleep })).rejects.toBeInstanceOf(AllProvidersFailedError);
    t = 1000; // still cooling down
    await expect(extractWithFallback([a], input, { now, sleep: noSleep })).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(a.calls).toBe(4); // each request: first try + one retry after the short wait
  });

  it("times out a hanging provider and moves on", async () => {
    const r = await extractWithFallback([fake("slow", "hang"), fake("b", "ok")], input, { perAttemptTimeoutMs: 20 });
    expect(r.provider).toBe("b");
    expect(r.attempts[0].kind).toBe("unavailable");
  });

  it("reports whether the failure is temporary", async () => {
    const busy = await extractWithFallback([fake("a", "rate_limit")], input, { sleep: noSleep }).catch((e) => e);
    expect(busy).toBeInstanceOf(AllProvidersFailedError);
    expect(busy.temporary).toBe(true);
    const broken = await extractWithFallback([fake("b", "bad_output")], input).catch((e) => e);
    expect(broken.temporary).toBe(false);
  });

  it("only uses file-capable providers for scans and photos", async () => {
    const textOnly = fake("groq", "ok", false);
    const gem = fake("gemini", "ok", true);
    const r = await extractWithFallback([textOnly, gem], { context: input.context, file: { mime: "image/png", data: new Uint8Array([1]) } });
    expect(r.provider).toBe("gemini");
    expect(textOnly.calls).toBe(0);
    await expect(
      extractWithFallback([textOnly], { context: input.context, file: { mime: "image/png", data: new Uint8Array([1]) } }),
    ).rejects.toBeInstanceOf(NoProvidersError);
  });

  it("errors clearly when nothing is configured", async () => {
    await expect(extractWithFallback([], input)).rejects.toBeInstanceOf(NoProvidersError);
  });
});

describe("provider helpers", () => {
  it("builds the provider chain from env, in order, skipping missing keys", async () => {
    const ids = (await getProviders({ GEMINI_API_KEY: "x", OPENROUTER_API_KEY: "y" })).map((p) => p.id);
    expect(ids).toEqual(["gemini:gemini-flash-latest", "gemini:gemini-flash-lite-latest", "openrouter:openrouter/free"]);

    const custom = await getProviders({
      AI_PROVIDER_ORDER: "groq,gemini",
      GEMINI_API_KEY: "x",
      GEMINI_MODELS: "m1",
      GROQ_API_KEY: "z",
      GROQ_MODELS: "g1, g2",
    });
    expect(custom.map((p) => p.id)).toEqual(["groq:g1", "groq:g2", "gemini:m1"]);
  });

  it("classifies HTTP statuses", () => {
    expect(kindForStatus(429)).toBe("rate_limit");
    expect(kindForStatus(429, "Request too large: tokens per minute limit")).toBe("too_large");
    expect(kindForStatus(413)).toBe("too_large");
    expect(kindForStatus(503)).toBe("unavailable");
    expect(kindForStatus(401)).toBe("config");
  });

  it("parses JSON wrapped in fences or chatter", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('Here you go: {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => parseModelJson("nope")).toThrow(ProviderError);
  });
});

describe("busy handling", () => {
  it("waits out a short rate limit and retries once before giving up", async () => {
    let calls = 0;
    const flaky: LLMProvider = {
      id: "groq:a",
      supportsFiles: false,
      async extract() {
        if (++calls === 1) throw new ProviderError("429", "rate_limit", 3);
        return GOOD;
      },
    };
    const waits: number[] = [];
    let t = 0;
    const r = await extractWithFallback([fake("gemini:x", "unavailable"), flaky], input, {
      now: () => t,
      sleep: async (ms) => {
        waits.push(ms);
        t += ms;
      },
    });
    expect(r.provider).toBe("groq:a");
    expect(waits).toEqual([3000]);
  });

  it("doesn't wait for long rate limits", async () => {
    const sleep = vi.fn(async () => {});
    const slow: LLMProvider = {
      id: "groq:b",
      supportsFiles: false,
      async extract() {
        throw new ProviderError("429", "rate_limit", 3600);
      },
    };
    await expect(extractWithFallback([slow], input, { sleep })).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("summarizes why each service failed and flags scans", async () => {
    const err = await extractWithFallback(
      [fake("gemini:a", "unavailable"), fake("gemini:b", "unavailable"), fake("groq:c", "rate_limit", false)],
      { context: input.context, file: { mime: "application/pdf", data: new Uint8Array([1]) } },
      { sleep: async () => {} },
    ).catch((e) => e);
    expect(err.neededFiles).toBe(true);
    expect(summarizeAttempts(err.attempts)).toBe("Gemini: overloaded or down");

    resetCooldowns();
    const err2 = await extractWithFallback([fake("gemini:a", "unavailable"), fake("groq:c", "config")], input).catch(
      (e) => e,
    );
    expect(summarizeAttempts(err2.attempts)).toBe("Gemini: overloaded or down · Groq: key or model problem");
  });

  it("strips <think> blocks from reasoning models", () => {
    expect(parseModelJson('<think>maybe {"x":0}?</think>\n{"events":[]}')).toEqual({ events: [] });
  });
});
