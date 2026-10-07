<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import { cn } from "#lib/utils.ts";
  import CheckIcon from "@lucide/svelte/icons/check";
  import CopyIcon from "@lucide/svelte/icons/copy";

  let {
    label,
    code,
    tone = "default",
    class: className,
  }: { label: string; code: string; tone?: "default" | "error"; class?: string } = $props();

  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {
      // Clipboard can be blocked outside a secure context.
    }
  }
</script>

{#if code}
  <div class={cn("min-w-0 overflow-hidden rounded-lg border bg-muted/40", className)}>
    <div class="flex items-center justify-between border-b py-1 pr-1 pl-3">
      <span class="text-xs font-medium text-muted-foreground">{label}</span>
      <Button variant="ghost" size="icon-xs" aria-label={copied ? "Copied" : `Copy ${label.toLowerCase()}`} onclick={copy}>
        {#if copied}<CheckIcon />{:else}<CopyIcon />{/if}
      </Button>
    </div>
    <pre
      class={cn(
        "max-h-72 overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap",
        tone === "error" ? "text-destructive" : "text-foreground/90",
      )}>{code}</pre>
  </div>
{/if}
