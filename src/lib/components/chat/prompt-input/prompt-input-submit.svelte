<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import { cn } from "#lib/utils.ts";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import { getPromptInput } from "./context.ts";

  let { label = "Send", class: className }: { label?: string; class?: string } = $props();

  const input = getPromptInput();
</script>

<Button
  type="submit"
  size="icon"
  disabled={!input.canSubmit}
  aria-label={label}
  class={cn("rounded-full disabled:opacity-25", className)}
>
  <ArrowUpIcon class="size-4" strokeWidth={2.4} />
</Button>
