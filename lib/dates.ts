/** Small date helpers that work on plain YYYY-MM-DD strings (no timezone drift). */

export function parseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Reject things like 2026-02-31 that roll over.
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  if (!d) throw new Error(`Invalid date: ${iso}`);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export function dayOfWeek(iso: string): number {
  const d = parseISODate(iso);
  if (!d) throw new Error(`Invalid date: ${iso}`);
  return d.getUTCDay();
}

/** Adds minutes to an HH:MM time; returns {time, dayOffset}. */
export function addMinutes(hhmm: string, minutes: number): { time: string; dayOffset: number } {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const dayOffset = Math.floor(total / 1440);
  const mins = ((total % 1440) + 1440) % 1440;
  const time = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  return { time, dayOffset };
}
