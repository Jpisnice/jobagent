<script lang="ts" module>
  export type StatusTone = "idle" | "working" | "attention" | "error";
</script>

<script lang="ts">
  import { cn } from "#lib/utils.ts";

  let { tone, class: className }: { tone: StatusTone; class?: string } = $props();

  const COLOR: Record<StatusTone, string> = {
    idle: "bg-success",
    working: "bg-foreground/70",
    attention: "bg-attention",
    error: "bg-destructive",
  };
</script>

<span class={cn("relative flex size-2 shrink-0", className)} aria-hidden="true">
  {#if tone === "working" || tone === "attention"}
    <span class="absolute inline-flex size-full animate-ping rounded-full opacity-50 motion-reduce:hidden {COLOR[tone]}"
    ></span>
  {/if}
  <span class="relative inline-flex size-2 rounded-full {COLOR[tone]}"></span>
</span>
