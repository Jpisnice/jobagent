<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { HTMLAttributes } from "svelte/elements";
  import { ConversationScroll, setConversation } from "./context.svelte.ts";

  let { class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> = $props();

  const scroll = setConversation(new ConversationScroll());

  let viewport: HTMLDivElement | undefined = $state();
  let content: HTMLDivElement | undefined = $state();

  function onScroll() {
    if (!viewport) return;
    scroll.atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
  }

  // Follow new content while you're at the bottom; stay put once you scroll up to read.
  $effect(() => {
    if (!viewport || !content) return;
    scroll.viewport = viewport;
    scroll.scrollToBottom("instant");
    const observer = new ResizeObserver(() => {
      if (scroll.atBottom) scroll.scrollToBottom("instant");
    });
    observer.observe(content);
    return () => observer.disconnect();
  });
</script>

<div
  bind:this={viewport}
  onscroll={onScroll}
  role="log"
  class={cn("relative min-h-0 flex-1 overflow-y-auto", className)}
  {...rest}
>
  <div bind:this={content} class="flex min-h-full flex-col">
    {@render children?.()}
  </div>
</div>
