"use client";

import { useRef, useState } from "react";
import { ACCEPT_ATTR } from "@/lib/formats";
import type { ExtractResponse } from "@/lib/schema";

const ACCEPT = ACCEPT_ATTR;
const MAX_BYTES = 4 * 1024 * 1024;

export default function UploadForm({ onResult }: { onResult: (r: ExtractResponse, file: File | null) => void }) {
  const [mode, setMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [timezone] = useState(() =>
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
  );

  function pickFile(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setError("That file is over 4 MB. Try a smaller file or paste the text instead.");
      return;
    }
    setFile(f);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("timezone", timezone);
    if (mode === "file") {
      if (!file) return setError("Choose a syllabus file first.");
      fd.set("file", file);
      fd.delete("text");
    } else if (!String(fd.get("text") ?? "").trim()) {
      return setError("Paste your syllabus text first.");
    }

    setLoading(true);
    try {
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ error: "Unexpected server response." }));
      if (!res.ok) {
        const msg = data.error ?? `Request failed (${res.status})`;
        throw new Error(data.details ? `${msg} (${data.details})` : msg);
      }
      onResult(data as ExtractResponse, mode === "file" ? file : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const field =
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-800 w-fit">
        {(["file", "text"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              mode === m ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {m === "file" ? "Upload file" : "Paste text"}
          </button>
        ))}
      </div>

      {mode === "file" ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files[0]);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
            dragging
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
              : "border-zinc-300 hover:border-indigo-400 dark:border-zinc-700"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          {file ? (
            <>
              <p className="font-medium">{file.name}</p>
              <p className="mt-1 text-sm text-zinc-500">{(file.size / 1024).toFixed(0)} KB · click to change</p>
            </>
          ) : (
            <>
              <p className="font-medium">Drop your syllabus here or click to browse</p>
              <p className="mt-1 text-sm text-zinc-500">PDF, Word, web page, photo, or text · up to 4 MB</p>
            </>
          )}
        </div>
      ) : (
        <textarea
          name="text"
          rows={10}
          placeholder="Paste the full syllabus text here…"
          className={`${field} font-mono`}
        />
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60"
      >
        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
        {loading ? "Reading your syllabus…" : "Find dates"}
      </button>
    </form>
  );
}
