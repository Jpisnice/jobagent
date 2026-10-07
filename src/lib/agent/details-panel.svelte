<script lang="ts">
  import CodeBlock from "#lib/components/chat/code-block.svelte";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import { cn } from "#lib/utils.ts";
  import CheckIcon from "@lucide/svelte/icons/check";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import type { ConversationState, UseEveAgentReturn } from "eve/svelte";
  import { openConversationInputs } from "eve/svelte";
  import {
    type StreamInsights,
    TONE_CLASS,
    TONE_DOT,
    TOOL_STATE_LABEL,
    TOOL_STATE_TONE,
    type Tone,
    allToolParts,
    formatCost,
    formatDuration,
    formatTime,
    formatTokens,
    humanizeName,
    prettyJson,
  } from "./format.ts";

  let {
    agent,
    insights,
  }: {
    agent: UseEveAgentReturn<ConversationState>;
    insights: StreamInsights;
  } = $props();

  type Tab = "overview" | "tools" | "turns" | "events";
  const TABS: readonly Tab[] = ["overview", "tools", "turns", "events"];

  function loadTab(): Tab {
    try {
      const saved = localStorage.getItem("jobagent:details-tab");
      if (saved && (TABS as readonly string[]).includes(saved)) return saved as Tab;
    } catch {
      // Storage can be unavailable; fall back to the default tab.
    }
    return "overview";
  }

  let tab = $state<Tab>(loadTab());
  $effect(() => {
    try {
      localStorage.setItem("jobagent:details-tab", tab);
    } catch {
      // Not critical.
    }
  });

  const tools = $derived(allToolParts(agent.data.messages));
  const turns = $derived(Object.values(agent.data.turns));
  const tasks = $derived(Object.values(agent.data.tasks));
  const subagents = $derived(Object.values(agent.conversation.agents));
  const openInputs = $derived(openConversationInputs(agent.data));
  const usage = $derived(insights.sessionUsage ?? insights.stepUsage);

  const toolCounts = $derived.by(() => {
    let done = 0;
    let failed = 0;
    let running = 0;
    for (const part of tools) {
      if (part.state === "output-available" && !part.partial) done += 1;
      else if (part.state === "output-error" || part.state === "output-denied") failed += 1;
      else running += 1;
    }
    return { done, failed, running };
  });

  let eventFilter = $state("");
  let expandedEvent = $state<number | undefined>();
  const filteredEvents = $derived.by(() => {
    const needle = eventFilter.trim().toLowerCase();
    const indexed = agent.events.map((event, index) => ({ event, index }));
    const matches = needle ? indexed.filter(({ event }) => event.type.toLowerCase().includes(needle)) : indexed;
    return matches.reverse();
  });

  let copiedField = $state<string | undefined>();
  async function copy(label: string, text: string | undefined) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copiedField = label;
      setTimeout(() => (copiedField = undefined), 1200);
    } catch {
      // Clipboard can be blocked outside a secure context.
    }
  }

  const STATUS_TONE: Record<string, Tone> = {
    active: "accent",
    working: "accent",
    following: "accent",
    completed: "ok",
    idle: "ok",
    cancelled: "muted",
    "not-followed": "muted",
    failed: "bad",
    unavailable: "bad",
  };

  function eventTone(type: string): string {
    if (type.endsWith(".failed") || type === "step.failed") return "text-destructive";
    if (type.startsWith("input.") || type.startsWith("approval.") || type.startsWith("authorization."))
      return "text-attention-foreground";
    if (type.startsWith("turn.") || type.startsWith("session.")) return "text-success";
    if (type.startsWith("action") || type.startsWith("task.") || type === "agent.started") return "text-foreground";
    return "text-muted-foreground";
  }
</script>

{#snippet badge(label: string, tone: Tone)}
  <Badge variant="outline" class={cn("h-5 px-1.5 text-[11px]", TONE_CLASS[tone])}>{label}</Badge>
{/snippet}

{#snippet row(label: string, value: string | undefined, copyable = false)}
  <div class="flex items-center justify-between gap-3 py-2">
    <dt class="shrink-0 text-[13px] text-muted-foreground">{label}</dt>
    <dd class="flex min-w-0 items-center gap-1">
      <span class="truncate font-mono text-xs" title={value}>{value ?? "—"}</span>
      {#if copyable && value}
        <Button variant="ghost" size="icon-xs" aria-label="Copy {label.toLowerCase()}" onclick={() => copy(label, value)}>
          {#if copiedField === label}<CheckIcon />{:else}<CopyIcon />{/if}
        </Button>
      {/if}
    </dd>
  </div>
{/snippet}

{#snippet stat(label: string, value: string, className = "")}
  <div class="rounded-lg border px-3 py-2.5">
    <div class="text-xs text-muted-foreground">{label}</div>
    <div class={cn("mt-0.5 text-lg font-semibold tracking-tight tabular-nums", className)}>{value}</div>
  </div>
{/snippet}

{#snippet heading(text: string)}
  <h3 class="mb-2 text-[13px] font-medium text-muted-foreground">{text}</h3>
{/snippet}

<Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col gap-0">
  <div class="border-b px-4 pb-3">
    <Tabs.List class="w-full">
      <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
      <Tabs.Trigger value="tools">
        Tools
        {#if tools.length > 0}<span class="text-muted-foreground tabular-nums">{tools.length}</span>{/if}
      </Tabs.Trigger>
      <Tabs.Trigger value="turns">Turns</Tabs.Trigger>
      <Tabs.Trigger value="events">
        Events <span class="text-muted-foreground tabular-nums">{agent.events.length}</span>
      </Tabs.Trigger>
    </Tabs.List>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
    <Tabs.Content value="overview" class="flex flex-col gap-6">
      <section>
        {@render heading("Session")}
        <dl class="divide-y">
          {@render row("Status", agent.status)}
          {@render row("Session", agent.session?.sessionId, true)}
          {@render row("Stream index", agent.session ? String(agent.session.streamIndex) : undefined)}
          {@render row("Active turn", agent.data.activeTurnId, true)}
          {@render row("Agent", insights.agentName)}
          {@render row("Model", insights.modelId)}
          {@render row("eve", insights.eveVersion)}
          {@render row("Started", insights.startedAt ? formatTime(new Date(insights.startedAt).toISOString()) : undefined)}
        </dl>
      </section>

      <section>
        {@render heading(insights.sessionUsage ? "Tokens used this session" : "Tokens used so far")}
        <div class="grid grid-cols-2 gap-2">
          {@render stat("Input", formatTokens(usage.inputTokens))}
          {@render stat("Output", formatTokens(usage.outputTokens))}
          {@render stat("Cache read", formatTokens(usage.cacheReadTokens))}
          {@render stat("Cost", formatCost(usage.costUsd))}
        </div>
        <p class="mt-2 text-xs text-muted-foreground">
          {insights.steps} model call{insights.steps === 1 ? "" : "s"}{#if insights.lastStepUsage}. The last one read
            {formatTokens(insights.lastStepUsage.inputTokens)} tokens and wrote {formatTokens(insights.lastStepUsage.outputTokens)}.{/if}
        </p>
      </section>

      <section>
        {@render heading("Tool calls")}
        <div class="grid grid-cols-3 gap-2">
          {@render stat("Done", String(toolCounts.done), "text-success")}
          {@render stat("Running", String(toolCounts.running))}
          {@render stat("Failed", String(toolCounts.failed), toolCounts.failed > 0 ? "text-destructive" : "")}
        </div>
        {#if openInputs.length > 0}
          <p class="mt-2 text-xs font-medium text-attention-foreground">
            {openInputs.length} request{openInputs.length === 1 ? "" : "s"} waiting for your answer
          </p>
        {/if}
      </section>

      {#if agent.error}
        <section>
          {@render heading("Last error")}
          <CodeBlock label={agent.error.name} code={agent.error.message} tone="error" />
        </section>
      {/if}
    </Tabs.Content>

    <Tabs.Content value="tools">
      {#if tools.length === 0}
        <p class="py-10 text-center text-sm text-muted-foreground">Tool calls show up here as the agent works.</p>
      {:else}
        <ol class="ml-1 flex flex-col gap-3.5 border-l pl-4">
          {#each tools as part (part.toolCallId)}
            {@const timing = insights.calls.get(part.toolCallId)}
            <li class="relative">
              <span
                class={cn("absolute top-1.5 -left-[21px] size-2 rounded-full ring-4 ring-background", TONE_DOT[TOOL_STATE_TONE[part.state]])}
              ></span>
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium">{humanizeName(part.toolName)}</span>
                {@render badge(TOOL_STATE_LABEL[part.state], TOOL_STATE_TONE[part.state])}
              </div>
              <div class="mt-0.5 flex gap-3 font-mono text-[11px] text-muted-foreground">
                {#if timing}
                  <span>{formatTime(new Date(timing.startedAt).toISOString())}</span>
                  {#if timing.endedAt}<span>{formatDuration(timing.endedAt - timing.startedAt)}</span>{/if}
                {/if}
                <span class="truncate">{part.toolMetadata?.eve?.kind ?? "tool-call"}</span>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </Tabs.Content>

    <Tabs.Content value="turns" class="flex flex-col gap-6">
      <section>
        {@render heading("Turns")}
        {#if turns.length === 0}
          <p class="text-sm text-muted-foreground">No turns yet.</p>
        {:else}
          <ul class="flex flex-col gap-1.5">
            {#each turns as turn, index (turn.turnId)}
              <li class="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5">
                <span class="min-w-0 truncate text-[13px]" title={turn.turnId}>Turn {index + 1}</span>
                <span class="flex shrink-0 gap-1">
                  {#if turn.waiting}{@render badge("waiting", "warn")}{/if}
                  {@render badge(turn.status, STATUS_TONE[turn.status] ?? "muted")}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section>
        {@render heading("Tasks")}
        {#if tasks.length === 0}
          <p class="text-sm text-muted-foreground">No background tasks or subagent calls.</p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each tasks as task (task.taskId)}
              <li class="rounded-lg border p-2.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm font-medium">{humanizeName(task.name)}</span>
                  {@render badge(task.kind, task.kind === "agent" ? "accent" : "muted")}
                </div>
                <ul class="mt-1.5 flex flex-col gap-1">
                  {#each Object.values(task.calls) as call (call.callId)}
                    <li class="flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                      <span class="truncate" title={call.callId}>{call.callId}</span>
                      {@render badge(call.status, STATUS_TONE[call.status] ?? "muted")}
                    </li>
                    {#if call.error}<li class="text-xs text-destructive">{call.error.message}</li>{/if}
                  {/each}
                </ul>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section>
        {@render heading("Subagent sessions")}
        {#if subagents.length === 0}
          <p class="text-sm text-muted-foreground">No subagents have run yet.</p>
        {:else}
          <ul class="flex flex-col gap-1.5">
            {#each subagents as session (session.sessionId)}
              <li class="rounded-md bg-muted/50 px-2.5 py-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-[13px]">{humanizeName(session.name)}</span>
                  {@render badge(session.observation.status, STATUS_TONE[session.observation.status] ?? "muted")}
                </div>
                <div class="truncate font-mono text-[11px] text-muted-foreground" title={session.sessionId}>
                  {session.sessionId}
                </div>
                {#if "conversation" in session.observation && session.observation.conversation}
                  <div class="mt-0.5 text-[11px] text-muted-foreground">
                    {allToolParts(session.observation.conversation.messages).length} tool calls,
                    {session.observation.conversation.messages.length} messages
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </Tabs.Content>

    <Tabs.Content value="events">
      <Input class="mb-3 font-mono text-xs" placeholder="Filter by type, e.g. action or turn" bind:value={eventFilter} />
      {#if filteredEvents.length === 0}
        <p class="py-10 text-center text-sm text-muted-foreground">No events match that filter.</p>
      {:else}
        <ul class="flex flex-col">
          {#each filteredEvents as { event, index } (event.meta?.id ?? index)}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left font-mono text-[11px] hover:bg-muted"
                aria-expanded={expandedEvent === index}
                onclick={() => (expandedEvent = expandedEvent === index ? undefined : index)}
              >
                <span class="w-7 shrink-0 text-right text-muted-foreground tabular-nums">{index}</span>
                <span class="min-w-0 flex-1 truncate {eventTone(event.type)}">{event.type}</span>
                <span class="shrink-0 text-muted-foreground">{formatTime(event.meta?.at)}</span>
              </button>
              {#if expandedEvent === index}
                <div class="mt-1 mb-2 pl-9">
                  <CodeBlock label="Data" code={prettyJson("data" in event ? event.data : undefined)} />
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </Tabs.Content>
  </div>
</Tabs.Root>
