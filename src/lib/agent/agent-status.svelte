<script lang="ts">
  import StatusDot, { type StatusTone } from "#lib/components/chat/status-dot.svelte";
  import { cn } from "#lib/utils.ts";
  import type { ConversationState, UseEveAgentReturn } from "eve/svelte";
  import { openConversationInputs } from "eve/svelte";
  import { type StreamInsights, allToolParts, isToolRunning, toolPhrase } from "./format.ts";

  let {
    agent,
    labels,
    class: className,
  }: { agent: UseEveAgentReturn<ConversationState>; labels: StreamInsights["labels"]; class?: string } = $props();

  const waitingOnYou = $derived(openConversationInputs(agent.data).length > 0);

  // The most specific thing the agent is doing right now, in plain words.
  const activity = $derived.by((): { tone: StatusTone; label: string } => {
    const status = agent.status;
    if (status === "error") return { tone: "error", label: "Disconnected" };
    if (status === "resuming") return { tone: "working", label: "Reconnecting" };
    if (waitingOnYou) return { tone: "attention", label: "Waiting for you" };
    if (status === "submitted") return { tone: "working", label: "Reading your message" };
    if (status === "streaming") {
      const running = allToolParts(agent.data.messages).filter((part) => isToolRunning(part.state));
      const last = running.at(-1);
      if (last) return { tone: "working", label: toolPhrase(last, labels) };
      const lastMessage = agent.data.messages.at(-1);
      const lastPart = lastMessage?.role === "assistant" ? lastMessage.parts.at(-1) : undefined;
      if (lastPart?.type === "reasoning" && lastPart.state === "streaming") return { tone: "working", label: "Thinking" };
      if (lastPart?.type === "text" && lastPart.state === "streaming") return { tone: "working", label: "Writing" };
      const turnId = agent.data.activeTurnId;
      if (turnId && agent.data.turns[turnId]?.waiting) return { tone: "working", label: "Waiting on background work" };
      return { tone: "working", label: "Working" };
    }
    if (Object.values(agent.data.turns).at(-1)?.status === "failed") return { tone: "error", label: "Last reply failed" };
    return { tone: "idle", label: "Ready" };
  });
</script>

<span class={cn("inline-flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground", className)} aria-live="polite">
  <StatusDot tone={activity.tone} />
  <span class={cn("truncate", activity.tone === "attention" && "font-medium text-attention-foreground")}>
    {activity.label}
  </span>
</span>
