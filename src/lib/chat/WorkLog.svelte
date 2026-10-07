<script lang="ts">
  import type { ConversationState } from "eve/svelte";
  import WorkRow from "./WorkRow.svelte";
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
    /** Arrived while you were watching: reveal its rows as they come. */
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

<section
  class="overflow-hidden rounded-xl border border-rule bg-sheet/70 {fresh ? 'arrive' : ''}"
  aria-label="Agent activity"
>
  {#if parts.length === 1}
    <!-- One step needs no summary line; the step is the summary. -->
    <ol class="px-3.5 py-1.5">
      <WorkRow part={parts[0]} {conversation} {insights} last running={partRunning(parts[0])} fresh={false} />
    </ol>
  {:else}
  <button
    type="button"
    class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-well/60"
    aria-expanded={open}
    onclick={() => (pinned = !open)}
  >
    <span class="relative grid size-5 shrink-0 place-items-center" aria-hidden="true">
      {#if running}
        <span class="absolute inset-0 animate-spin rounded-full border-2 border-pen/20 border-t-pen"></span>
      {:else if failed > 0}
        <span class="size-2 rounded-full bg-brick"></span>
      {:else}
        <svg class="size-4 text-sage" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          ><path d="m5 12.5 4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round" /></svg
        >
      {/if}
    </span>
    <span class="min-w-0 flex-1 truncate text-[14px] {running ? 'text-ink' : 'text-pencil'}">
      {summary}{running ? "…" : ""}
    </span>
    {#if failed > 0 && !running}
      <span class="shrink-0 text-[12.5px] text-brick">{failed} failed</span>
    {/if}
    {#if elapsed !== undefined && !running}
      <span class="shrink-0 text-[12.5px] text-faint tabular-nums">{formatDuration(elapsed)}</span>
    {/if}
    <svg
      class="size-4 shrink-0 text-faint transition-transform duration-200 {open ? 'rotate-180' : ''}"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"><path d="m6 9 6 6 6-6" /></svg
    >
  </button>

  {#if open}
    <ol class="border-t border-rule px-3.5 py-2">
      {#each parts as part, index (part.type === "dynamic-tool" ? part.toolCallId : (part.id ?? `r${index}`))}
        <WorkRow
          {part}
          {conversation}
          {insights}
          last={index === parts.length - 1}
          running={partRunning(part)}
          {fresh}
        />
      {/each}
    </ol>
  {/if}
  {/if}
</section>
