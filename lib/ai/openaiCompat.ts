import { buildSystemPrompt, buildUserPrompt, EXTRACTION_JSON_SCHEMA } from "./prompt";
import { kindForStatus, type LLMProvider, parseModelJson, type ProviderInput, ProviderError } from "./provider";

interface Options {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
}

/** Any OpenAI-compatible chat API (Groq, OpenRouter, ...). Text input only. */
export class OpenAICompatProvider implements LLMProvider {
  readonly id: string;
  readonly supportsFiles = false;

  constructor(private opts: Options) {
    this.id = `${opts.name}:${opts.model}`;
  }

  async extract({ context, text, signal }: ProviderInput): Promise<unknown> {
    if (!text) throw new ProviderError(`${this.id} can't read scans or images`, "unsupported");

    const system = `${buildSystemPrompt()}

Respond with ONLY a JSON object (no markdown, no commentary) that matches this JSON Schema:
${JSON.stringify(EXTRACTION_JSON_SCHEMA)}`;

    const send = async (jsonMode: boolean): Promise<Response> => {
      try {
        return await fetch(`${this.opts.baseUrl}/chat/completions`, {
          method: "POST",
          signal,
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            "Content-Type": "application/json",
            ...this.opts.headers,
          },
          body: JSON.stringify({
            model: this.opts.model,
            temperature: 0,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
            // gpt-oss "thinks" first; at default effort it can spend its whole answer budget on that
            // and return nothing. Extraction doesn't need deep reasoning.
            ...(/gpt-oss/.test(this.opts.model) ? { reasoning_effort: "low" } : {}),
            messages: [
              { role: "system", content: system },
              { role: "user", content: buildUserPrompt(context, text) },
            ],
          }),
        });
      } catch (err) {
        if (signal?.aborted) throw new ProviderError(`${this.id} timed out`, "unavailable");
        throw new ProviderError(`${this.id} network error: ${String(err).slice(0, 200)}`, "unavailable");
      }
    };

    let res = await send(true);
    let body = "";
    // Some models (e.g. gpt-oss on Groq) intermittently fail the provider's strict JSON-mode check.
    // Retry once without JSON mode; parseModelJson digs the object out of the plain reply.
    if (res.status === 400) {
      body = await res.text().catch(() => "");
      if (/json_validate_failed|response_format|json mode/i.test(body)) {
        console.warn(`[ai] ${this.id} failed JSON mode; retrying without it`);
        res = await send(false);
        body = "";
      }
    }

    if (!res.ok) {
      body ||= await res.text().catch(() => "");
      const retry = Number(res.headers.get("retry-after"));
      throw new ProviderError(
        `${this.id} ${res.status}: ${body.slice(0, 200)}`,
        kindForStatus(res.status, body),
        Number.isFinite(retry) && retry > 0 ? retry : undefined,
      );
    }

    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string; code?: number };
    } | null;
    // OpenRouter can return 200 with an error object when the upstream model fails.
    if (data?.error) {
      const code = data.error.code ?? 502;
      throw new ProviderError(`${this.id} ${code}: ${data.error.message ?? ""}`, kindForStatus(code, data.error.message));
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError(`${this.id} returned an empty reply`, "bad_output");
    return parseModelJson(content);
  }
}
