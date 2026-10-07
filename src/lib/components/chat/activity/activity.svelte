<script lang="ts">
  import * as Collapsible from "#lib/components/ui/collapsible/index.js";
  import { cn } from "#lib/utils.ts";
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    class: className,
    children,
  }: { open?: boolean; class?: string; children: Snippet } = $props();
</script>

<Collapsible.Root bind:open class={cn("w-full", className)} aria-label="Agent activity">
  {@render children()}
</Collapsible.Root>
