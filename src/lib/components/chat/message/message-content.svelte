<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { HTMLAttributes } from "svelte/elements";
  import { getMessageFrom } from "./context.ts";

  let { class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> = $props();

  const from = getMessageFrom();
</script>

<!-- Your words sit in a bubble; the agent's read as the page itself. -->
<div
  class={cn(
    from() === "user"
      ? "max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words"
      : "flex w-full min-w-0 flex-col gap-4",
    className,
  )}
  {...rest}
>
  {@render children?.()}
</div>
