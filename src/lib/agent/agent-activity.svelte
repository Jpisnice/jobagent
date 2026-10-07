<script lang="ts">
  import * as Activity from "#lib/components/chat/activity/index.ts";
  import { cn } from "#lib/utils.ts";
  import type { ConversationState } from "eve/svelte";
  import AgentActivityStep from "./agent-activity-step.svelte";
  import { type StreamInsights, type WorkPart, formatDuration, isToolRunning, toolPhrase } from "./format.ts";

  let {
    parts,
    conversation,
    insights,
    fresh = false,
  }: {
    parts: readonly WorkPart[];
    conversation: ConversationState;
    insights: Pick<StreamInsights, "calls" | "labels">;
    /** Arrived while you were watching. */
    fresh?: boolean;
  } = $props();

  function partRunning(part: WorkPart): boolean {
    return part.type === "reasoning"
      ? part.state === "streaming"
      : isToolRunning(part.state) || (part.state === "output-available" && part.partial === true);
  }

  const running = $derived(parts.some(partRunning));
  const tools = $derived(parts.filter((part) => part.type === "dynamic-tool"));
  const failed = $derived(tools.filter((part) => part.state === "output-error").length);

  // Open while work is happening; folds to one line once it's done, unless you opened it.
  let pinned = $state<boolean | undefined>();
  const open = $derived(pinned ?? running);

  const elapsed = $derived.by(() => {
    let start: number | undefined;
    let end: number | undefined;
    for (const part of tools) {
      const timing = insights.calls.get(part.toolCallId);
      if (!timing) continue;
      start = start === undefined ? timing.startedAt : Math.min(start, timing.startedAt);
      if (timing.endedAt !== undefined) end = end === undefined ? timing.endedAt : Math.max(end, timing.endedAt);
    }
    return start !== undefined && end !== undefined ? end - start : undefined;
  });

  const summary = $derived.by(() => {
    const current = parts.findLast(partRunning);
    if (current) {
      return current.type === "reasoning" ? "Thinking it through" : toolPhrase(current, insights.labels);
    }
    if (tools.length === 0) return "Thought it through";
    const first = toolPhrase(tools[0], insights.labels);
    if (tools.length === 1) return first;
    return `${first}, and ${tools.length - 1} more step${tools.length === 2 ? "" : "s"}`;
  });
</script>

<Activity.Root bind:open={() => open, (next) => (pinned = next)} class={cn(fresh && "arrive")}>
  <Activity.Trigger
    status={running ? "running" : failed > 0 ? "failed" : "done"}
    duration={!running && elapsed !== undefined ? formatDuration(elapsed) : undefined}
    note={!running && failed > 0 ? `${failed} failed` : undefined}
  >
    {summary}{running ? "…" : ""}
  </Activity.Trigger>
  <Activity.Content>
    {#each parts as part, index (part.type === "dynamic-tool" ? part.toolCallId : (part.id ?? `r${index}`))}
      <AgentActivityStep {part} {conversation} {insights} running={partRunning(part)} {fresh} />
    {/each}
  </Activity.Content>
</Activity.Root>
