import type { SyllabusEvent } from "../schema";
import { describe, resolveTimes, selected } from "./common";

/** Column layout matches Google Calendar's CSV import format. */
const HEADER = ["Subject", "Start Date", "Start Time", "End Date", "End Time", "All Day Event", "Description", "Location"];

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 2026-10-05 → 10/05/2026 */
function usDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/** 14:30 → 02:30 PM */
function ampm(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function toCSV(events: SyllabusEvent[]): string {
  const rows = selected(events).map((e) => {
    const t = resolveTimes(e);
    return [
      e.title,
      usDate(t.startDate),
      t.startTime ? ampm(t.startTime) : "",
      usDate(t.endDate),
      t.endTime ? ampm(t.endTime) : "",
      t.allDay ? "True" : "False",
      describe(e),
      "",
    ];
  });
  return [HEADER, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
