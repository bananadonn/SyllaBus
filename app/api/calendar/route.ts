import { z } from "zod";
import { auth, googleConfigured } from "@/auth";
import { GoogleAuthError, syncToGoogle } from "@/lib/google/calendar";
import { EVENT_TYPES } from "@/lib/schema";

export const maxDuration = 60;

const BodySchema = z.object({
  courseName: z.string().max(200).default(""),
  timezone: z.string().min(1),
  events: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(300),
        type: z.enum(EVENT_TYPES),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
        startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
        endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
        sourceQuote: z.string().max(2000).default(""),
        dateQuote: z.string().max(500).default(""),
        notes: z.string().max(2000).default(""),
        recurring: z.boolean().default(false),
        include: z.boolean(),
        flags: z.array(z.any()).default([]),
      }),
    )
    .max(500),
});

export async function POST(req: Request) {
  if (!googleConfigured) {
    return Response.json({ error: "Google Calendar sync isn't configured on this server." }, { status: 503 });
  }
  const session = await auth();
  if (!session?.accessToken) {
    return Response.json({ error: "Sign in with Google first.", needsAuth: true }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid event data." }, { status: 400 });

  try {
    const result = await syncToGoogle(session.accessToken, parsed.data.events, parsed.data);
    return Response.json(result);
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return Response.json({ error: err.message, needsAuth: true }, { status: 401 });
    }
    console.error("Google sync failed", err);
    return Response.json({ error: "Couldn't add events to Google Calendar." }, { status: 502 });
  }
}
