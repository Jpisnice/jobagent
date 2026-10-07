<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { HTMLAttributes } from "svelte/elements";

  let { class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<!-- Shown on hover or focus where there is hover; always shown on touch screens. -->
<div
  class={cn(
    "-ml-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
    className,
  )}
  {...rest}
>
  {@render children?.()}
</div>
