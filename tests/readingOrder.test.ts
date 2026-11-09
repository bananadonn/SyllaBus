// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { collectDomSegments } from "@/lib/domText";
import { normalizeForMatch, TextIndex } from "@/lib/locate";
import { htmlToText } from "@/lib/parse/html";

/** A schedule table like real syllabi: several paragraphs per cell, date and item in different cells. */
const SCHEDULE = `<!doctype html><html><head><title>CSCI 379</title><style>td{padding:4px}</style></head><body>
<h1>CSCI 379: Computer Networking</h1>
<table class="t"><tr><td><p>COURSE</p></td><td>CSCI 379</td><td>TERM</td><td><p>Aug 28 – Dec 14, 2026</p><p>First class: Mon Aug 31</p></td></tr></table>
<h2>Schedule</h2>
<table class="sched"><thead><tr><th>Week / meetings</th><th>Topics and deliverables</th><th>Chapters</th></tr></thead>
<tbody>
<tr><td><p>2</p><p>Sep 9</p></td><td><p>Principles of network applications.</p></td><td><p>Ch 2</p><p>§2.1</p></td></tr>
<tr><td><p>3</p><p>Sep 14, 16</p></td><td><p>The Web and HTTP. Caching and the conditional GET.</p><p><strong>Wireshark Lab 1: HTTP</strong></p></td><td><p>Ch 2</p><p>§2.2</p></td></tr>
<tr><td><p>7</p><p>Oct 13, 14</p></td><td><p>Consolidation.</p><p>Midterm 1 on Wed Oct 14, covering<br>Chapters 1 and 2.</p></td><td>—</td></tr>
</tbody></table>
<ul><li>Labor Day, <em>September 7</em>: no class.</li><li>Final exam: Dec 21</li></ul>
<script>document.title = "x"</script>
</body></html>`;

function domText(html: string) {
  document.open();
  document.write(html);
  document.close();
  return collectDomSegments(document.body);
}

describe("htmlToText reading order", () => {
  const text = htmlToText(SCHEDULE);

  it("keeps each table row on one line, cells and paragraphs in page order", () => {
    expect(text).toContain("3 / Sep 14, 16 | The Web and HTTP. Caching and the conditional GET. / Wireshark Lab 1: HTTP | Ch 2 / §2.2");
    // The old column layout produced this phrase, which doesn't exist in the document:
    expect(normalizeForMatch(text)).not.toContain(normalizeForMatch("Sep 14, 16 Wireshark Lab 1: HTTP"));
  });

  it("drops scripts, styles and the <head>", () => {
    expect(text).not.toMatch(/document\.title|padding|CSCI 379<\/title>/);
    expect(text.startsWith("CSCI 379: Computer Networking")).toBe(true);
  });
});

describe("server text and preview agree", () => {
  it("produce the same words in the same order", () => {
    const server = normalizeForMatch(htmlToText(SCHEDULE));
    const preview = normalizeForMatch(domText(SCHEDULE).segs.join(" "));
    expect(preview).toBe(server);
  });

  it("every quote the server accepts can be highlighted in the preview", () => {
    const serverText = htmlToText(SCHEDULE);
    const { segs } = domText(SCHEDULE);
    const preview = new TextIndex(segs);
    // Every line, every cell, and every run of 2-6 words from the server text must be findable.
    const spans = new Set<string>();
    for (const line of serverText.split("\n")) {
      spans.add(line);
      for (const cell of line.split(" | ")) spans.add(cell);
      const words = line.split(/\s+/);
      for (let n = 2; n <= 6; n++) for (let i = 0; i + n <= words.length; i++) spans.add(words.slice(i, i + n).join(" "));
    }
    const missing = [...spans].filter((s) => normalizeForMatch(s) && !preview.find(s));
    expect(missing).toEqual([]);
  });

  it("finds the item and its date cell separately", () => {
    const preview = new TextIndex(domText(SCHEDULE).segs);
    expect(preview.find("Wireshark Lab 1: HTTP")).not.toBeNull();
    expect(preview.find("Sep 14, 16")).not.toBeNull();
  });
});
