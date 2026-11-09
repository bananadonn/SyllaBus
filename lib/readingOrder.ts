/**
 * ONE definition of the order a person reads an HTML document in. Both the server (building the text
 * the AI reads and the quote check uses) and the browser preview (finding quotes to highlight) walk
 * documents with this, so a quote that exists for one exists for the other.
 *
 * Tables are read row by row, cell by cell, and each cell top to bottom, exactly as on the page. (The
 * old converter laid tables out as columns, mixing lines from different cells into phrases that don't
 * exist in the document.)
 */

export interface TreeAdapter<N> {
  isText(n: N): boolean;
  text(n: N): string;
  /** Upper-case tag name, or null for non-elements (comments, etc.). */
  tag(n: N): string | null;
  children(n: N): readonly N[];
}

/**
 * - line: a new line (block element or <br>)
 * - soft: a line break *inside* a table cell (keeps the row together)
 * - cell: end of a table cell
 * - row:  end of a table row
 */
export type BreakKind = "line" | "soft" | "cell" | "row";

interface ReadingSink<N> {
  text(node: N, data: string): void;
  brk(kind: BreakKind): void;
}

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "SVG", "MATH", "BUTTON", "SELECT"]);
const BLOCK = new Set(
  (
    "P DIV LI UL OL DL DT DD H1 H2 H3 H4 H5 H6 SECTION ARTICLE HEADER FOOTER MAIN NAV ASIDE PRE BLOCKQUOTE " +
    "FIGURE FIGCAPTION ADDRESS HR TABLE THEAD TBODY TFOOT CAPTION BODY HTML CENTER FORM FIELDSET DETAILS SUMMARY"
  ).split(" "),
);

export function walkReadingOrder<N>(root: N, a: TreeAdapter<N>, sink: ReadingSink<N>): void {
  let cellDepth = 0;
  const visit = (n: N) => {
    if (a.isText(n)) {
      sink.text(n, a.text(n));
      return;
    }
    const tag = a.tag(n);
    if (tag === null) {
      a.children(n).forEach(visit); // documents / fragments
      return;
    }
    if (SKIP.has(tag)) return;
    if (tag === "BR") {
      sink.brk(cellDepth ? "soft" : "line");
      return;
    }
    if (tag === "TD" || tag === "TH") {
      cellDepth++;
      a.children(n).forEach(visit);
      cellDepth--;
      sink.brk("cell");
      return;
    }
    if (tag === "TR") {
      a.children(n).forEach(visit);
      sink.brk("row");
      return;
    }
    const block = BLOCK.has(tag);
    const kind: BreakKind = cellDepth ? "soft" : "line";
    if (block) sink.brk(kind);
    a.children(n).forEach(visit);
    if (block) sink.brk(kind);
  };
  visit(root);
}
