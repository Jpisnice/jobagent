<script lang="ts">
  import type { ConversationState } from "eve/svelte";
  import { onDestroy } from "svelte";
  import JsonBlock from "./JsonBlock.svelte";
  import WorkLog from "./WorkLog.svelte";
  import {
    type StreamInsights,
    type WorkPart,
    formatDuration,
    inputPreview,
    segmentParts,
    toolPhrase,
  } from "./format.ts";

  let {
    part,
    conversation,
    insights,
    last,
    running,
    fresh,
  }: {
    part: WorkPart;
    conversation: ConversationState;
    insights: Pick<StreamInsights, "calls" | "labels">;
    last: boolean;
    running: boolean;
    fresh: boolean;
  } = $props();

  let open = $state(false);

  const tool = $derived(part.type === "dynamic-tool" ? part : undefined);
  const timing = $derived(tool ? insights.calls.get(tool.toolCallId) : undefined);

  // Tick only while this call runs, so its time counts up live.
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    if (running && timer === undefined) {
      timer = setInterval(() => (now = Date.now()), 200);
    } else if (!running && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  });
  onDestroy(() => clearInterval(timer));

  const elapsed = $derived.by(() => {
    if (!timing) return undefined;
    const end = timing.endedAt ?? (running ? now : undefined);
    return end === undefined ? undefined : end - timing.startedAt;
  });

  const title = $derived(
    tool ? toolPhrase(tool, insights.labels) : running ? "Thinking it through" : "Thought it through",
  );
  const preview = $derived.by(() => {
    if (!tool) return "";
    if (tool.toolMetadata?.eve?.kind === "load-skill") return "";
    return tool.state === "input-streaming" ? tool.inputText.slice(0, 90) : inputPreview(tool.input, 90);
  });
  const failed = $derived(tool?.state === "output-error");

  // A subagent call opens a child session; show its work nested under this row.
  const child = $derived.by(() => {
    if (!tool || tool.toolMetadata?.eve?.kind !== "subagent-call") return undefined;
    const sessions = Object.values(conversation.agents);
    const session =
      sessions.find((candidate) => candidate.callId === tool.toolCallId) ??
      (() => {
        const task = Object.values(conversation.tasks).find((t) => tool.toolCallId in t.calls);
        return task ? sessions.find((candidate) => candidate.taskId === task.taskId) : undefined;
      })();
    if (!session || !("conversation" in session.observation) || !session.observation.conversation) return undefined;
    const childConversation = session.observation.conversation;
    const parts = childConversation.messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.parts);
    return { name: session.name, conversation: childConversation, segments: segmentParts(parts) };
  });
  const showChild = $derived(child !== undefined && child.segments.length > 0 && (running || open));
</script>

<li class="relative flex gap-3 py-1.5 {fresh ? 'arrive' : ''}">
  <!-- The rail joins the steps in the order they ran. -->
  {#if !last}
    <span class="absolute top-6 bottom-[-6px] left-[9px] w-px bg-rule" aria-hidden="true"></span>
  {/if}
  <span class="relative z-10 mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full bg-sheet" aria-hidden="true">
    {#if running}
      <span class="size-[15px] animate-spin rounded-full border-2 border-pen/20 border-t-pen"></span>
    {:else if failed}
      <span class="grid size-[15px] place-items-center rounded-full bg-brick text-white">
        <svg class="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"
          ><path d="M7 7l10 10M17 7 7 17" /></svg
        >
      </span>
    {:else if part.type === "reasoning"}
      <span class="size-[7px] rounded-full border-[1.5px] border-faint"></span>
    {:else}
      <span class="size-[7px] rounded-full bg-sage"></span>
    {/if}
  </span>

  <div class="min-w-0 flex-1">
    <button
      type="button"
      class="flex w-full items-baseline gap-3 rounded-md text-left"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <span class="min-w-0 flex-1">
        <span class="text-[14px] {running ? 'text-ink' : failed ? 'text-brick' : 'text-ink/85'}">{title}</span>
        {#if preview}
          <span class="ml-1.5 truncate text-[13px] text-faint">{preview}</span>
        {/if}
      </span>
      {#if elapsed !== undefined}
        <span class="shrink-0 text-[12.5px] text-faint tabular-nums">{formatDuration(elapsed)}</span>
      {/if}
    </button>

    {#if part.type === "reasoning" && (open || running) && part.text.trim()}
      <p class="mt-1.5 max-h-56 overflow-auto pr-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-pencil">
        {part.text}
      </p>
    {/if}

    {#if showChild && child}
      <div class="mt-2 space-y-2">
        {#each child.segments as segment (segment.key)}
          {#if segment.kind === "work"}
            <WorkLog parts={segment.parts} conversation={child.conversation} {insights} {fresh} />
          {:else if segment.kind === "text"}
            <p class="text-[13.5px] leading-relaxed whitespace-pre-wrap text-pencil">{segment.part.text}</p>
          {/if}
        {/each}
      </div>
    {/if}

    {#if open && tool}
      <div class="mt-2 mb-1 grid gap-3">
        {#if tool.state === "input-streaming"}
          <JsonBlock label="Input so far" value={tool.inputText} />
        {:else}
          <JsonBlock label="Input" value={tool.input} />
        {/if}
        {#if tool.state === "output-available"}
          <JsonBlock label={tool.partial ? "Output so far" : "Output"} value={tool.output} />
        {:else if tool.state === "output-error"}
          <JsonBlock label="Error" value={tool.errorText} tone="bad" />
        {/if}
        <p class="text-[12px] text-faint">{tool.toolName}, call {tool.toolCallId}</p>
      </div>
    {/if}
  </div>
</li>
