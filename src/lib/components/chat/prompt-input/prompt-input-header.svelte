<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { HTMLAttributes } from "svelte/elements";

  let { class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div class={cn("flex min-w-0 items-center gap-2 px-4 pt-3 text-[13px]", className)} {...rest}>
  {@render children?.()}
</div>
