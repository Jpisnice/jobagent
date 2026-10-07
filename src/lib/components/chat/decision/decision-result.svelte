<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { Snippet } from "svelte";

  let { class: className, children }: { class?: string; children: Snippet } = $props();
</script>

<div class={cn("mt-3 flex flex-wrap items-center gap-2 text-sm", className)}>
  {@render children()}
</div>
