<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { Snippet } from "svelte";

  let { class: className, children }: { class?: string; children: Snippet } = $props();
</script>

<p class={cn("mt-1 text-sm text-pretty text-muted-foreground", className)}>
  {@render children()}
</p>
