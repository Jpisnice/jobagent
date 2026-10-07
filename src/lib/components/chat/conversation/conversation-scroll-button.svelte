<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import { cn } from "#lib/utils.ts";
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import { getConversation } from "./context.svelte.ts";

  let { class: className }: { class?: string } = $props();

  const scroll = getConversation();
</script>

<!-- Sticks to the bottom of the scroller, so it floats above the latest message. -->
<div class={cn("pointer-events-none sticky bottom-3 flex justify-center", className)}>
  {#if !scroll.atBottom}
    <Button
      variant="outline"
      size="icon"
      class="pointer-events-auto rounded-full shadow-md animate-in fade-in-0 zoom-in-95"
      aria-label="Scroll to the latest message"
      onclick={() => scroll.scrollToBottom()}
    >
      <ArrowDownIcon />
    </Button>
  {/if}
</div>
