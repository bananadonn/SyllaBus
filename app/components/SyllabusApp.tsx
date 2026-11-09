"use client";

import { useMemo, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { toCSV } from "@/lib/export/csv";
import { toICS } from "@/lib/export/ics";
import { clearFile, loadFile, saveFile } from "@/lib/fileStore";
import { fnv1a } from "@/lib/hash";
import type { ExtractResponse, SyllabusEvent } from "@/lib/schema";
import ReviewTable from "./ReviewTable";
import SyllabusPreview, { type PreviewFocus } from "./SyllabusPreview";
import UploadForm from "./UploadForm";

const STORAGE_KEY = "syllabus:review";
const PENDING_SYNC_KEY = "syllabus:pendingSync";
const SIGN_IN_CANCELLED =
  "Google sign-in wasn't completed, so nothing was added. Your dates are still here: try again, or use Download .ics / CSV.";

type Course = ExtractResponse["course"];
interface ReviewState {
  course: Course;
  events: SyllabusEvent[];
  warnings: string[];
  sourceText: string;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "syllabus";

export default function SyllabusApp({ googleEnabled }: { googleEnabled: boolean }) {
  const [state, setState] = useState<ReviewState | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [focus, setFocus] = useState<PreviewFocus | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sync, setSync] = useState<{ status: "idle" | "working" | "done" | "error"; message?: string }>({
    status: "idle",
  });

  // Restore review state (e.g. after returning from Google sign-in) and resume a pending sync.
  useEffect(() => {
    const s = storage();
    // Cancelling on Google's page sends us back here with ?error=… (see `pages.error` in auth.ts).
    const url = new URL(window.location.href);
    const authError = url.searchParams.get("error");
    if (authError) {
      url.searchParams.delete("error");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      s?.removeItem(PENDING_SYNC_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the redirect result
      setSync({ status: "error", message: SIGN_IN_CANCELLED });
    }
    const saved = s?.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const restored = JSON.parse(saved) as ReviewState;
      restored.sourceText ??= "";
      restored.events = restored.events.map((e) => ({ ...e, dateQuote: e.dateQuote ?? "" }));
      setState(restored);
      void loadFile().then((f) => f && setFile(f));
      if (s?.getItem(PENDING_SYNC_KEY)) {
        s.removeItem(PENDING_SYNC_KEY);
        void syncGoogle(restored, { resuming: true });
      }
    } catch {
      s?.removeItem(STORAGE_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pressing Back on Google's page can restore this page from the browser's back/forward cache,
  // frozen mid-"Adding…". Unfreeze it instead of leaving the button stuck.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted || !storage()?.getItem(PENDING_SYNC_KEY)) return;
      storage()?.removeItem(PENDING_SYNC_KEY);
      setSync({ status: "error", message: SIGN_IN_CANCELLED });
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  useEffect(() => {
    const s = storage();
    if (!state) return;
    try {
      s?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full: keep working, just without restore-after-sign-in for the text.
      s?.setItem(STORAGE_KEY, JSON.stringify({ ...state, sourceText: "" }));
    }
  }, [state]);

  const selectedCount = state?.events.filter((e) => e.include).length ?? 0;
  const flaggedCount = state?.events.filter((e) => e.include && e.flags.length > 0).length ?? 0;

  const quotes = useMemo(
    () => [...new Set((state?.events ?? []).flatMap((e) => [e.sourceQuote, e.dateQuote]).filter(Boolean))],
    [state?.events],
  );

  function showQuote(e: SyllabusEvent) {
    setActiveId(e.id);
    setFocus({ quotes: [e.sourceQuote, e.dateQuote].filter(Boolean), nonce: Date.now() });
  }

  function showRowForQuote(quote: string) {
    const matches = state?.events.filter((e) => e.sourceQuote === quote || e.dateQuote === quote) ?? [];
    const target = matches.find((e) => e.include) ?? matches[0];
    if (!target) return;
    setActiveId(target.id);
    setFocus({ quotes: [target.sourceQuote, target.dateQuote].filter(Boolean), nonce: Date.now() });
    document.getElementById(`row-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function startOver() {
    storage()?.removeItem(STORAGE_KEY);
    void clearFile();
    setFile(null);
    setFocus(null);
    setActiveId(null);
    setState(null);
    setSync({ status: "idle" });
  }

  function addRow() {
    if (!state) return;
    const today = new Date().toISOString().slice(0, 10);
    const ev: SyllabusEvent = {
      id: fnv1a(`manual|${Date.now()}|${Math.random()}`),
      title: state.course.name ? `${state.course.name}: ` : "New event",
      type: "other",
      date: state.course.termStart || today,
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
    setState({ ...state, events: [...state.events, ev] });
  }

  /**
   * `resuming` = we just came back from Google sign-in. In that case never send the user to Google
   * again: if they aren't signed in, they backed out or cancelled, so we just tell them.
   */
  async function syncGoogle(current: ReviewState | null = state, { resuming = false } = {}) {
    if (!current) return;
    setSync({ status: "working" });
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseName: current.course.name,
          timezone: current.course.timezone,
          events: current.events,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.needsAuth) {
        if (resuming) {
          setSync({ status: "error", message: SIGN_IN_CANCELLED });
          return;
        }
        storage()?.setItem(PENDING_SYNC_KEY, "1");
        await signIn("google", { redirectTo: "/" });
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setSync({
        status: "done",
        message: `Added ${data.created} event${data.created === 1 ? "" : "s"} to a new "SyllaBus${
          current.course.name ? ` – ${current.course.name}` : ""
        }" calendar.${data.failed ? ` ${data.failed} failed; try exporting those as .ics.` : ""}`,
      });
    } catch (err) {
      setSync({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const btn =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50";

  return (
    <main className={`mx-auto w-full flex-1 px-4 py-10 sm:px-6 ${state ? "max-w-[1600px]" : "max-w-5xl"}`}>
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Sylla<span className="text-indigo-600">Bus</span>
        </h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Upload a syllabus. Get every exam, deadline and day off into your calendar.
        </p>
      </header>

      {!state ? (
        <UploadForm
          onResult={(r, uploaded) => {
            setSync({ status: "idle" });
            setFile(uploaded);
            setFocus(null);
            setActiveId(null);
            if (uploaded) void saveFile(uploaded);
            else void clearFile();
            setState({ course: r.course, events: r.events, warnings: r.warnings, sourceText: r.sourceText ?? "" });
          }}
        />
      ) : (
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
          <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">
                Review {state.course.name ? `${state.course.name} ` : ""}dates
              </h2>
              <p className="text-sm text-zinc-500">
                {state.events.length} found · {selectedCount} selected
                {flaggedCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400"> · {flaggedCount} need a look</span>
                )}
                {state.course.termStart && state.course.termEnd && (
                  <> · Term {state.course.termStart} to {state.course.termEnd}</>
                )}
              </p>
            </div>
            <button type="button" onClick={startOver} className={`${btn} text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800`}>
              ← New syllabus
            </button>
          </div>

          {state.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              {state.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            AI can make mistakes. Click a 📍 quote to see exactly where it came from in your syllabus, then fix anything that&rsquo;s off.
          </p>

          <ReviewTable
            events={state.events}
            onChange={(events) => setState({ ...state, events })}
            activeId={activeId}
            onQuoteClick={showQuote}
          />

          <button type="button" onClick={addRow} className={`${btn} border border-dashed border-zinc-300 text-zinc-600 hover:border-indigo-400 dark:border-zinc-700 dark:text-zinc-300`}>
            + Add an event
          </button>

          <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-3 border-t border-zinc-200 bg-[var(--background)]/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border dark:border-zinc-800">
            {googleEnabled && (
              <button
                type="button"
                disabled={!selectedCount || sync.status === "working"}
                onClick={() => syncGoogle()}
                className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}
              >
                {sync.status === "working" ? "Adding…" : "Add to Google Calendar"}
              </button>
            )}
            <button
              type="button"
              disabled={!selectedCount}
              onClick={() =>
                download(
                  `${slug(state.course.name)}.ics`,
                  toICS(state.events, { courseName: state.course.name, timezone: state.course.timezone }),
                  "text/calendar;charset=utf-8",
                )
              }
              className={`${btn} border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900`}
            >
              Download .ics
            </button>
            <button
              type="button"
              disabled={!selectedCount}
              onClick={() => download(`${slug(state.course.name)}.csv`, toCSV(state.events), "text/csv;charset=utf-8")}
              className={`${btn} border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900`}
            >
              Download CSV
            </button>
            {sync.message && (
              <p
                role="status"
                className={`basis-full text-sm ${sync.status === "error" ? "text-red-600" : "text-emerald-700 dark:text-emerald-400"}`}
              >
                {sync.message}
              </p>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            .ics works with Google Calendar (Settings → Import), Apple Calendar and Outlook. The CSV matches Google
            Calendar&rsquo;s import format and opens in Excel/Sheets.
          </p>
          </div>
          <aside className="h-[75vh] min-w-0 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
            <SyllabusPreview
              file={file}
              text={state.sourceText}
              quotes={quotes}
              focus={focus}
              onHighlightClick={showRowForQuote}
            />
          </aside>
        </section>
      )}
    </main>
  );
}
