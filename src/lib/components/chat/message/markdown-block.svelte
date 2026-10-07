<script lang="ts">
  import { renderMarkdown } from "../markdown.ts";

  let { text }: { text: string } = $props();

  // Re-parses only when this block's own text changes.
  const html = $derived(renderMarkdown(text));
</script>

{@html html}
