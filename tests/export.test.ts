import { describe, expect, it } from "vitest";
import { toCSV } from "@/lib/export/csv";
import { toICS } from "@/lib/export/ics";
import { toGoogleEvent } from "@/lib/google/calendar";
import type { SyllabusEvent } from "@/lib/schema";

const base: Omit<SyllabusEvent, "id" | "title" | "date"> = {
  type: "other",
  endDate: null,
  startTime: null,
  endTime: null,
  sourceQuote: "",
  dateQuote: "",
  notes: "",
  recurring: false,
  include: true,
  flags: [],
};

const events: SyllabusEvent[] = [
  { ...base, id: "1", title: "Midterm, part 1", type: "exam", date: "2026-10-14", startTime: "14:00", endTime: "15:30", sourceQuote: 'Midterm "A"' },
  { ...base, id: "2", title: "HW 2 due", type: "assignment", date: "2026-09-25", startTime: "23:30" },
  { ...base, id: "3", title: "Thanksgiving; no class", type: "holiday", date: "2026-11-25", endDate: "2026-11-27" },
  { ...base, id: "4", title: "Excluded", date: "2026-11-30", include: false },
];

describe("CSV export", () => {
  const csv = toCSV(events);
  const lines = csv.trim().split("\r\n");

  it("uses Google's header and skips excluded rows", () => {
    expect(lines[0]).toBe("Subject,Start Date,Start Time,End Date,End Time,All Day Event,Description,Location");
    expect(csv).not.toContain("Excluded");
  });
  it("formats dates/times and escapes commas and quotes", () => {
    expect(lines[1]).toMatch(/^"Midterm, part 1",10\/14\/2026,02:00 PM,10\/14\/2026,03:30 PM,False,/);
    expect(csv).toContain('""A""');
  });
  it("caps default end time at midnight", () => {
    expect(lines[2]).toContain("09/25/2026,11:30 PM,09/25/2026,11:59 PM,False");
  });
  it("marks all-day events", () => {
    expect(lines[3]).toMatch(/^Thanksgiving; no class,11\/25\/2026,,11\/27\/2026,,True,/);
  });
});

describe("ICS export", () => {
  const ics = toICS(events, { courseName: "CS 101", timezone: "America/New_York", now: new Date("2026-08-01T00:00:00Z") });

  it("is well-formed with CRLF and one VEVENT per selected event", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trim().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it("writes floating timed events and exclusive all-day ends", () => {
    expect(ics).toContain("DTSTART:20261014T140000\r\nDTEND:20261014T153000");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261125\r\nDTEND;VALUE=DATE:20261128");
  });
  it("escapes text and uses stable UIDs", () => {
    expect(ics).toContain("SUMMARY:Midterm\\, part 1");
    expect(ics).toContain("SUMMARY:Thanksgiving\\; no class");
    const again = toICS(events, { courseName: "CS 101", timezone: "America/New_York" });
    const uids = (s: string) => s.match(/UID:.*/g);
    expect(uids(again)).toEqual(uids(ics));
  });
});

describe("Google event mapping", () => {
  it("maps timed and all-day events", () => {
    expect(toGoogleEvent(events[0], "America/New_York")).toMatchObject({
      start: { dateTime: "2026-10-14T14:00:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-10-14T15:30:00" },
    });
    expect(toGoogleEvent(events[2], "UTC")).toMatchObject({ start: { date: "2026-11-25" }, end: { date: "2026-11-28" } });
  });
});
