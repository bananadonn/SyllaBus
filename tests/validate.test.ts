import { describe, expect, it } from "vitest";
import { buildEvents, checkDateAgainstQuote, normalizeForMatch, quoteFoundInText } from "@/lib/validate";

const SYLLABUS = `CS 101 – Intro to Programming, Fall 2026
Classes begin Monday, August 24, 2026 and end Friday, December 11, 2026.

Schedule
Week | Date | Topic | Due
1 | Aug 24 | Intro |
5 | Sep 21 | Loops | HW 2 due Sept. 25 at 11:59 PM
8 | Oct 12 | Midterm Exam – October 14, in class
Thanksgiving Break: Nov 25–27 (no class)
Quizzes every Friday at the start of lecture.
Week 10 Thursday: Project proposal due
Final Exam: December 15, 2:00–4:00 PM`;

// Users only upload the syllabus; everything else comes from the syllabus itself.
const ctx = { courseName: "", termStart: "", termEnd: "", timezone: "America/New_York" };

describe("quote matching", () => {
  it("ignores punctuation and whitespace differences", () => {
    const text = normalizeForMatch(SYLLABUS);
    expect(quoteFoundInText("Midterm Exam - October 14,  in class", text)).toBe(true);
    expect(quoteFoundInText("Final exam: Dec 20", text)).toBe(false);
  });
});

describe("chrono date check", () => {
  const ref = new Date(Date.UTC(2026, 7, 24));
  it("matches an explicit date", () => {
    expect(checkDateAgainstQuote("2026-10-14", "Midterm Exam – October 14, in class", ref).status).toBe("match");
  });
  it("detects a mismatch", () => {
    expect(checkDateAgainstQuote("2026-10-12", "Midterm Exam – October 14, in class", ref).status).toBe("mismatch");
  });
  it("accepts a date inside a stated range", () => {
    expect(checkDateAgainstQuote("2026-11-26", "Thanksgiving Break: Nov 25–27 (no class)", ref).status).toBe("match");
  });
  it("reports none for week-number dates", () => {
    expect(checkDateAgainstQuote("2026-10-29", "Week 10 Thursday: Project proposal due", ref).status).toBe("none");
  });
});

describe("buildEvents", () => {
  const raw = {
    course: { name: "CS 101", termStart: "2026-08-24", termEnd: "2026-12-11" },
    events: [
      { title: "CS 101: HW 2 due", type: "assignment", date: "2026-09-25", startTime: "23:59", endTime: null, sourceQuote: "HW 2 due Sept. 25 at 11:59 PM" },
      { title: "CS 101: Midterm", type: "exam", date: "2026-10-12", startTime: null, endTime: null, sourceQuote: "Midterm Exam – October 14, in class" },
      { title: "CS 101: Midterm", type: "exam", date: "2026-10-12", startTime: null, endTime: null, sourceQuote: "Midterm Exam – October 14, in class" },
      { title: "Thanksgiving Break", type: "holiday", date: "2026-11-25", endDate: "2026-11-27", startTime: null, endTime: null, sourceQuote: "Thanksgiving Break: Nov 25–27 (no class)" },
      { title: "Guest lecture", type: "other", date: "2026-10-01", startTime: null, endTime: null, sourceQuote: "Guest lecture Oct 1" },
      { title: "Final Exam", type: "exam", date: "2026-12-15", startTime: "14:00", endTime: "16:00", sourceQuote: "Final Exam: December 15, 2:00–4:00 PM" },
      { title: "Quiz", type: "quiz", date: null, startTime: null, endTime: null, recurrence: { daysOfWeek: [5] }, sourceQuote: "Quizzes every Friday at the start of lecture." },
      { title: "No date at all", type: "other", date: null, startTime: null, endTime: null, sourceQuote: "" },
      { bogus: true },
    ],
  };

  const result = buildEvents(raw, SYLLABUS, ctx);
  const byTitle = (t: string) => result.events.filter((e) => e.title === t);

  it("uses the course name and term dates found in the syllabus", () => {
    expect(result.course).toMatchObject({ name: "CS 101", termStart: "2026-08-24", termEnd: "2026-12-11" });
    expect(result.warnings.join(" ")).not.toMatch(/estimated/);
  });

  it("passes a correct, quoted event with no flags", () => {
    expect(byTitle("CS 101: HW 2 due")[0].flags).toEqual([]);
  });

  it("flags a wrong date and duplicates (and deselects the duplicate)", () => {
    const [a, b] = byTitle("CS 101: Midterm");
    expect(a.flags.map((f) => f.code)).toContain("date_mismatch");
    expect(b.flags.map((f) => f.code)).toContain("duplicate");
    expect(b.include).toBe(false);
  });

  it("flags a hallucinated quote", () => {
    expect(byTitle("Guest lecture")[0].flags.map((f) => f.code)).toContain("quote_not_found");
  });

  it("flags dates outside the term", () => {
    expect(byTitle("Final Exam")[0].flags.map((f) => f.code)).toEqual(["outside_term"]);
  });

  it("keeps multi-day breaks as one spanning event", () => {
    expect(byTitle("Thanksgiving Break")[0]).toMatchObject({ date: "2026-11-25", endDate: "2026-11-27", flags: [] });
  });

  it("expands weekly items across the term, skipping break days", () => {
    const quizzes = byTitle("Quiz");
    expect(quizzes.map((q) => q.date)).not.toContain("2026-11-27"); // Friday of Thanksgiving break
    expect(quizzes.length).toBe(15); // 16 Fridays from Aug 28 to Dec 11, minus the break
    expect(quizzes[0].date).toBe("2026-08-28");
    expect(quizzes.at(-1)!.date).toBe("2026-12-11");
    expect(quizzes.every((q) => q.recurring)).toBe(true);
  });

  it("warns about skipped and malformed items, and sorts by date", () => {
    expect(result.warnings.join(" ")).toMatch(/no usable date/);
    expect(result.warnings.join(" ")).toMatch(/malformed/);
    const dates = result.events.map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("estimates the term from dated items when the syllabus doesn't state it", () => {
    const r = buildEvents({ ...raw, course: { name: null, termStart: null, termEnd: null } }, SYLLABUS, ctx);
    expect(r.course).toMatchObject({ termStart: "2026-09-25", termEnd: "2026-12-15" });
    expect(r.warnings.join(" ")).toMatch(/estimated/);
    expect(r.events.filter((e) => e.recurring)[0].date).toBe("2026-09-25");
  });

  it("can't expand weekly items with no term dates and too few dated items", () => {
    const quizOnly = { course: {}, events: [raw.events[6]] };
    const r = buildEvents(quizOnly, SYLLABUS, ctx);
    expect(r.events).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/repeats weekly/);
  });

  it("ignores impossible term dates", () => {
    const r = buildEvents({ ...raw, course: { termStart: "2026-12-11", termEnd: "2026-08-24" } }, SYLLABUS, ctx);
    expect(r.warnings.join(" ")).toMatch(/estimated/);
  });

  it("handles garbage output", () => {
    expect(buildEvents("nope", SYLLABUS, ctx).events).toEqual([]);
  });
});

describe("day lists and separate date quotes", () => {
  const ref = new Date(Date.UTC(2026, 7, 31));
  it('reads "Sep 14, 16" as two days in September, not the year 2016', () => {
    expect(checkDateAgainstQuote("2026-09-14", "Sep 14, 16", ref).status).toBe("match");
    expect(checkDateAgainstQuote("2026-09-16", "Sep 14, 16", ref).status).toBe("match");
    expect(checkDateAgainstQuote("2026-09-15", "Sep 14, 16", ref).status).toBe("mismatch");
    expect(checkDateAgainstQuote("2026-10-14", "Oct 13 & 14", ref).status).toBe("match");
  });

  it("still respects real four-digit years and times", () => {
    expect(checkDateAgainstQuote("2026-12-15", "December 15, 2025", ref).status).toBe("mismatch");
    expect(checkDateAgainstQuote("2026-09-25", "HW 2 due Sep 25, 11:59 PM", ref).status).toBe("match");
  });

  const TABLE_TEXT = "3 / Sep 14, 16 | The Web and HTTP. / Wireshark Lab 1: HTTP | Ch 2 / §2.2";
  const ctx2 = { courseName: "", termStart: "2026-08-31", termEnd: "2026-12-14", timezone: "UTC" };
  const ev = (over: object) => ({
    course: {},
    events: [{ title: "Wireshark Lab 1", type: "lab", date: "2026-09-14", startTime: null, endTime: null, sourceQuote: "Wireshark Lab 1: HTTP", ...over }],
  });

  it("checks the date against its own quote (date in another table cell)", () => {
    const r = buildEvents(ev({ dateQuote: "Sep 14, 16" }), TABLE_TEXT, ctx2);
    expect(r.events[0]).toMatchObject({ dateQuote: "Sep 14, 16", flags: [] });
  });

  it("flags a date quote that isn't in the syllabus, and a date that disagrees with it", () => {
    const r = buildEvents(ev({ dateQuote: "Sep 21" }), TABLE_TEXT, ctx2);
    expect(r.events[0].flags.map((f) => f.code).sort()).toEqual(["date_mismatch", "date_text_not_found"]);
  });

  it("works without a date quote", () => {
    const r = buildEvents(ev({ dateQuote: null }), TABLE_TEXT, ctx2);
    expect(r.events[0].dateQuote).toBe("");
    expect(r.events[0].flags.map((f) => f.code)).toEqual(["unverified_date"]);
  });
});
