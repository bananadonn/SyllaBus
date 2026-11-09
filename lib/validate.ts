import * as chrono from "chrono-node";
import { addDays, dayOfWeek, parseISODate } from "./dates";
import { fnv1a } from "./hash";
import { normalizeForMatch, quoteFoundInText } from "./locate";

export { normalizeForMatch, quoteFoundInText };
import {
  type CourseContext,
  type Flag,
  type RawEvent,
  type SyllabusEvent,
  ExtractionResultSchema,
  RawEventSchema,
} from "./schema";

const MAX_RECURRING_OCCURRENCES = 120;

interface BuildResult {
  course: { name: string; termStart: string; termEnd: string; timezone: string };
  events: SyllabusEvent[];
  warnings: string[];
}

/**
 * Uses chrono-node (rule/regex based) to independently read the date(s) in the quote.
 * - "match": a date in the quote agrees with the AI's date
 * - "mismatch": the quote has explicit dates but none agree
 * - "none": the quote has no explicit month+day (e.g. "Week 5 Thursday")
 */
export function checkDateAgainstQuote(
  date: string,
  quote: string,
  refDate: Date,
): { status: "match" | "mismatch" | "none"; found: string[] } {
  const target = parseISODate(date);
  if (!target) return { status: "mismatch", found: [] };
  const tM = target.getUTCMonth() + 1;
  const tD = target.getUTCDate();
  const tY = target.getUTCFullYear();
  const t = tM * 100 + tD;
  const found: string[] = [];

  // Day lists like "Sep 14, 16" or "Oct 13 & 14" mean several days in one month. chrono would read
  // "Sep 14, 16" as September 14, 2016, so handle these first and hide the extra days from chrono.
  let rest = quote.replace(/[‐-―−]/g, "-"); // chrono only understands ASCII hyphens
  for (const m of rest.matchAll(DAY_LIST)) {
    const month = monthNumber(m[1]);
    const days = [m[2], ...m[3].split(/\s*(?:,|&|and)\s*/i).filter(Boolean)].map(Number);
    if (!month || days.some((d) => d < 1 || d > 31)) continue;
    found.push(m[0].trim());
    if (days.some((d) => month * 100 + d === t)) return { status: "match", found };
    rest = rest.slice(0, m.index! + m[1].length) + " ".repeat(m[0].length - m[1].length) + rest.slice(m.index! + m[0].length);
  }

  let sawExplicit = found.length > 0;
  for (const r of chrono.parse(rest, refDate)) {
    const comps = [r.start, r.end].filter(Boolean) as chrono.ParsedComponents[];
    const explicit = comps.filter((c) => c.isCertain("month") && c.isCertain("day"));
    if (explicit.length === 0) continue;
    sawExplicit = true;
    found.push(r.text.trim());

    const md = (c: chrono.ParsedComponents) => (c.get("month") ?? 0) * 100 + (c.get("day") ?? 0);
    // Only trust a year that's actually written out as four digits.
    const hasYear = /\b\d{4}\b/.test(r.text);
    const yearOk = (c: chrono.ParsedComponents) => !hasYear || !c.isCertain("year") || c.get("year") === tY;

    // Exact match on any endpoint.
    if (explicit.some((c) => md(c) === t && yearOk(c))) return { status: "match", found };

    // Inside a range like "Mar 9–13".
    if (r.end && r.start.isCertain("month") && r.start.isCertain("day")) {
      const a = md(r.start);
      const b = md(r.end);
      if (a <= b ? t >= a && t <= b : t >= a || t <= b) return { status: "match", found };
    }
  }
  return { status: sawExplicit ? "mismatch" : "none", found };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNumber = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
/** "Sep 14, 16" · "Sept. 14 & 16" · "October 13, 14 and 15" — but not "Sep 14, 2026". */
const DAY_LIST =
  /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?((?:\s*(?:,|&|and)\s*\d{1,2}(?:st|nd|rd|th)?\b(?!\s*[:\d]))+)/gi;

function expandRecurrence(
  raw: RawEvent,
  termStart: string,
  termEnd: string,
  skipDates: Set<string>,
): string[] | null {
  const rec = raw.recurrence;
  if (!rec) return null;
  const start = (rec.startDate && parseISODate(rec.startDate) && rec.startDate) || termStart;
  const end = (rec.endDate && parseISODate(rec.endDate) && rec.endDate) || termEnd;
  if (!start || !end || start > end) return null;

  const days = new Set(rec.daysOfWeek);
  const out: string[] = [];
  for (let d = start; d <= end && out.length < MAX_RECURRING_OCCURRENCES; d = addDays(d, 1)) {
    if (days.has(dayOfWeek(d)) && !skipDates.has(d)) out.push(d);
  }
  return out;
}

/** Turns raw model output into validated, flagged events ready for the review table. */
export function buildEvents(rawOutput: unknown, sourceText: string, ctx: CourseContext): BuildResult {
  const warnings: string[] = [];
  const parsed = ExtractionResultSchema.safeParse(rawOutput);
  if (!parsed.success) {
    return {
      course: { name: ctx.courseName, termStart: ctx.termStart, termEnd: ctx.termEnd, timezone: ctx.timezone },
      events: [],
      warnings: ["The AI response didn't match the expected format. Please try again."],
    };
  }

  const detected = parsed.data.course;
  const valid = (d?: string | null) => (d && parseISODate(d) ? d : "");
  const course = {
    name: ctx.courseName || detected.name?.trim() || "",
    termStart: ctx.termStart || valid(detected.termStart),
    termEnd: ctx.termEnd || valid(detected.termEnd),
    timezone: ctx.timezone,
  };

  const raws: RawEvent[] = [];
  let dropped = 0;
  for (const item of parsed.data.events) {
    const r = RawEventSchema.safeParse(item);
    if (r.success) raws.push(r.data);
    else dropped++;
  }
  if (dropped) warnings.push(`${dropped} item(s) from the AI were malformed and skipped.`);

  if (course.termStart && course.termEnd && course.termStart > course.termEnd) {
    course.termStart = "";
    course.termEnd = "";
  }
  // Syllabus didn't state the term dates: estimate them from the earliest/latest dated items.
  if (!course.termStart || !course.termEnd) {
    const dates = raws.map((r) => r.date).filter((d): d is string => !!d && !!parseISODate(d)).sort();
    if (dates.length >= 2) {
      const missing = [!course.termStart && "first", !course.termEnd && "last"].filter(Boolean).join(" and ");
      course.termStart ||= dates[0];
      course.termEnd ||= dates[dates.length - 1];
      warnings.push(
        `The syllabus didn't clearly state the ${missing} day of the term, so we estimated it from the dated items. Check weekly items near the start and end of the term.`,
      );
    }
  }

  const refDate = parseISODate(course.termStart) ?? new Date();
  const normalizedText = normalizeForMatch(sourceText);
  const canCheckQuotes = normalizedText.length > 0;

  // Days with no class shouldn't get recurring quizzes etc.
  const skipDates = new Set<string>();
  for (const r of raws) {
    if ((r.type !== "holiday" && r.type !== "no_class") || !r.date || !parseISODate(r.date)) continue;
    const last = r.endDate && r.endDate > r.date ? r.endDate : r.date;
    for (let d = r.date, n = 0; d <= last && n < 60; d = addDays(d, 1), n++) skipDates.add(d);
  }

  const events: SyllabusEvent[] = [];
  const seen = new Set<string>();

  for (const raw of raws) {
    const baseFlags: Flag[] = [];
    const dateQuote = (raw.dateQuote ?? "").trim();
    if (canCheckQuotes && dateQuote && !quoteFoundInText(dateQuote, normalizedText)) {
      baseFlags.push({
        code: "date_text_not_found",
        message: `Couldn't find the date text "${dateQuote}" in the syllabus. Double-check the date.`,
      });
    }
    if (canCheckQuotes && !quoteFoundInText(raw.sourceQuote, normalizedText)) {
      baseFlags.push({
        code: "quote_not_found",
        message: "Couldn't find this text in the syllabus. The AI may have made this item up.",
      });
    }

    let dates: { date: string; recurring: boolean }[];
    if (raw.recurrence && !raw.date) {
      const expanded = expandRecurrence(raw, course.termStart, course.termEnd, skipDates);
      if (!expanded) {
        warnings.push(`"${raw.title}" repeats weekly, but we couldn't find the term dates in the syllabus to add each occurrence. Add them by hand if needed.`);
        continue;
      }
      dates = expanded.map((date) => ({ date, recurring: true }));
    } else if (raw.date && parseISODate(raw.date)) {
      dates = [{ date: raw.date, recurring: false }];
    } else {
      warnings.push(`"${raw.title}" had no usable date and was skipped.`);
      continue;
    }

    for (const { date, recurring } of dates) {
      const flags = [...baseFlags];

      if (!recurring && (dateQuote || raw.sourceQuote)) {
        // Prefer the dedicated date text; fall back to the item text if the date wasn't quoted.
        const check = checkDateAgainstQuote(date, dateQuote || raw.sourceQuote, refDate);
        if (check.status === "mismatch") {
          flags.push({
            code: "date_mismatch",
            message: `The syllabus text says "${check.found.join(", ")}", which doesn't match this date.`,
          });
        } else if (check.status === "none") {
          flags.push({
            code: "unverified_date",
            message: "The date was worked out (e.g. from a week number), not written out. Double-check it.",
          });
        }
      }

      if (course.termStart && course.termEnd && (date < course.termStart || date > course.termEnd)) {
        flags.push({ code: "outside_term", message: "This date is outside the term dates." });
      }

      const key = `${normalizeForMatch(raw.title)}|${date}|${raw.startTime ?? ""}`;
      const isDup = seen.has(key);
      seen.add(key);
      if (isDup) flags.push({ code: "duplicate", message: "Looks like a duplicate of another item." });

      const endDate =
        !recurring && !raw.startTime && raw.endDate && raw.endDate > date && parseISODate(raw.endDate)
          ? raw.endDate
          : null;

      events.push({
        id: fnv1a(`${key}|${events.length}`),
        title: raw.title.trim(),
        type: raw.type,
        date,
        endDate,
        startTime: raw.startTime ?? null,
        endTime: raw.endTime ?? null,
        sourceQuote: raw.sourceQuote,
        dateQuote,
        notes: raw.notes ?? "",
        recurring,
        include: !isDup,
        flags,
      });
    }
  }

  events.sort((a, b) => (a.date + (a.startTime ?? "")).localeCompare(b.date + (b.startTime ?? "")));
  return { course, events, warnings };
}
