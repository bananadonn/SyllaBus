/** File formats we accept. Shared by the server (text extraction) and the browser (preview). */
export type SourceFormat = "pdf" | "docx" | "html" | "markdown" | "rtf" | "text" | "image";

const EXT: Record<string, SourceFormat> = {
  pdf: "pdf",
  docx: "docx",
  html: "html",
  htm: "html",
  xhtml: "html",
  md: "markdown",
  markdown: "markdown",
  rtf: "rtf",
  txt: "text",
  text: "text",
  csv: "text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  heic: "image",
  heif: "image",
};

const MIME: Record<string, SourceFormat> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "text/plain": "text",
  "text/csv": "text",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/heic": "image",
  "image/heif": "image",
};

/** Formats people often try that we can't read; we tell them how to convert instead. */
const UNSUPPORTED_HINT: Record<string, string> = {
  doc: "Old .doc files aren't supported. In Word, use File → Save As → .docx or PDF.",
  odt: "OpenDocument files aren't supported. Export it as PDF or .docx.",
  pages: "Pages files aren't supported. In Pages, use File → Export To → PDF.",
  pptx: "Slides aren't supported. Export the presentation as PDF.",
  ppt: "Slides aren't supported. Export the presentation as PDF.",
  xlsx: "Spreadsheets aren't supported. Export as PDF or CSV.",
  xls: "Spreadsheets aren't supported. Export as PDF or CSV.",
};

export const ACCEPT_ATTR = [
  ...Object.keys(EXT).map((e) => `.${e}`),
  ...Object.keys(MIME),
].join(",");

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";

export function detectFormat(name: string, mime: string): SourceFormat | null {
  return EXT[ext(name)] ?? MIME[mime.toLowerCase().split(";")[0]] ?? (mime.startsWith("text/") ? "text" : null);
}

export function unsupportedHint(name: string): string {
  return UNSUPPORTED_HINT[ext(name)] ?? "Upload a PDF, Word (.docx), web page (.html), image, or text file.";
}

export function imageMime(name: string, mime: string): string {
  return mime.startsWith("image/") ? mime : (IMAGE_MIME_BY_EXT[ext(name)] ?? "image/png");
}
