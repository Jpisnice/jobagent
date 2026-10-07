<script lang="ts">
  import * as Alert from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Separator } from "#lib/components/ui/separator/index.js";
  import * as Sheet from "#lib/components/ui/sheet/index.js";
  import * as Sidebar from "#lib/components/ui/sidebar/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import * as Tooltip from "#lib/components/ui/tooltip/index.js";
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import PanelRightIcon from "@lucide/svelte/icons/panel-right";
  import { openConversationInputs, useEveAgent } from "eve/svelte";
  import { onDestroy, onMount, untrack } from "svelte";
  import AgentComposer from "./agent-composer.svelte";
  import AgentPendingInputs from "./agent-pending-inputs.svelte";
  import AgentStatus from "./agent-status.svelte";
  import AgentThread from "./agent-thread.svelte";
  import { type SavedChat, chats } from "./chats.svelte.ts";
  import { describeActivity } from "./activity.ts";
  import { AgentView } from "./agent-view.svelte.ts";
  import { chatTitle } from "./format.ts";

  let {
    id,
    saved,
    ended = false,
    firstMessage,
    onSessionLost,
    onNewChat,
  }: {
    id: string;
    /** A saved chat to show; resumed on mount when it has a live session. */
    saved: SavedChat;
    /** The server no longer has this chat's session: show the transcript, but it can't continue. */
    ended?: boolean;
    /** Sent as soon as the chat mounts, e.g. a message that hit a lost session. */
    firstMessage?: string;
    /** The server forgot this session mid-chat; the page opens a new chat with `text`. */
    onSessionLost: (text: string) => void;
    onNewChat: () => void;
  } = $props();

  // The binding reads its options once; the page remounts this component to switch chats.
  const initial = untrack(() => ({ id, saved, ended }));

  const live = useEveAgent({
    // Show what the matcher subagent does live, inside its tool step.
    followSubagents: true,
    initialEvents: initial.saved.events ?? [],
    initialSession: initial.ended ? undefined : initial.saved.session,
    resume: !initial.ended && initial.saved.session !== undefined,
    onSessionChange(session) {
      if (session !== undefined) scheduleSave();
    },
    onFinish() {
      saveNow();
    },
  });
  // Everything on screen reads this: stream bursts land as one update per frame.
  const agent = new AgentView(live);
  const insights = $derived(agent.insights);

  const title = $derived(chats.get(id)?.title ?? chatTitle(agent.data.messages) ?? "New chat");

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (initial.ended || !live.session) return;
    chats.save(initial.id, { session: live.session, events: live.events }, untrack(() => title));
  }

  // Writing the whole stream to storage is not free, so while a reply streams it is saved every
  // few seconds, when the browser is idle; the end of a turn and leaving the page save at once.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave() {
    if (saveTimer !== undefined) return;
    saveTimer = setTimeout(() => {
      if ("requestIdleCallback" in window) requestIdleCallback(saveNow, { timeout: 1000 });
      else saveNow();
    }, 3000);
  }

  // Leaving a chat mid-turn keeps the turn running on the server; coming back resumes it.
  onDestroy(() => {
    if (saveTimer !== undefined) saveNow();
    if (chats.live?.id === initial.id) chats.live = undefined;
  });

  const activity = $derived(describeActivity(agent, insights.labels));
  const busy = $derived(agent.status === "submitted" || agent.status === "streaming");
  const waiting = $derived(openConversationInputs(agent.data).length > 0);

  // When the running turn started, for the working indicator's timer.
  let busySince = $state<number | undefined>();
  $effect(() => {
    if (!busy) busySince = undefined;
    else if (untrack(() => busySince) === undefined) busySince = Date.now();
  });

  // The sidebar marks the open chat while it works or waits on you.
  $effect(() => {
    const tone = waiting ? "attention" : busy ? "working" : undefined;
    chats.live = tone ? { id: initial.id, tone } : undefined;
  });

  let draft = $state("");
  let composer: ReturnType<typeof AgentComposer> | undefined = $state();

  onMount(() => {
    if (firstMessage) void composer?.sendText(firstMessage);
    else composer?.focus();
  });

  // An open question that takes a typed answer turns the message box into its answer field.
  const question = $derived(
    openConversationInputs(agent.data).find(
      (input) => input.request.kind === "question" && input.request.allowFreeform !== false,
    ),
  );

  // The details panel is its own chunk, fetched the first time you open it.
  const loadDetails = () => import("./details-panel.svelte");
  let detailsOpen = $state(false);
  let detailsModule = $state<ReturnType<typeof loadDetails>>();
  $effect(() => {
    if (detailsOpen && !detailsModule) detailsModule = loadDetails();
  });

  function pickSuggestion(prompt: string) {
    draft = prompt;
    composer?.focus();
  }
</script>

<svelte:head>
  <title>{waiting ? "Needs your answer | " : busy ? "Working | " : ""}Job Agent</title>
</svelte:head>

<svelte:window onpagehide={() => saveTimer !== undefined && saveNow()} />

<header class="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
  <Sidebar.Trigger class="-ml-1" />
  <Separator orientation="vertical" class="mr-1 data-vertical:h-4" />
  <h1 class="hidden min-w-0 truncate text-sm font-medium sm:block">{title}</h1>
  <AgentStatus {activity} class="min-w-0 sm:ml-2 sm:border-l sm:pl-3" />
  <div class="ml-auto flex shrink-0 items-center">
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            aria-label="Session details"
            onclick={() => (detailsOpen = true)}
          >
            <PanelRightIcon />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Session details</Tooltip.Content>
    </Tooltip.Root>
  </div>
</header>

<div class="flex min-h-0 flex-1 flex-col">
  <AgentThread
    {agent}
    {insights}
    {activity}
    {busySince}
    onPick={pickSuggestion}
    onRetry={(text) => void composer?.sendText(text)}
  />

  <div class="mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-4 pb-4 sm:px-6">
    {#if ended}
      <Alert.Root>
        <CircleAlertIcon />
        <Alert.Title>This conversation has ended</Alert.Title>
        <Alert.Description>
          The agent server restarted, so it no longer has this chat's context. Start a new chat to keep going.
        </Alert.Description>
        <Alert.Action>
          <Button size="sm" onclick={onNewChat}>New chat</Button>
        </Alert.Action>
      </Alert.Root>
    {:else}
      {#if agent.error && agent.status === "error"}
        <Alert.Root variant="destructive" class="arrive">
          <CircleAlertIcon />
          <Alert.Title>Lost the connection to the agent</Alert.Title>
          <Alert.Description class="break-words">{agent.error.message}</Alert.Description>
          <Alert.Action>
            <Button size="sm" variant="outline" onclick={onNewChat}>New chat</Button>
          </Alert.Action>
        </Alert.Root>
      {/if}
      <AgentPendingInputs {agent} labels={insights.labels} />
      <AgentComposer bind:this={composer} bind:value={draft} {agent} {activity} {question} {onSessionLost} />
    {/if}
  </div>
</div>

<Sheet.Root bind:open={detailsOpen}>
  <Sheet.Content side="right" class="w-full gap-0 sm:max-w-md">
    <Sheet.Header class="pb-3">
      <Sheet.Title>Session details</Sheet.Title>
      <Sheet.Description>What the agent ran, what it cost, and the raw event stream.</Sheet.Description>
    </Sheet.Header>
    {#await detailsModule}
      <div class="flex flex-col gap-3 p-4" aria-label="Loading details">
        <Skeleton class="h-8 w-3/4" />
        <Skeleton class="h-24" />
        <Skeleton class="h-40" />
      </div>
    {:then module}
      {#if module}
        <module.default {agent} {insights} />
      {/if}
    {/await}
  </Sheet.Content>
</Sheet.Root>
