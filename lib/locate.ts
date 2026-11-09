/**
 * Finds where a quote sits in a document made of text segments (a whole text, or PDF text items),
 * ignoring case, punctuation and whitespace differences. Shared by the server-side quote check and
 * the in-browser preview highlighter so both agree on what "found" means.
 */

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface Pos {
  seg: number;
  off: number;
}

interface Span {
  start: Pos;
  /** Exclusive end. */
  end: Pos;
}

export class TextIndex {
  /** Normalized text of all segments joined. */
  readonly norm: string;
  /** For each char of `norm`, the original segment/offset it came from. */
  private readonly map: Pos[];

  constructor(segments: string[]) {
    let norm = "";
    const map: Pos[] = [];
    let pendingSpace = false;
    segments.forEach((s, seg) => {
      for (let off = 0; off < s.length; off++) {
        const n = s[off].toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
        if (!n) {
          pendingSpace = norm.length > 0;
          continue;
        }
        if (pendingSpace) {
          norm += " ";
          map.push({ seg, off });
          pendingSpace = false;
        }
        for (const ch of n) {
          norm += ch;
          map.push({ seg, off });
        }
      }
      // Segments (PDF items) are joined with no separator, exactly like the server-side text.
    });
    this.norm = norm;
    this.map = map;
  }

  /** First occurrence of the quote, preferring a whole-word match. */
  find(quote: string): Span | null {
    const q = normalizeForMatch(quote);
    if (!q) return null;
    let i = -1;
    for (let from = 0; ; ) {
      const j = this.norm.indexOf(q, from);
      if (j < 0) break;
      const before = j === 0 || this.norm[j - 1] === " ";
      const after = j + q.length === this.norm.length || this.norm[j + q.length] === " ";
      if (before && after) {
        i = j;
        break;
      }
      if (i < 0) i = j; // remember a partial-word match as a fallback
      from = j + 1;
    }
    if (i < 0) return null;
    const last = this.map[i + q.length - 1];
    return { start: this.map[i], end: { seg: last.seg, off: last.off + 1 } };
  }
}

/** Whole-word check used by validation: does the quote appear in the (already normalized) text? */
export function quoteFoundInText(quote: string, normalizedText: string): boolean {
  const q = normalizeForMatch(quote);
  if (!q) return false;
  return ` ${normalizedText} `.includes(` ${q} `);
}
