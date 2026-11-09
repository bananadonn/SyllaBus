import type { CourseContext } from "../schema";
import { EVENT_TYPES } from "../schema";

export function buildSystemPrompt(): string {
  return `You extract every important dated item from a college course syllabus so it can be added to a student's calendar.

Include: exams, midterms, finals, quizzes, assignment/homework/paper/project due dates, labs, presentations, readings with a due date, holidays, breaks, and days with no class.
Do NOT include: office hours, general weekly class meeting times, or university policies with no specific date.

Rules:
1. Only output dates that are stated in or can be derived directly from the syllabus. Never guess or invent a date.
2. "date" must be YYYY-MM-DD. Syllabi often omit the year; infer it from the term dates. For "Week N" schedules, Week 1 begins on the term start date (or the first class day stated in the syllabus).
3. Quote the syllabus VERBATIM so the student can find each item. Copy characters exactly: no paraphrasing, no fixing typos, and never join words from different places into one quote.
   - "sourceQuote": the shortest exact text that names the item, e.g. "Wireshark Lab 1: HTTP" (under 150 characters).
   - "dateQuote": the shortest exact text that states its date, e.g. "Sep 14, 16". In tables this is often a different cell of the same row. If the date sits right inside sourceQuote, repeat just the date part. Use null only if the date is not written anywhere (e.g. you computed it from a weekly pattern).
   In the text, " | " separates table cells and " / " separates lines inside a cell; they are not part of the syllabus.
4. For a repeating item stated as a pattern ("Quizzes every Friday", "Reading responses due each Monday"), output ONE item with "recurrence" (daysOfWeek: 0=Sunday … 6=Saturday, plus startDate/endDate if the syllabus limits the range) and "date": null. If specific dates are listed, output them as separate one-off items instead.
5. Times are 24-hour HH:MM. Use null when no time is given (the item becomes an all-day event). Use the due time if stated (e.g. "due 11:59 PM" → startTime "23:59").
6. Make titles short and calendar-friendly, prefixed with the course code if known, e.g. "CS 101: Midterm Exam", "CS 101: HW 3 due".
7. "type" is one of: ${EVENT_TYPES.join(", ")}.
8. Always fill in "course": the course code and/or name (e.g. "CS 101"), the first day of classes ("termStart") and the last day of classes ("termEnd"). Look for phrases like "classes begin", "first day of class", "last day of class", the earliest and latest weeks in the schedule, or the semester name plus dated rows. Use null only if the syllabus truly doesn't say.
9. A multi-day break or holiday (e.g. "Spring Break Mar 9–13") becomes ONE item: "date" is the first day and "endDate" the last day. Use "endDate": null for everything else.`;
}

export function buildUserPrompt(ctx: CourseContext, syllabusText?: string): string {
  const known = [
    ctx.courseName && `Course name (from user): ${ctx.courseName}`,
    ctx.termStart && `Term start date (from user): ${ctx.termStart}`,
    ctx.termEnd && `Term end date (from user): ${ctx.termEnd}`,
    `Today's date: ${new Date().toISOString().slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `${known}

${syllabusText ? `SYLLABUS TEXT:\n"""\n${syllabusText}\n"""` : "The syllabus is attached (a scanned document or photo). Copy sourceQuote and dateQuote exactly as printed."}

Extract the items now as JSON matching the schema.`;
}

/** JSON Schema handed to Gemini's structured output (kept deliberately simple for compatibility). */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    course: {
      type: "object",
      properties: {
        name: { type: ["string", "null"] },
        termStart: { type: ["string", "null"], description: "YYYY-MM-DD" },
        termEnd: { type: ["string", "null"], description: "YYYY-MM-DD" },
      },
      required: ["name", "termStart", "termEnd"],
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          type: { type: "string", enum: [...EVENT_TYPES] },
          date: { type: ["string", "null"], description: "YYYY-MM-DD, null for recurring items" },
          endDate: { type: ["string", "null"], description: "YYYY-MM-DD last day of a multi-day break, else null" },
          startTime: { type: ["string", "null"], description: "HH:MM 24h" },
          endTime: { type: ["string", "null"], description: "HH:MM 24h" },
          recurrence: {
            type: ["object", "null"],
            properties: {
              daysOfWeek: { type: "array", items: { type: "integer" } },
              startDate: { type: ["string", "null"] },
              endDate: { type: ["string", "null"] },
            },
            required: ["daysOfWeek"],
          },
          sourceQuote: { type: "string", description: "Exact text naming the item" },
          dateQuote: { type: ["string", "null"], description: "Exact text stating the date" },
          notes: { type: ["string", "null"] },
        },
        required: ["title", "type", "date", "startTime", "endTime", "sourceQuote", "dateQuote"],
      },
    },
  },
  required: ["course", "events"],
} as const;
