import { z } from "zod";

export const EVENT_TYPES = [
  "exam",
  "quiz",
  "assignment",
  "project",
  "reading",
  "lab",
  "presentation",
  "holiday",
  "no_class",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM (24h)");

/** One item exactly as the LLM returns it. */
export const RawEventSchema = z.object({
  title: z.string().min(1),
  type: z.enum(EVENT_TYPES).catch("other"),
  /** Set for one-off events. */
  date: isoDate.nullable().optional(),
  /** Last day of a multi-day all-day item (e.g. a break). */
  endDate: isoDate.nullable().optional().catch(null),
  startTime: hhmm.nullable().optional().catch(null),
  endTime: hhmm.nullable().optional().catch(null),
  /** Set for repeating events ("Quizzes every Friday"). 0 = Sunday … 6 = Saturday. */
  recurrence: z
    .object({
      daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
      startDate: isoDate.nullable().optional(),
      endDate: isoDate.nullable().optional(),
    })
    .nullable()
    .optional(),
  sourceQuote: z.string().default(""),
  dateQuote: z.string().nullable().optional().catch(null),
  notes: z.string().nullable().optional(),
});
export type RawEvent = z.infer<typeof RawEventSchema>;

export const ExtractionResultSchema = z.object({
  course: z
    .object({
      name: z.string().nullable().optional(),
      termStart: isoDate.nullable().optional(),
      termEnd: isoDate.nullable().optional(),
    })
    .default({}),
  events: z.array(z.unknown()).default([]),
});

/** What the user tells us on the upload form. Everything is optional except the timezone. */
export const CourseContextSchema = z.object({
  courseName: z.string().trim().max(200).optional().default(""),
  termStart: isoDate.optional().or(z.literal("")).default(""),
  termEnd: isoDate.optional().or(z.literal("")).default(""),
  timezone: z.string().min(1).default("UTC"),
});
export type CourseContext = z.infer<typeof CourseContextSchema>;

export type FlagCode =
  | "quote_not_found"
  | "date_text_not_found"
  | "date_mismatch"
  | "unverified_date"
  | "outside_term"
  | "duplicate"
  | "invalid_date";

export interface Flag {
  code: FlagCode;
  message: string;
}

/** A normalized, validated event the UI edits and the exporters consume. */
export interface SyllabusEvent {
  id: string;
  title: string;
  type: EventType;
  date: string; // YYYY-MM-DD
  /** Last day (inclusive) of a multi-day all-day event, else null. */
  endDate: string | null;
  startTime: string | null; // HH:MM
  endTime: string | null; // HH:MM
  /** Exact syllabus text naming the item. */
  sourceQuote: string;
  /** Exact syllabus text stating the date (may be in another table cell). "" if none. */
  dateQuote: string;
  notes: string;
  recurring: boolean;
  include: boolean;
  flags: Flag[];
}

export interface ExtractResponse {
  course: { name: string; termStart: string; termEnd: string; timezone: string };
  events: SyllabusEvent[];
  warnings: string[];
  /** The syllabus text we read (for the preview). Empty for scanned PDFs. */
  sourceText: string;
  model: string;
  cached: boolean;
}
