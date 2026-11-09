import { parseDocument } from "htmlparser2";
import type { ChildNode, Document, Element } from "domhandler";
import { type BreakKind, type TreeAdapter, walkReadingOrder } from "../readingOrder";

type N = Document | ChildNode;

const adapter: TreeAdapter<N> = {
  isText: (n) => n.type === "text",
  text: (n) => (n as { data: string }).data,
  tag: (n) => (n.type === "tag" || n.type === "script" || n.type === "style" ? (n as Element).name.toUpperCase() : null),
  children: (n) => ("children" in n ? (n.children as ChildNode[]) : []),
};

function findBody(n: N): N | null {
  if ((n.type === "tag") && (n as Element).name.toLowerCase() === "body") return n;
  for (const c of adapter.children(n)) {
    const b = findBody(c);
    if (b) return b;
  }
  return null;
}

/**
 * HTML → readable text in true reading order. Table rows stay on one line:
 *   "3 | Sep 14, 16 | The Web and HTTP. … / Wireshark Lab 1: HTTP | Ch 2 / §2.2"
 */
export function htmlToText(html: string): string {
  const doc = parseDocument(html);
  const root = findBody(doc) ?? doc;
  let out = "";
  const SEP: Record<BreakKind, string> = { line: "\n", soft: " / ", cell: " | ", row: "\n" };
  walkReadingOrder(root, adapter, {
    text: (_n, data) => {
      out += data.replace(/\s+/g, " ");
    },
    brk: (kind) => {
      // A soft break right after another break (or at the start of a cell/line) adds nothing.
      if (kind === "soft" && /(?:\s\/\s|\s\|\s|\n)\s*$|^\s*$/.test(out)) return;
      out += SEP[kind];
    },
  });
  return out
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/( \/ )+/g, " / ") // repeated soft breaks
        .replace(/ \/ \|/g, " |") // soft break right before a cell end
        .replace(/\| \/ /g, "| ") // soft break right after a cell start
        .replace(/^( ?\/ ?)+|( ?\/ ?)+$/g, "") // soft breaks at line edges
        .replace(/(\s*\|\s*)+$/g, "") // trailing cell separators
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
