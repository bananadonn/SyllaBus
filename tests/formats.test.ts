import { describe, expect, it } from "vitest";
import { detectFormat, unsupportedHint } from "@/lib/formats";
import { extractText, rtfToText, UnsupportedFileError } from "@/lib/parse/extractText";
import { htmlToText } from "@/lib/parse/html";
import { normalizeForMatch, quoteFoundInText } from "@/lib/locate";

describe("detectFormat", () => {
  it("recognizes formats by extension or MIME type", () => {
    expect(detectFormat("Syllabus.HTM", "")).toBe("html");
    expect(detectFormat("notes", "text/markdown")).toBe("markdown");
    expect(detectFormat("photo.JPG", "")).toBe("image");
    expect(detectFormat("s.docx", "")).toBe("docx");
    expect(detectFormat("s.doc", "application/msword")).toBeNull();
    expect(unsupportedHint("s.doc")).toMatch(/Save As/);
  });
});

describe("HTML → text", () => {
  const html = `<html><head><style>.x{color:red}</style><script>alert(1)</script></head><body>
    <h1>CS 101 Syllabus</h1>
    <p>Classes begin <b>Monday, August 24</b>.<br>See <a href="https://example.com/cal">the calendar</a>.</p>
    <table><tr><th>Week</th><th>Due</th></tr><tr><td>8</td><td>Midterm Exam – October 14</td></tr></table>
  </body></html>`;

  it("drops tags, scripts, styles and link URLs but keeps the words", async () => {
    const text = htmlToText(html);
    expect(text).not.toMatch(/<|alert|color:red|example\.com/);
    expect(text).toContain("CS 101 Syllabus"); // headings keep their case
    const norm = normalizeForMatch(text);
    expect(quoteFoundInText("Classes begin Monday, August 24", norm)).toBe(true);
    expect(quoteFoundInText("8 Midterm Exam – October 14", norm)).toBe(true);
  });

  it("is used for uploaded .html files", async () => {
    const r = await extractText(new File([html], "syllabus.html", { type: "text/html" }));
    expect(r).toMatchObject({ kind: "text", format: "html" });
    expect(r.text).not.toContain("<p>");
  });
});

describe("RTF → text", () => {
  it("strips control words and keeps paragraphs and escaped characters", () => {
    const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}{\*\generator Word;}\f0\fs24 Midterm Exam \'96 October 14\par Final: Dec 15\par}`;
    const text = rtfToText(rtf);
    expect(text).toContain("Midterm Exam");
    expect(text).toContain("October 14");
    expect(text).toContain("Final: Dec 15");
    expect(text).not.toMatch(/\\|fonttbl|generator/);
  });
});

describe("unsupported files", () => {
  it("explains how to convert", async () => {
    await expect(extractText(new File(["x"], "syllabus.pages"))).rejects.toBeInstanceOf(UnsupportedFileError);
  });

  it("sends photos to the AI as files", async () => {
    const r = await extractText(new File([new Uint8Array([1, 2])], "IMG_1.jpg"));
    expect(r).toMatchObject({ kind: "file", format: "image", mime: "image/jpeg" });
  });
});
