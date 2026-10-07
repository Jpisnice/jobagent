<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    tone = "default",
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLParagraphElement> & { tone?: "default" | "error" } = $props();
</script>

<p
  class={cn(
    "min-w-0 truncate text-xs",
    tone === "error" ? "text-destructive" : "text-muted-foreground",
    className,
  )}
  {...rest}
>
  {@render children?.()}
</p>
