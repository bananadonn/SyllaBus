import { addDays, addMinutes } from "../dates";
import type { SyllabusEvent } from "../schema";

const DEFAULT_DURATION_MIN = 60;

interface ResolvedTimes {
  allDay: boolean;
  startDate: string;
  endDate: string; // inclusive (the last day the event touches)
  startTime?: string;
  endTime?: string;
}

/** Fills in a sensible end time: given end time, or start + 1h capped at 23:59. */
export function resolveTimes(e: SyllabusEvent): ResolvedTimes {
  if (!e.startTime) {
    return { allDay: true, startDate: e.date, endDate: e.endDate && e.endDate > e.date ? e.endDate : e.date };
  }
  if (e.endTime && e.endTime > e.startTime) {
    return { allDay: false, startDate: e.date, endDate: e.date, startTime: e.startTime, endTime: e.endTime };
  }
  if (e.endTime && e.endTime < e.startTime) {
    // e.g. 22:00–01:00 runs past midnight
    return { allDay: false, startDate: e.date, endDate: addDays(e.date, 1), startTime: e.startTime, endTime: e.endTime };
  }
  const { time, dayOffset } = addMinutes(e.startTime, DEFAULT_DURATION_MIN);
  return {
    allDay: false,
    startDate: e.date,
    endDate: e.date,
    startTime: e.startTime,
    endTime: dayOffset > 0 ? "23:59" : time,
  };
}

export function describe(e: SyllabusEvent): string {
  const date = e.dateQuote && !e.sourceQuote.includes(e.dateQuote) ? ` (${e.dateQuote})` : "";
  return [e.notes, e.sourceQuote && `From syllabus: "${e.sourceQuote}"${date}`, "Added by SyllaBus"]
    .filter(Boolean)
    .join("\n\n");
}

export function selected(events: SyllabusEvent[]): SyllabusEvent[] {
  return events.filter((e) => e.include);
}
