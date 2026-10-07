<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { Snippet } from "svelte";
  import { setOptionsLayout } from "./context.ts";

  let {
    layout = "row",
    class: className,
    children,
  }: {
    /** `row` for short choices as buttons; `list` for choices that each carry a description. */
    layout?: "row" | "list";
    class?: string;
    children: Snippet;
  } = $props();

  setOptionsLayout(() => layout);
</script>

<div role="group" class={cn("mt-4", layout === "row" ? "flex flex-wrap gap-2" : "grid gap-2", className)}>
  {@render children()}
</div>
