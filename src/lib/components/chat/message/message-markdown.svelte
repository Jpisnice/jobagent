<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import { splitBlocks } from "../markdown.ts";
  import MarkdownBlock from "./markdown-block.svelte";

  let {
    text,
    streaming = false,
    class: className,
  }: {
    text: string;
    /** More text is still arriving. */
    streaming?: boolean;
    class?: string;
  } = $props();

  // While text streams in, each finished paragraph is its own block: it renders once and its
  // DOM stays put, and only the paragraph being written re-renders. Finished text renders whole,
  // so lists and links that span blank lines come out right.
  const blocks = $derived(streaming ? splitBlocks(text) : [text]);
</script>

<div class={cn("prose prose-chat dark:prose-invert", streaming && "caret", className)}>
  {#each blocks as block, index (index)}
    <MarkdownBlock text={block} />
  {/each}
</div>
