<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { HTMLAttributes } from "svelte/elements";

  let { class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div class={cn("flex items-center justify-between gap-3 py-2 pr-2 pl-4", className)} {...rest}>
  {@render children?.()}
</div>
