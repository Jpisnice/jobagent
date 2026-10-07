<script lang="ts">
  import StatusDot from "#lib/components/chat/status-dot.svelte";
  import { cn } from "#lib/utils.ts";
  import type { AgentActivity } from "./activity.ts";

  let { activity, class: className }: { activity: AgentActivity; class?: string } = $props();
</script>

<span class={cn("inline-flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground", className)} aria-live="polite">
  <StatusDot tone={activity.tone} />
  <span class={cn("truncate", activity.tone === "attention" && "font-medium text-attention-foreground")}>
    {activity.label}
  </span>
</span>
