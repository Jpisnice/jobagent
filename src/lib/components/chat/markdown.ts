import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

/** Renders markdown to sanitized HTML. Client-only: DOMPurify needs a DOM. */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false });
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Splits streaming markdown into top-level blocks at blank lines outside code fences. Every block
 * but the last is finished, so it only ever needs rendering once.
 */
export function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let fence: string | undefined;
  let start = 0;
  let offset = 0;
  for (const line of text.split("\n")) {
    const end = offset + line.length;
    const marker = FENCE.exec(line)?.[1];
    if (marker && (fence === undefined || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence === undefined ? marker : undefined;
    } else if (fence === undefined && line.trim() === "" && end > start) {
      // Up to the newline that ends the previous line.
      const block = text.slice(start, Math.max(start, offset - 1));
      if (block.trim()) blocks.push(block);
      start = end + 1;
    }
    offset = end + 1;
  }
  const tail = text.slice(start);
  if (tail.trim() || blocks.length === 0) blocks.push(tail);
  return blocks;
}
