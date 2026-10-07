<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { Snippet } from "svelte";
  import { getDecisionOpen } from "./context.ts";

  let { class: className, children }: { class?: string; children: Snippet } = $props();

  const open = getDecisionOpen();
</script>

<h3
  class={cn(
    "mt-2 leading-snug tracking-tight text-balance whitespace-pre-wrap",
    open() ? "text-lg font-semibold" : "text-[15px] font-medium",
    className,
  )}
>
  {@render children()}
</h3>
