import { ApiError, GoogleGenAI } from "@google/genai";
import { buildSystemPrompt, buildUserPrompt, EXTRACTION_JSON_SCHEMA } from "./prompt";
import { kindForStatus, type LLMProvider, parseModelJson, type ProviderInput, ProviderError } from "./provider";

export class GeminiProvider implements LLMProvider {
  readonly id: string;
  readonly supportsFiles = true;
  private client: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.id = `gemini:${model}`;
    // No SDK retries: on a 429 we'd rather move straight to the next free provider than wait.
    this.client = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
  }

  async extract({ context, text, file, signal }: ProviderInput): Promise<unknown> {
    const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [];
    if (file && !text) {
      parts.push({ inlineData: { mimeType: file.mime, data: Buffer.from(file.data).toString("base64") } });
    }
    parts.push({ text: buildUserPrompt(context, text) });

    let raw: string;
    try {
      const res = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: buildSystemPrompt(),
          responseMimeType: "application/json",
          responseJsonSchema: EXTRACTION_JSON_SCHEMA,
          temperature: 0,
          abortSignal: signal,
        },
      });
      raw = res.text ?? "";
    } catch (err) {
      if (err instanceof ApiError) {
        const retry = /retry in ([\d.]+)s/i.exec(err.message)?.[1];
        throw new ProviderError(
          `Gemini ${err.status}: ${err.message.slice(0, 200)}`,
          kindForStatus(err.status, err.message),
          retry ? Math.ceil(Number(retry)) : undefined,
        );
      }
      if (signal?.aborted) throw new ProviderError("Gemini timed out", "unavailable");
      throw new ProviderError(`Gemini request failed: ${String(err).slice(0, 200)}`, "unavailable");
    }
    return parseModelJson(raw);
  }
}
