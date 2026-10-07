<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { HTMLAttributes } from "svelte/elements";

  let { class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<!-- The reading column; the composer uses the same width so the two line up. -->
<div class={cn("mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 pt-8 pb-12 sm:px-6", className)} {...rest}>
  {@render children?.()}
</div>
