import { describe, expect, it } from "vitest";
import { TextIndex } from "@/lib/locate";

describe("TextIndex", () => {
  it("finds a quote in plain text despite punctuation/whitespace/case differences", () => {
    const text = "Schedule\nMidterm Exam –  Wednesday, October 14, in class\nFinal";
    const span = new TextIndex([text]).find("midterm exam - wednesday, october 14");
    expect(span).not.toBeNull();
    expect(text.slice(span!.start.off, span!.end.off)).toBe("Midterm Exam –  Wednesday, October 14");
  });

  it("finds quotes spanning several PDF text items (joined with no separator)", () => {
    // pdf.js often splits a line into pieces, sometimes mid-word.
    const items = ["8 | Oct 12 | Review | Mid", "term Exam – Oct", "ober 14\n", "Next line\n"];
    const span = new TextIndex(items).find("Midterm Exam – October 14");
    expect(span).toEqual({ start: { seg: 0, off: 22 }, end: { seg: 2, off: 7 } }); // "Mid" … "ober 14"
  });

  it("prefers a whole-word match over a partial one", () => {
    const text = "HW 10 due Nov 20. HW 1 due Sep 4.";
    const span = new TextIndex([text]).find("HW 1");
    expect(text.slice(span!.start.off, span!.end.off)).toBe("HW 1");
    expect(span!.start.off).toBe(18);
  });

  it("handles ligatures and accents", () => {
    const span = new TextIndex(["Final ﬁeld trip — Café visit"]).find("final field trip cafe");
    expect(span).not.toBeNull();
  });

  it("returns null when the quote isn't there", () => {
    expect(new TextIndex(["nothing here"]).find("Midterm")).toBeNull();
    expect(new TextIndex(["nothing here"]).find("  ")).toBeNull();
  });
});
