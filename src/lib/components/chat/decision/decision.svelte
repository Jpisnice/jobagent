<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { Snippet } from "svelte";
  import { setDecisionOpen } from "./context.ts";

  let {
    open,
    class: className,
    children,
  }: {
    /** Waiting on you. Only an open decision uses the attention color. */
    open: boolean;
    class?: string;
    children: Snippet;
  } = $props();

  setDecisionOpen(() => open);
</script>

<section
  class={cn(
    "relative overflow-hidden rounded-xl border transition-[border-color,box-shadow,background-color] duration-300",
    open ? "border-attention/60 bg-card shadow-sm ring-4 ring-attention/10" : "bg-muted/30",
    className,
  )}
  aria-live={open ? "polite" : undefined}
>
  <span
    class={cn("absolute inset-y-0 left-0 w-1 transition-colors duration-300", open ? "bg-attention" : "bg-border")}
    aria-hidden="true"
  ></span>
  <div class="py-4 pr-4 pl-5 sm:pr-5 sm:pl-6">
    {@render children()}
  </div>
</section>
