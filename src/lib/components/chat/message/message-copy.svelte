<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import MessageAction from "./message-action.svelte";

  let { text }: { text: string } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard can be blocked outside a secure context.
    }
  }
</script>

<MessageAction label={copied ? "Copied" : "Copy"} onclick={copy}>
  {#if copied}<CheckIcon />{:else}<CopyIcon />{/if}
</MessageAction>
