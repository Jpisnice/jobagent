<script lang="ts">
  import * as Activity from "#lib/components/chat/activity/index.ts";
  import CodeBlock from "#lib/components/chat/code-block.svelte";
  import type { ConversationState } from "eve/svelte";
  import { onDestroy } from "svelte";
  import AgentActivity from "./agent-activity.svelte";
  import {
    type StreamInsights,
    type WorkPart,
    formatDuration,
    inputPreview,
    prettyJson,
    segmentParts,
    toolPhrase,
  } from "./format.ts";

  let {
    part,
    conversation,
    insights,
    running,
    fresh,
  }: {
    part: WorkPart;
    conversation: ConversationState;
    insights: Pick<StreamInsights, "calls" | "labels">;
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
  const status = $derived(
    running ? "running" : tool?.state === "output-error" ? "failed" : tool ? "done" : "thought",
  );

  // A subagent call opens a child session; show its work nested under this step.
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
    return { conversation: childConversation, segments: segmentParts(parts) };
  });
  const showChild = $derived(child !== undefined && child.segments.length > 0 && (running || open));
  const hasDetails = $derived(tool !== undefined || (part.type === "reasoning" && part.text.trim().length > 0));
</script>

{#snippet details()}
  {#if part.type === "reasoning"}
    <p class="max-h-56 overflow-auto pr-2 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
      {part.text}
    </p>
  {:else if tool}
    {#if tool.state === "input-streaming"}
      <CodeBlock label="Input so far" code={prettyJson(tool.inputText)} />
    {:else}
      <CodeBlock label="Input" code={prettyJson(tool.input)} />
    {/if}
    {#if tool.state === "output-available"}
      <CodeBlock label={tool.partial ? "Output so far" : "Output"} code={prettyJson(tool.output)} />
    {:else if tool.state === "output-error"}
      <CodeBlock label="Error" code={prettyJson(tool.errorText)} tone="error" />
    {/if}
    <p class="text-xs text-muted-foreground">{tool.toolName}, call {tool.toolCallId}</p>
  {/if}
{/snippet}

{#snippet nested()}
  {#if showChild && child}
    <div class="flex flex-col gap-2">
      {#each child.segments as segment (segment.key)}
        {#if segment.kind === "work"}
          <AgentActivity parts={segment.parts} conversation={child.conversation} {insights} {fresh} />
        {:else if segment.kind === "text"}
          <p class="text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{segment.part.text}</p>
        {/if}
      {/each}
    </div>
  {/if}
  {#if part.type === "reasoning" && running && part.text.trim()}
    <p class="max-h-40 overflow-auto pr-2 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
      {part.text}
    </p>
  {/if}
{/snippet}

<Activity.Step
  bind:open
  {status}
  {title}
  preview={preview || undefined}
  duration={elapsed !== undefined ? formatDuration(elapsed) : undefined}
  details={hasDetails && !(part.type === "reasoning" && running) ? details : undefined}
  children={showChild || (part.type === "reasoning" && running) ? nested : undefined}
/>
