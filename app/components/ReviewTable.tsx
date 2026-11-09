"use client";

import { EVENT_TYPES, type SyllabusEvent } from "@/lib/schema";

const TYPE_LABEL: Record<string, string> = {
  exam: "Exam",
  quiz: "Quiz",
  assignment: "Assignment",
  project: "Project",
  reading: "Reading",
  lab: "Lab",
  presentation: "Presentation",
  holiday: "Holiday",
  no_class: "No class",
  other: "Other",
};

const cell =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-zinc-300 focus:border-indigo-500 focus:bg-white focus:outline-none dark:hover:border-zinc-700 dark:focus:bg-zinc-900";

export default function ReviewTable({
  events,
  onChange,
  activeId,
  onQuoteClick,
}: {
  events: SyllabusEvent[];
  onChange: (events: SyllabusEvent[]) => void;
  /** Row to emphasize (e.g. after clicking its highlight in the preview). */
  activeId?: string | null;
  /** Called when the user clicks a row's syllabus quote. */
  onQuoteClick?: (event: SyllabusEvent) => void;
}) {
  const update = (id: string, patch: Partial<SyllabusEvent>) =>
    onChange(
      events.map((e) =>
        e.id === id ? { ...e, ...patch, flags: patch.date || patch.title ? [] : e.flags } : e,
      ),
    );
  const remove = (id: string) => onChange(events.filter((e) => e.id !== id));
  const allOn = events.length > 0 && events.every((e) => e.include);

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th className="w-10 px-3 py-2">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allOn}
                onChange={() => onChange(events.map((e) => ({ ...e, include: !allOn })))}
              />
            </th>
            <th className="px-2 py-2">Title</th>
            <th className="w-32 px-2 py-2">Type</th>
            <th className="w-36 px-2 py-2">Date</th>
            <th className="w-24 px-2 py-2">Start</th>
            <th className="w-24 px-2 py-2">End</th>
            <th className="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const flagged = e.flags.length > 0;
            return (
              <tr
                key={e.id}
                id={`row-${e.id}`}
                className={`scroll-mt-24 border-t border-zinc-100 align-top transition-colors dark:border-zinc-800 ${
                  activeId === e.id
                    ? "bg-orange-50 outline-2 -outline-offset-2 outline-orange-400 dark:bg-orange-950/30"
                    : flagged
                      ? "bg-amber-50/70 dark:bg-amber-950/20"
                      : ""
                } ${e.include ? "" : "opacity-50"}`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Include ${e.title}`}
                    checked={e.include}
                    onChange={() => update(e.id, { include: !e.include })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input className={`${cell} font-medium`} value={e.title} onChange={(ev) => update(e.id, { title: ev.target.value })} />
                  {(flagged || e.sourceQuote || e.recurring) && (
                    <div className="mt-0.5 space-y-0.5 px-2 text-xs">
                      {e.flags.map((f) => (
                        <p key={f.code} className="text-amber-700 dark:text-amber-400">
                          ⚠ {f.message}
                        </p>
                      ))}
                      {e.recurring && <p className="text-zinc-500">↻ Weekly item</p>}
                      {e.sourceQuote && (
                        <button
                          type="button"
                          onClick={() => onQuoteClick?.(e)}
                          title="Show where this is in your syllabus"
                          className="group flex w-full scroll-my-28 items-start gap-1 rounded text-left italic text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          <span aria-hidden className="not-italic">📍</span>
                          <span className="line-clamp-2 underline decoration-dotted underline-offset-2 group-hover:decoration-solid">
                            &ldquo;{e.sourceQuote}&rdquo;
                            {e.dateQuote && !e.sourceQuote.includes(e.dateQuote) && (
                              <span className="not-italic"> · &ldquo;{e.dateQuote}&rdquo;</span>
                            )}
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <select
                    className={cell}
                    value={e.type}
                    onChange={(ev) => update(e.id, { type: ev.target.value as SyllabusEvent["type"] })}
                  >
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="date"
                    className={cell}
                    value={e.date}
                    onChange={(ev) => ev.target.value && update(e.id, { date: ev.target.value })}
                  />
                  {e.endDate && !e.startTime && (
                    <label className="mt-1 flex items-center gap-1 px-2 text-xs text-zinc-500">
                      to
                      <input
                        type="date"
                        className={cell}
                        value={e.endDate}
                        min={e.date}
                        onChange={(ev) => update(e.id, { endDate: ev.target.value || null })}
                      />
                    </label>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="time"
                    className={cell}
                    value={e.startTime ?? ""}
                    onChange={(ev) => update(e.id, { startTime: ev.target.value || null })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="time"
                    className={cell}
                    value={e.endTime ?? ""}
                    disabled={!e.startTime}
                    onChange={(ev) => update(e.id, { endTime: ev.target.value || null })}
                  />
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    aria-label={`Delete ${e.title}`}
                    onClick={() => remove(e.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
