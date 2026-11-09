import { addDays } from "../dates";
import { describe, resolveTimes, selected } from "../export/common";
import type { SyllabusEvent } from "../schema";

const API = "https://www.googleapis.com/calendar/v3";

export class GoogleAuthError extends Error {}

async function gfetch<T>(token: string, path: string, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 401) throw new GoogleAuthError("Your Google sign-in expired. Please sign in again.");
    // Back off on rate limits.
    if ((res.status === 429 || res.status === 403) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    const text = await res.text();
    throw new Error(`Google Calendar error ${res.status}: ${text.slice(0, 300)}`);
  }
}

export function toGoogleEvent(e: SyllabusEvent, timeZone: string) {
  const t = resolveTimes(e);
  return {
    summary: e.title,
    description: describe(e),
    ...(t.allDay
      ? {
          start: { date: t.startDate },
          end: { date: addDays(t.endDate, 1) }, // end date is exclusive
          transparency: "transparent",
        }
      : {
          start: { dateTime: `${t.startDate}T${t.startTime}:00`, timeZone },
          end: { dateTime: `${t.endDate}T${t.endTime}:00`, timeZone },
        }),
  };
}

/** Creates a dedicated "SyllaBus – <course>" calendar and adds the selected events to it. */
export async function syncToGoogle(
  token: string,
  events: SyllabusEvent[],
  opts: { courseName: string; timezone: string },
): Promise<{ calendarId: string; created: number; failed: number }> {
  const cal = await gfetch<{ id: string }>(token, "/calendars", {
    summary: opts.courseName ? `SyllaBus – ${opts.courseName}` : "SyllaBus",
    description: "Dates imported from a syllabus by SyllaBus. Delete this calendar to remove them all.",
    timeZone: opts.timezone,
  });

  const toAdd = selected(events);
  let created = 0;
  let failed = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < toAdd.length; i += CONCURRENCY) {
    const batch = toAdd.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((e) =>
        gfetch(token, `/calendars/${encodeURIComponent(cal.id)}/events`, toGoogleEvent(e, opts.timezone)),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") created++;
      else if (r.reason instanceof GoogleAuthError) throw r.reason;
      else failed++;
    }
  }
  return { calendarId: cal.id, created, failed };
}
