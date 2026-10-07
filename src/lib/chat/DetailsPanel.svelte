<script lang="ts">
  import type { ConversationState, UseEveAgentReturn } from "eve/svelte";
  import { openConversationInputs } from "eve/svelte";
  import JsonBlock from "./JsonBlock.svelte";
  import {
    type StreamInsights,
    TONE_CLASS,
    TOOL_STATE_LABEL,
    TOOL_STATE_TONE,
    type Tone,
    allToolParts,
    formatCost,
    formatDuration,
    formatTime,
    formatTokens,
    humanizeName,
  } from "./format";

  let {
    agent,
    insights,
    onClose,
  }: {
    agent: UseEveAgentReturn<ConversationState>;
    insights: StreamInsights;
    onClose?: () => void;
  } = $props();

  type Tab = "overview" | "tools" | "turns" | "events";
  const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "tools", label: "Tools" },
    { id: "turns", label: "Turns" },
    { id: "events", label: "Events" },
  ];

  function loadTab(): Tab {
    try {
      const saved = localStorage.getItem("jobagent:details-tab");
      if (saved && TABS.some((tab) => tab.id === saved)) return saved as Tab;
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
    if (type.endsWith(".failed") || type === "step.failed") return "text-bad";
    if (type.startsWith("input.") || type.startsWith("approval.") || type.startsWith("authorization."))
      return "text-warn";
    if (type.startsWith("action") || type.startsWith("task.") || type === "agent.started") return "text-accent";
    if (type.startsWith("turn.") || type.startsWith("session.")) return "text-ok";
    return "text-muted";
  }
</script>

{#snippet badge(label: string, tone: Tone)}
  <span class="rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ring-inset {TONE_CLASS[tone]}">{label}</span>
{/snippet}

{#snippet row(label: string, value: string | undefined, copyable = false)}
  <div class="flex items-center justify-between gap-3 py-1.5">
    <dt class="shrink-0 text-xs text-muted">{label}</dt>
    <dd class="flex min-w-0 items-center gap-1.5">
      <span class="truncate font-mono text-[11.5px] text-ink" title={value}>{value ?? "—"}</span>
      {#if copyable && value}
        <button
          type="button"
          class="shrink-0 text-[10px] text-faint hover:text-ink"
          onclick={() => copy(label, value)}>{copiedField === label ? "✓" : "Copy"}</button
        >
      {/if}
    </dd>
  </div>
{/snippet}

<aside class="flex h-full flex-col border-l border-line bg-panel">
  <div class="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
    <div class="flex gap-0.5 rounded-lg bg-raised p-0.5" role="tablist">
      {#each TABS as item (item.id)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === item.id}
          class="rounded-md px-2.5 py-1 text-xs font-medium transition {tab === item.id
            ? 'bg-panel text-ink shadow-sm'
            : 'text-muted hover:text-ink'}"
          onclick={() => (tab = item.id)}
        >
          {item.label}
          {#if item.id === "tools" && tools.length > 0}
            <span class="ml-0.5 text-faint">{tools.length}</span>
          {:else if item.id === "events"}
            <span class="ml-0.5 text-faint">{agent.events.length}</span>
          {/if}
        </button>
      {/each}
    </div>
    {#if onClose}
      <button type="button" class="rounded-md p-1 text-muted hover:bg-raised hover:text-ink" aria-label="Close details" onclick={onClose}>
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
    {#if tab === "overview"}
      <section>
        <h3 class="mb-1 text-[13px] font-medium text-pencil">Session</h3>
        <dl class="divide-y divide-line/60">
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

      <section class="mt-5">
        <h3 class="mb-2 text-[13px] font-medium text-pencil">
          {insights.sessionUsage ? "Tokens used this session" : "Tokens used so far"}
        </h3>
        <div class="grid grid-cols-2 gap-2">
          {#each [{ label: "Input", value: formatTokens(usage.inputTokens) }, { label: "Output", value: formatTokens(usage.outputTokens) }, { label: "Cache read", value: formatTokens(usage.cacheReadTokens) }, { label: "Cost", value: formatCost(usage.costUsd) }] as stat (stat.label)}
            <div class="rounded-lg border border-line bg-raised/50 px-3 py-2">
              <div class="text-[11px] text-muted">{stat.label}</div>
              <div class="mt-0.5 font-display text-[19px] font-medium tabular-nums text-ink tabular-nums">{stat.value}</div>
            </div>
          {/each}
        </div>
        <p class="mt-2 text-[11px] text-faint">
          {insights.steps} model call{insights.steps === 1 ? "" : "s"}{#if insights.lastStepUsage}. The last one read
            {formatTokens(insights.lastStepUsage.inputTokens)} tokens and wrote {formatTokens(insights.lastStepUsage.outputTokens)}.{/if}
        </p>
      </section>

      <section class="mt-5">
        <h3 class="mb-2 text-[13px] font-medium text-pencil">Activity</h3>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="rounded-lg border border-line bg-raised/50 py-2">
            <div class="font-display text-[19px] font-medium tabular-nums text-ok">{toolCounts.done}</div>
            <div class="text-[11px] text-muted">tools done</div>
          </div>
          <div class="rounded-lg border border-line bg-raised/50 py-2">
            <div class="font-display text-[19px] font-medium tabular-nums text-accent">{toolCounts.running}</div>
            <div class="text-[11px] text-muted">in flight</div>
          </div>
          <div class="rounded-lg border border-line bg-raised/50 py-2">
            <div class="font-display text-[19px] font-medium tabular-nums text-bad">{toolCounts.failed}</div>
            <div class="text-[11px] text-muted">failed</div>
          </div>
        </div>
        {#if openInputs.length > 0}
          <p class="mt-2 text-xs text-warn">
            {openInputs.length} request{openInputs.length === 1 ? "" : "s"} waiting for your answer
          </p>
        {/if}
      </section>

      {#if agent.error}
        <section class="mt-5">
          <h3 class="mb-2 text-[13px] font-medium text-brick">Last error</h3>
          <JsonBlock label={agent.error.name} value={agent.error.message} tone="bad" />
        </section>
      {/if}
    {:else if tab === "tools"}
      {#if tools.length === 0}
        <p class="py-8 text-center text-xs text-faint">No tool calls yet.</p>
      {:else}
        <ol class="relative space-y-3 border-l border-line pl-4">
          {#each tools as part (part.toolCallId)}
            {@const timing = insights.calls.get(part.toolCallId)}
            <li class="relative">
              <span
                class="absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-panel {TOOL_STATE_TONE[part.state] === 'ok'
                  ? 'bg-ok'
                  : TOOL_STATE_TONE[part.state] === 'bad'
                    ? 'bg-bad'
                    : TOOL_STATE_TONE[part.state] === 'warn'
                      ? 'bg-warn'
                      : TOOL_STATE_TONE[part.state] === 'accent'
                        ? 'animate-pulse bg-accent'
                        : 'bg-faint'}"
              ></span>
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-[13px] font-medium text-ink">{humanizeName(part.toolName)}</span>
                {@render badge(TOOL_STATE_LABEL[part.state], TOOL_STATE_TONE[part.state])}
              </div>
              <div class="mt-0.5 flex gap-3 font-mono text-[10.5px] text-faint">
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
    {:else if tab === "turns"}
      <section>
        <h3 class="mb-2 text-[13px] font-medium text-pencil">Turns</h3>
        {#if turns.length === 0}
          <p class="text-xs text-faint">No turns yet.</p>
        {:else}
          <ul class="space-y-1.5">
            {#each turns as turn, index (turn.turnId)}
              <li class="flex items-center justify-between gap-2 rounded-md bg-raised/50 px-2.5 py-1.5">
                <span class="min-w-0 truncate font-mono text-[11px] text-muted" title={turn.turnId}
                  >Turn {index + 1}</span
                >
                <span class="flex shrink-0 gap-1">
                  {#if turn.waiting}{@render badge("waiting", "warn")}{/if}
                  {@render badge(turn.status, STATUS_TONE[turn.status] ?? "muted")}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="mt-5">
        <h3 class="mb-2 text-[13px] font-medium text-pencil">Tasks</h3>
        {#if tasks.length === 0}
          <p class="text-xs text-faint">No background tasks or subagent calls.</p>
        {:else}
          <ul class="space-y-2">
            {#each tasks as task (task.taskId)}
              <li class="rounded-md border border-line p-2.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-[13px] font-medium text-ink">{humanizeName(task.name)}</span>
                  {@render badge(task.kind, task.kind === "agent" ? "accent" : "muted")}
                </div>
                <ul class="mt-1.5 space-y-1">
                  {#each Object.values(task.calls) as call (call.callId)}
                    <li class="flex items-center justify-between gap-2 font-mono text-[10.5px] text-faint">
                      <span class="truncate" title={call.callId}>{call.callId}</span>
                      {@render badge(call.status, STATUS_TONE[call.status] ?? "muted")}
                    </li>
                    {#if call.error}<li class="text-[11px] text-bad">{call.error.message}</li>{/if}
                  {/each}
                </ul>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="mt-5">
        <h3 class="mb-2 text-[13px] font-medium text-pencil">Subagent sessions</h3>
        {#if subagents.length === 0}
          <p class="text-xs text-faint">No subagents have run yet.</p>
        {:else}
          <ul class="space-y-1.5">
            {#each subagents as session (session.sessionId)}
              <li class="rounded-md bg-raised/50 px-2.5 py-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-[13px] text-ink">{humanizeName(session.name)}</span>
                  {@render badge(session.observation.status, STATUS_TONE[session.observation.status] ?? "muted")}
                </div>
                <div class="truncate font-mono text-[10.5px] text-faint" title={session.sessionId}>{session.sessionId}</div>
                {#if "conversation" in session.observation && session.observation.conversation}
                  <div class="mt-0.5 text-[10.5px] text-faint">
                    {allToolParts(session.observation.conversation.messages).length} tool calls ·
                    {session.observation.conversation.messages.length} messages
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {:else if tab === "events"}
      <input
        class="mb-2 w-full rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        placeholder="Filter by type, e.g. action or turn."
        bind:value={eventFilter}
      />
      {#if filteredEvents.length === 0}
        <p class="py-8 text-center text-xs text-faint">No events.</p>
      {:else}
        <ul class="space-y-px">
          {#each filteredEvents as { event, index } (event.meta?.id ?? index)}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left font-mono text-[11px] hover:bg-raised"
                onclick={() => (expandedEvent = expandedEvent === index ? undefined : index)}
              >
                <span class="w-7 shrink-0 text-right text-faint tabular-nums">{index}</span>
                <span class="min-w-0 flex-1 truncate {eventTone(event.type)}">{event.type}</span>
                <span class="shrink-0 text-faint">{formatTime(event.meta?.at)}</span>
              </button>
              {#if expandedEvent === index}
                <div class="mt-1 mb-2 pl-9">
                  <JsonBlock label="data" value={"data" in event ? event.data : undefined} />
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</aside>
