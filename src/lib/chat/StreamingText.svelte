<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { renderMarkdown } from "./format.ts";

  let {
    text,
    streaming,
    animate,
  }: {
    text: string;
    /** More text is still arriving. */
    streaming: boolean;
    /** Reveal progressively; false for history, which renders whole. */
    animate: boolean;
  } = $props();

  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Characters on screen. The model sends text in bursts; revealing it at a steady pace that
  // speeds up with the backlog reads like writing instead of a series of jumps.
  let shown = $state(untrack(() => (animate && !reducedMotion ? 0 : text.length)));
  let frame: number | undefined;
  let last = 0;

  function tick(now: number) {
    const elapsed = last === 0 ? 16 : Math.min(now - last, 64);
    last = now;
    const backlog = text.length - shown;
    if (backlog <= 0) {
      frame = undefined;
      last = 0;
      return;
    }
    // About 70 characters a second at rest, faster as text piles up, and quick once the stream ends.
    const rate = 70 + backlog * (streaming ? 4 : 12);
    shown = Math.min(text.length, shown + Math.max(1, Math.round((rate * elapsed) / 1000)));
    frame = requestAnimationFrame(tick);
  }

  $effect(() => {
    const target = text.length;
    if (reducedMotion || !animate) {
      shown = target;
      return;
    }
    if (shown > target) shown = target;
    if (shown < target && frame === undefined) frame = requestAnimationFrame(tick);
  });

  onDestroy(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });

  const html = $derived(renderMarkdown(text.slice(0, shown)));
  const writing = $derived(streaming || shown < text.length);
</script>

<div class="prose prose-chat {writing ? 'caret' : ''}">
  {@html html}
</div>
