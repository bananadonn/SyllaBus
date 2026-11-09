"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "unpdf/pdfjs";
import { detectFormat, type SourceFormat } from "@/lib/formats";
import { fnv1a } from "@/lib/hash";
import { collectDomSegments } from "@/lib/domText";
import { TextIndex } from "@/lib/locate";

/** Short key for a quote, stored in data-q attributes on its highlights. */
const qkey = (quote: string) => `q${fnv1a(quote)}`;

export interface PreviewFocus {
  /** The item's quote first (that's where we scroll), then its date quote if any. */
  quotes: string[];
  /** Changes on every click so clicking the same quote again re-scrolls and re-flashes. */
  nonce: number;
}

interface Props {
  file: File | null;
  text: string;
  quotes: string[];
  focus: PreviewFocus | null;
  onHighlightClick: (quote: string) => void;
}


/** Scrolls to the focused item's highlight (or its date if the item isn't found) and flashes both. */
function useFocusScroll(focus: PreviewFocus | null, container: React.RefObject<HTMLElement | null>, ready: boolean) {
  const [flash, setFlash] = useState<PreviewFocus | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    if (!focus || !ready) return;
    const find = (q: string) => container.current?.querySelector<HTMLElement>(`[data-q~="${qkey(q)}"]`) ?? null;
    const els = focus.quotes.map(find);
    /* eslint-disable react-hooks/set-state-in-effect -- reacting to an external click event */
    setMissing(focus.quotes.filter((_, i) => !els[i]));
    const el = els.find(Boolean);
    if (!el) return;
    setFlash(focus);
    /* eslint-enable react-hooks/set-state-in-effect */
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [focus, ready, container]);
  return { flashQuotes: flash?.quotes ?? [], missing };
}

const hit = (list: string[] | undefined, quotes: string[]) => !!list && quotes.some((q) => list.includes(q));

/**
 * Picks the most faithful view for each format:
 *   PDF → real rendered pages · DOCX / HTML / Markdown → formatted document · image → the photo
 *   TXT / RTF / pasted text (and anything that fails to render) → the extracted text
 */
export default function SyllabusPreview(props: Props) {
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  const format = props.file ? detectFormat(props.file.name, props.file.type) : null;
  const file = props.file!;

  let body: React.ReactNode;
  if (failed || !format) body = <TextPreview {...props} />;
  else if (format === "pdf") body = <PdfPreview {...props} file={file} onFail={onFail} />;
  else if (format === "docx" || format === "html" || format === "markdown")
    body = <DocumentPreview {...props} file={file} format={format} onFail={onFail} />;
  else if (format === "image") body = <ImagePreview file={file} onFail={onFail} />;
  else body = <TextPreview {...props} />;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <span className="truncate font-medium">{props.file?.name ?? "Your syllabus"}</span>
        <span className="shrink-0 text-xs text-zinc-500">
          {format === "image" ? "Original photo" : "Click a highlight to see its date"}
        </span>
      </div>
      {body}
    </div>
  );
}

function Missing({ quotes }: { quotes: string[] }) {
  if (!quotes.length) return null;
  const list = quotes.map((q) => `\u201c${q.length > 80 ? q.slice(0, 80) + "\u2026" : q}\u201d`).join(" and ");
  return (
    <p className="sticky top-0 z-20 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      We couldn&rsquo;t find {list} in the document. The AI may have reworded it, so double-check this item.
    </p>
  );
}

const markClass = (active: boolean, flashing: boolean) =>
  `cursor-pointer rounded-sm transition-colors ${
    flashing
      ? "bg-orange-400/70 ring-4 ring-orange-400/60"
      : active
        ? "bg-orange-300/60"
        : "bg-yellow-300/50 hover:bg-yellow-400/70"
  }`;

/* ------------------------------ Text preview ------------------------------ */

function TextPreview({ text, quotes, focus, onHighlightClick }: Props) {
  const container = useRef<HTMLDivElement>(null);

  // Split the text into pieces at every highlight boundary; each piece knows which quotes cover it.
  const pieces = useMemo(() => {
    const index = new TextIndex([text]);
    const ranges = quotes
      .map((q) => ({ q, span: index.find(q) }))
      .filter((r) => r.span)
      .map((r) => ({ q: r.q, start: r.span!.start.off, end: r.span!.end.off }));
    const cuts = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b);
    const out: { text: string; quotes: string[] }[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const [a, b] = [cuts[i], cuts[i + 1]];
      out.push({ text: text.slice(a, b), quotes: ranges.filter((r) => r.start <= a && r.end >= b).map((r) => r.q) });
    }
    return out;
  }, [text, quotes]);

  const { flashQuotes, missing } = useFocusScroll(focus, container, true);

  if (!text) {
    return <p className="p-6 text-sm text-zinc-500">No text preview is available for this file.</p>;
  }

  return (
    <div ref={container} className="relative flex-1 overflow-auto">
      <Missing quotes={missing} />
      <div className="m-4 whitespace-pre-wrap rounded-lg bg-white p-6 text-sm leading-relaxed text-zinc-800 shadow-sm dark:bg-zinc-950 dark:text-zinc-200">
        {pieces.map((p, i) =>
          p.quotes.length ? (
            <mark
              key={i}
              data-q={p.quotes.map(qkey).join(" ")}
              onClick={() => onHighlightClick(p.quotes[0])}
              className={`text-inherit ${markClass(hit(focus?.quotes, p.quotes), hit(flashQuotes, p.quotes))}`}
            >
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </div>
    </div>
  );
}

/* ------------------------------- PDF preview ------------------------------ */

interface ItemBox {
  page: number;
  str: string;
  left: number; // all in % of the page
  top: number;
  width: number;
  height: number;
}

interface PageInfo {
  width: number;
  height: number;
}

const RENDER_SCALE = 2; // crisp on high-DPI screens; displayed size is set by CSS
const MAX_PAGES = 40;

function PdfPreview({ file, quotes, focus, onHighlightClick, onFail }: Props & { file: File; onFail: () => void }) {
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [segments, setSegments] = useState<{ strs: string[]; boxes: (ItemBox | null)[] } | null>(null);
  const [rendered, setRendered] = useState(false);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const container = useRef<HTMLDivElement>(null);

  // Load the PDF and its text positions.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getDocumentProxy } = await import("unpdf");
        const doc = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
        if (cancelled) return;
        docRef.current = doc;
        const infos: PageInfo[] = [];
        const strs: string[] = [];
        const boxes: (ItemBox | null)[] = [];
        const n = Math.min(doc.numPages, MAX_PAGES);
        for (let p = 1; p <= n; p++) {
          const page = await doc.getPage(p);
          const vp = page.getViewport({ scale: 1 });
          infos.push({ width: vp.width, height: vp.height });
          const content = await page.getTextContent();
          for (const it of content.items) {
            if (!("str" in it)) continue;
            const [, , c, d, e, f] = it.transform as number[];
            const fh = Math.hypot(c, d) || it.height || 10;
            const [x1, y1] = vp.convertToViewportPoint(e, f - fh * 0.25) as number[];
            const [x2, y2] = vp.convertToViewportPoint(e + it.width, f + fh * 0.9) as number[];
            strs.push(it.str + (it.hasEOL ? "\n" : ""));
            boxes.push({
              page: p - 1,
              str: it.str,
              left: (Math.min(x1, x2) / vp.width) * 100,
              top: (Math.min(y1, y2) / vp.height) * 100,
              width: (Math.abs(x2 - x1) / vp.width) * 100,
              height: (Math.abs(y2 - y1) / vp.height) * 100,
            });
          }
          // Page break: same as the blank lines between pages on the server.
          strs.push("\n\n");
          boxes.push(null);
        }
        if (cancelled) return;
        setPages(infos);
        setSegments({ strs, boxes });
      } catch (err) {
        console.error("PDF preview failed", err);
        if (!cancelled) onFail();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, onFail]);

  // Draw each page onto its canvas once the canvases exist.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !pages.length) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < pages.length && !cancelled; i++) {
        const canvas = canvases.current[i];
        if (!canvas) continue;
        const page = await doc.getPage(i + 1);
        const vp = page.getViewport({ scale: RENDER_SCALE });
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      }
      if (!cancelled) setRendered(true);
    })().catch((err) => {
      console.error("PDF render failed", err);
      onFail();
    });
    return () => {
      cancelled = true;
    };
  }, [pages, onFail]);

  // Highlight rectangles for each quote.
  const highlights = useMemo(() => {
    if (!segments) return [];
    const index = new TextIndex(segments.strs);
    const out: { quote: string; page: number; left: number; top: number; width: number; height: number }[] = [];
    for (const q of quotes) {
      const span = index.find(q);
      if (!span) continue;
      for (let s = span.start.seg; s <= span.end.seg; s++) {
        const box = segments.boxes[s];
        if (!box || !box.str.length) continue;
        const len = box.str.length;
        const from = s === span.start.seg ? Math.min(span.start.off, len) : 0;
        const to = s === span.end.seg ? Math.min(span.end.off, len) : len;
        if (to <= from) continue;
        out.push({
          quote: q,
          page: box.page,
          left: box.left + (box.width * from) / len,
          top: box.top,
          width: (box.width * (to - from)) / len,
          height: box.height,
        });
      }
    }
    return out;
  }, [segments, quotes]);

  const { flashQuotes, missing } = useFocusScroll(focus, container, !!segments);

  const noText = segments && segments.strs.every((s) => !s.trim());

  return (
    <div ref={container} className="relative flex-1 overflow-auto">
      <Missing quotes={missing} />
      {noText && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          This PDF is a scan, so we can&rsquo;t highlight where each date came from.
        </p>
      )}
      {!pages.length && <p className="p-6 text-sm text-zinc-500">Loading preview…</p>}
      <div className="space-y-4 p-4">
        {pages.map((pg, i) => (
          <div
            key={i}
            className="relative mx-auto w-full bg-white shadow-md"
            style={{ aspectRatio: `${pg.width} / ${pg.height}`, maxWidth: pg.width * 1.5 }}
          >
            <canvas
              ref={(el) => {
                canvases.current[i] = el;
              }}
              className={`absolute inset-0 h-full w-full transition-opacity ${rendered ? "opacity-100" : "opacity-0"}`}
              aria-label={`Page ${i + 1}`}
            />
            {highlights
              .filter((h) => h.page === i)
              .map((h, j) => (
                <button
                  key={j}
                  type="button"
                  title={h.quote}
                  data-q={qkey(h.quote)}
                  onClick={() => onHighlightClick(h.quote)}
                  className={`absolute mix-blend-multiply ${markClass(hit(focus?.quotes, [h.quote]), flashQuotes.includes(h.quote))}`}
                  style={{ left: `${h.left}%`, top: `${h.top}%`, width: `${h.width}%`, height: `${h.height}%` }}
                />
              ))}
            <span className="absolute bottom-1 right-2 text-[10px] text-zinc-400">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------ Formatted documents (DOCX / HTML / Markdown) ------------------------ */

const FRAME_CSS = `
  html { background: #fff; }
  body.sb-plain { margin: 0 auto; padding: 32px; max-width: 860px; font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2937; }
  body.sb-plain table { border-collapse: collapse; margin: 12px 0; }
  body.sb-plain td, body.sb-plain th { border: 1px solid #d4d4d8; padding: 4px 8px; vertical-align: top; }
  img { max-width: 100%; height: auto; }
  mark.sb-hl { background: rgba(253, 224, 71, .55); color: inherit; border-radius: 2px; cursor: pointer; transition: background .2s, box-shadow .2s; }
  mark.sb-hl:hover { background: rgba(250, 204, 21, .8); }
  mark.sb-hl.sb-active { background: rgba(253, 186, 116, .75); }
  mark.sb-hl.sb-flash { background: rgba(251, 146, 60, .85); box-shadow: 0 0 0 4px rgba(251, 146, 60, .45); }
`;

/** Turns the file into HTML. DOCX and Markdown get our clean document styling; HTML keeps its own look. */
async function toHtml(file: File, format: SourceFormat): Promise<{ html: string; plain: boolean }> {
  if (format === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return { html: value, plain: true };
  }
  if (format === "markdown") {
    const { marked } = await import("marked");
    return { html: await marked.parse(await file.text()), plain: true };
  }
  return { html: await file.text(), plain: false };
}

/** Builds the sandboxed page: sanitized body, the document's own <style> rules, plus our highlight CSS. */
async function buildSrcDoc(file: File, format: SourceFormat): Promise<string> {
  const [{ html, plain }, { default: DOMPurify }] = await Promise.all([toHtml(file, format), import("dompurify")]);
  const doc = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    FORBID_TAGS: ["base", "form", "iframe", "object", "embed"],
  }).ownerDocument!;
  const styles = [...doc.querySelectorAll("style")].map((s) => s.outerHTML).join("");
  const body = doc.body;
  body.classList.add(plain ? "sb-plain" : "sb-original");
  if (!plain && !styles) body.classList.add("sb-plain"); // unstyled HTML still gets readable defaults
  return `<!doctype html><html><head><meta charset="utf-8">${styles}<style>${FRAME_CSS}</style></head>${body.outerHTML}</html>`;
}

/** Wraps every quote's text in <mark data-q> inside the document and wires up clicks. */
function highlightDocument(doc: Document, quotes: string[], onClick: (quote: string) => void) {
  const { segs, nodes } = collectDomSegments(doc.body);

  // Collect per-text-node ranges for each quote (on the original, unsplit nodes).
  const index = new TextIndex(segs);
  const perNode = new Map<number, { from: number; to: number; key: string }[]>();
  const keyToQuote = new Map<string, string>();
  for (const q of quotes) {
    const span = index.find(q);
    if (!span) continue;
    const key = qkey(q);
    keyToQuote.set(key, q);
    for (let i = span.start.seg; i <= span.end.seg; i++) {
      const node = nodes[i];
      if (!node) continue;
      const from = i === span.start.seg ? span.start.off : 0;
      const to = i === span.end.seg ? span.end.off : node.data.length;
      if (to > from) perNode.set(i, [...(perNode.get(i) ?? []), { from, to, key }]);
    }
  }

  // Wrap pieces right-to-left so earlier offsets stay valid; overlapping quotes share one <mark>.
  for (const [i, ranges] of perNode) {
    const node = nodes[i]!;
    const cuts = [...new Set(ranges.flatMap((r) => [r.from, r.to]))].sort((a, b) => b - a);
    for (let c = 0; c < cuts.length - 1; c++) {
      const [end, start] = [cuts[c], cuts[c + 1]];
      const keys = ranges.filter((r) => r.from <= start && r.to >= end).map((r) => r.key);
      if (!keys.length) continue;
      const range = doc.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const mark = doc.createElement("mark");
      mark.className = "sb-hl";
      mark.dataset.q = keys.join(" ");
      range.surroundContents(mark);
    }
  }

  doc.addEventListener("click", (ev) => {
    const target = ev.target as Element | null;
    const mark = target?.closest?.("mark.sb-hl") as HTMLElement | null;
    if (mark) {
      const quote = keyToQuote.get(mark.dataset.q!.split(" ")[0]);
      if (quote) onClick(quote);
      return;
    }
    // Links open in a new tab instead of navigating the preview away.
    const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (a) {
      ev.preventDefault();
      if (/^https?:/i.test(a.href)) window.open(a.href, "_blank", "noopener,noreferrer");
    }
  });
}

function DocumentPreview({
  file,
  format,
  quotes,
  focus,
  onHighlightClick,
  onFail,
}: Props & { file: File; format: SourceFormat; onFail: () => void }) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const clickRef = useRef(onHighlightClick);
  useEffect(() => {
    clickRef.current = onHighlightClick;
  }, [onHighlightClick]);

  useEffect(() => {
    let cancelled = false;
    buildSrcDoc(file, format)
      .then((html) => !cancelled && setSrcDoc(html))
      .catch((err) => {
        console.error("Document preview failed", err);
        if (!cancelled) onFail();
      });
    return () => {
      cancelled = true;
    };
  }, [file, format, onFail]);

  const quotesKey = quotes.join("\u0000");
  const onLoad = () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    highlightDocument(doc, quotes, (q) => clickRef.current(q));
    setLoadedFor(quotesKey);
  };

  // Scroll to + flash the focused quote inside the frame.
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!focus || !doc || loadedFor !== quotesKey) return;
    doc.querySelectorAll("mark.sb-active").forEach((m) => m.classList.remove("sb-active", "sb-flash"));
    const perQuote = focus.quotes.map((q) => [...doc.querySelectorAll<HTMLElement>(`mark[data-q~="${qkey(q)}"]`)]);
    setMissing(focus.quotes.filter((_, i) => !perQuote[i].length));
    const marks = perQuote.flat();
    if (!marks.length) return;
    marks.forEach((m) => m.classList.add("sb-active", "sb-flash"));
    marks[0].scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => marks.forEach((m) => m.classList.remove("sb-flash")), 1600);
    return () => clearTimeout(t);
  }, [focus, loadedFor, quotesKey]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Missing quotes={missing} />
      {!srcDoc && <p className="p-6 text-sm text-zinc-500">Loading preview…</p>}
      {srcDoc && (
        <iframe
          key={quotesKey}
          ref={frame}
          title="Syllabus preview"
          srcDoc={srcDoc}
          onLoad={onLoad}
          // Same-origin lets us add highlights; without allow-scripts nothing in the document can run.
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          className="min-h-0 w-full flex-1 bg-white"
        />
      )}
    </div>
  );
}

/* ------------------------------- Image preview ------------------------------ */

function ImagePreview({ file, onFail }: { file: File; onFail: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URL lifecycle
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="flex-1 overflow-auto">
      <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        Photos can&rsquo;t be highlighted. Compare each date with the picture.
      </p>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL, not an optimizable asset
        <img src={url} alt="Your syllabus" onError={onFail} className="mx-auto block w-full max-w-3xl p-4" />
      )}
    </div>
  );
}
