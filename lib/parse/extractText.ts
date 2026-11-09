import { detectFormat, imageMime, unsupportedHint, type SourceFormat } from "../formats";
import { htmlToText } from "./html";

export type ExtractedInput =
  | { kind: "text"; format: SourceFormat; text: string }
  /** Something with no usable text layer (scanned PDF, photo). A multimodal model reads it directly. */
  | { kind: "file"; format: SourceFormat; mime: string; data: Uint8Array; text: string };

/** Below this many characters we treat a PDF as scanned / image-only. */
const MIN_PDF_TEXT = 200;
const MAX_TEXT_CHARS = 200_000;

export class UnsupportedFileError extends Error {}

export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/** Minimal RTF → text: good enough for syllabi (paragraphs, tabs, escaped characters). */
export function rtfToText(rtf: string): string {
  return rtf
    .replace(/\{\\\*[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, "") // ignorable destinations like {\*\generator ...}
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info)[^]*?\}\s*\}/g, "")
    .replace(/\\par[d]?\b ?|\\line\b ?/g, "\n")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/\\([{}\\])/g, "$1")
    .replace(/[{}]/g, "");
}

export async function extractText(file: File): Promise<ExtractedInput> {
  const format = detectFormat(file.name, file.type);
  if (!format) throw new UnsupportedFileError(unsupportedHint(file.name));
  const buf = new Uint8Array(await file.arrayBuffer());
  const decode = () => new TextDecoder().decode(buf);

  switch (format) {
    case "pdf": {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      // unpdf may detach the buffer, so hand it a copy and keep the original for the fallback.
      const pdf = await getDocumentProxy(buf.slice());
      const { text } = await pdfText(pdf, { mergePages: false });
      const joined = cleanText(text.map((page, i) => `--- Page ${i + 1} ---\n${page}`).join("\n\n"));
      const realChars = joined.replace(/--- Page \d+ ---/g, "").replace(/\s/g, "").length;
      if (realChars < MIN_PDF_TEXT) return { kind: "file", format, mime: "application/pdf", data: buf, text: joined };
      return { kind: "text", format, text: joined };
    }
    // DOCX and Markdown go through the same HTML the preview renders, so both read them identically.
    case "docx": {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(buf) });
      return { kind: "text", format, text: cleanText(htmlToText(value)) };
    }
    case "html":
      return { kind: "text", format, text: cleanText(htmlToText(decode())) };
    case "rtf":
      return { kind: "text", format, text: cleanText(rtfToText(decode())) };
    case "markdown": {
      const { marked } = await import("marked");
      return { kind: "text", format, text: cleanText(htmlToText(await marked.parse(decode()))) };
    }
    case "text":
      return { kind: "text", format, text: cleanText(decode()) };
    case "image":
      return { kind: "file", format, mime: imageMime(file.name, file.type), data: buf, text: "" };
  }
}
