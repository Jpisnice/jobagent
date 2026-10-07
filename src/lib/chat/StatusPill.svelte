<script lang="ts">
  import type { ConversationState, UseEveAgentReturn } from "eve/svelte";
  import { openConversationInputs } from "eve/svelte";
  import { type StreamInsights, allToolParts, isToolRunning, toolPhrase } from "./format.ts";

  let {
    agent,
    labels,
  }: { agent: UseEveAgentReturn<ConversationState>; labels: StreamInsights["labels"] } = $props();

  const waitingOnYou = $derived(openConversationInputs(agent.data).length > 0);

  // The most specific thing the agent is doing right now, in plain words.
  const activity = $derived.by((): { tone: "idle" | "work" | "you" | "bad"; label: string } => {
    const status = agent.status;
    if (status === "error") return { tone: "bad", label: "Disconnected" };
    if (status === "resuming") return { tone: "work", label: "Reconnecting" };
    if (waitingOnYou) return { tone: "you", label: "Waiting for you" };
    if (status === "submitted") return { tone: "work", label: "Reading your message" };
    if (status === "streaming") {
      const running = allToolParts(agent.data.messages).filter((part) => isToolRunning(part.state));
      const last = running.at(-1);
      if (last) return { tone: "work", label: toolPhrase(last, labels) };
      const lastMessage = agent.data.messages.at(-1);
      const lastPart = lastMessage?.role === "assistant" ? lastMessage.parts.at(-1) : undefined;
      if (lastPart?.type === "reasoning" && lastPart.state === "streaming") return { tone: "work", label: "Thinking" };
      if (lastPart?.type === "text" && lastPart.state === "streaming") return { tone: "work", label: "Writing" };
      const turnId = agent.data.activeTurnId;
      if (turnId && agent.data.turns[turnId]?.waiting) return { tone: "work", label: "Waiting on background work" };
      return { tone: "work", label: "Working" };
    }
    return { tone: "idle", label: "Ready" };
  });

  const DOT = { idle: "bg-sage", work: "bg-pen", you: "bg-marigold", bad: "bg-brick" } as const;
</script>

<span class="inline-flex max-w-[18rem] min-w-0 items-center gap-2 text-[13.5px] text-pencil" aria-live="polite">
  <span class="relative flex size-2 shrink-0" aria-hidden="true">
    {#if activity.tone === "work" || activity.tone === "you"}
      <span class="absolute inline-flex size-full animate-ping rounded-full opacity-50 motion-reduce:hidden {DOT[activity.tone]}"
      ></span>
    {/if}
    <span class="relative inline-flex size-2 rounded-full {DOT[activity.tone]}"></span>
  </span>
  <span class="truncate {activity.tone === 'you' ? 'font-medium text-marigold-ink' : ''}">{activity.label}</span>
</span>
