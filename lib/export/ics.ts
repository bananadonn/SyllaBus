import { addDays } from "../dates";
import { fnv1a } from "../hash";
import type { SyllabusEvent } from "../schema";
import { describe, resolveTimes, selected } from "./common";

/** Escape TEXT values per RFC 5545. */
function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (currentBytes + len > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += len;
  }
  out.push(current);
  return out.join("\r\n ");
}

const compactDate = (iso: string) => iso.replace(/-/g, "");
const compactTime = (hhmm: string) => hhmm.replace(":", "") + "00";

/** Stable UID so re-importing the same event updates it instead of duplicating. */
function eventUid(e: SyllabusEvent, courseName: string): string {
  return `${fnv1a(`${courseName}|${e.title}|${e.date}|${e.startTime ?? ""}`)}-${e.date}@syllabus.app`;
}

/**
 * Builds an .ics calendar. Timed events use "floating" local time (no Z / TZID), so they show at the
 * syllabus's clock time in whatever timezone the student's calendar uses. X-WR-TIMEZONE hints the zone.
 */
export function toICS(
  events: SyllabusEvent[],
  opts: { courseName: string; timezone: string; now?: Date },
): string {
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SyllaBus//Syllabus Importer//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts.courseName ? `SyllaBus – ${opts.courseName}` : "SyllaBus")}`,
    `X-WR-TIMEZONE:${opts.timezone}`,
  ];

  for (const e of selected(events)) {
    const t = resolveTimes(e);
    lines.push("BEGIN:VEVENT", `UID:${eventUid(e, opts.courseName)}`, `DTSTAMP:${stamp}`);
    if (t.allDay) {
      lines.push(
        `DTSTART;VALUE=DATE:${compactDate(t.startDate)}`,
        `DTEND;VALUE=DATE:${compactDate(addDays(t.endDate, 1))}`, // exclusive
        "TRANSP:TRANSPARENT",
      );
    } else {
      lines.push(
        `DTSTART:${compactDate(t.startDate)}T${compactTime(t.startTime!)}`,
        `DTEND:${compactDate(t.endDate)}T${compactTime(t.endTime!)}`,
      );
    }
    lines.push(`SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(describe(e))}`, `CATEGORIES:${esc(e.type.toUpperCase())}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
