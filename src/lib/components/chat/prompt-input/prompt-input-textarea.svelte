<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import { getPromptInput } from "./context.ts";

  let {
    ref = $bindable(null),
    maxHeight = 240,
    class: className,
    ...rest
  }: Omit<HTMLTextareaAttributes, "value"> & { ref?: HTMLTextAreaElement | null; maxHeight?: number } = $props();

  const input = getPromptInput();

  // Grow with the content up to a cap, then scroll.
  $effect(() => {
    void input.value;
    if (!ref) return;
    ref.style.height = "auto";
    ref.style.height = `${Math.min(ref.scrollHeight, maxHeight)}px`;
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      input.submit();
    }
  }
</script>

<textarea
  bind:this={ref}
  bind:value={input.value}
  {onkeydown}
  rows="1"
  disabled={input.disabled}
  class={cn(
    "block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-60",
    className,
  )}
  style:max-height="{maxHeight}px"
  {...rest}
></textarea>
