<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { Snippet } from "svelte";
  import { getDecisionOpen } from "./context.ts";

  let { class: className, children }: { class?: string; children: Snippet } = $props();

  const open = getDecisionOpen();
</script>

<p
  class={cn(
    "flex items-center gap-2 text-[13px]",
    open() ? "font-medium text-attention-foreground" : "text-muted-foreground",
    className,
  )}
>
  {#if open()}
    <span class="relative flex size-2" aria-hidden="true">
      <span class="absolute inline-flex size-full animate-ping rounded-full bg-attention opacity-60 motion-reduce:hidden"
      ></span>
      <span class="relative inline-flex size-2 rounded-full bg-attention"></span>
    </span>
  {/if}
  {@render children()}
</p>
