import { walkReadingOrder } from "./readingOrder";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * The preview's view of a rendered document: its text nodes in reading order (the same walker the
 * server's htmlToText uses), with a "\n" separator segment (node = null) wherever there's a break.
 */
export function collectDomSegments(root: Node): { segs: string[]; nodes: (Text | null)[] } {
  const segs: string[] = [];
  const nodes: (Text | null)[] = [];
  walkReadingOrder<Node>(
    root,
    {
      isText: (n) => n.nodeType === TEXT_NODE,
      text: (n) => (n as Text).data,
      tag: (n) => (n.nodeType === ELEMENT_NODE ? (n as Element).tagName.toUpperCase() : null),
      children: (n) => Array.from(n.childNodes),
    },
    {
      text: (n, data) => {
        segs.push(data);
        nodes.push(n as Text);
      },
      brk: () => {
        if (segs.length && nodes[nodes.length - 1] !== null) {
          segs.push("\n");
          nodes.push(null);
        }
      },
    },
  );
  return { segs, nodes };
}
