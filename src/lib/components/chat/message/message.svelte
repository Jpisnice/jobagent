<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { HTMLAttributes } from "svelte/elements";
  import { type MessageFrom, setMessageFrom } from "./context.ts";

  let {
    from,
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLElement> & { from: MessageFrom } = $props();

  setMessageFrom(() => from);
</script>

<article
  data-from={from}
  class={cn("group/message flex w-full flex-col gap-1.5", from === "user" ? "items-end" : "items-start", className)}
  {...rest}
>
  {@render children?.()}
</article>
