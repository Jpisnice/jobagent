<script lang="ts">
  import { openConversationInputs, useEveAgent } from "eve/svelte";
  import { onMount, untrack } from "svelte";
  import Composer from "./Composer.svelte";
  import Header from "./Header.svelte";
  import InputRequests from "./InputRequests.svelte";
  import MessageList from "./MessageList.svelte";
  import { streamInsights } from "./format.ts";
  import { type SavedChat, clearChat, saveChat } from "./persistence.ts";

  let {
    saved,
    firstMessage,
    onSessionLost,
  }: {
    /** A saved chat whose session the server still has; resumed on mount. */
    saved: SavedChat;
    /** Sent as soon as the chat mounts, e.g. a message that hit a lost session. */
    firstMessage?: string;
    /** The server no longer has this session; the page remounts a fresh chat with `text`. */
    onSessionLost: (text: string) => void;
  } = $props();

  // The binding reads its options once; the page remounts this component to switch chats.
  const initial = untrack(() => saved);

  // Session changes can arrive per event while streaming; batch the writes.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (agent.session) saveChat({ session: agent.session, events: agent.events });
    }, 500);
  }

  const agent = useEveAgent({
    // Show what the matcher subagent does live, inside its tool card.
    followSubagents: true,
    initialEvents: initial.events ?? [],
    initialSession: initial.session,
    resume: initial.session !== undefined,
    onSessionChange(session) {
      if (session === undefined) {
        clearTimeout(saveTimer);
        clearChat();
      } else {
        scheduleSave();
      }
    },
    onFinish(snapshot) {
      clearTimeout(saveTimer);
      if (snapshot.session) saveChat({ session: snapshot.session, events: snapshot.events });
    },
  });

  const insights = $derived(streamInsights(agent.events));

  let draft = $state("");
  let composer: ReturnType<typeof Composer> | undefined = $state();

  onMount(() => {
    if (firstMessage) void composer?.sendText(firstMessage);
  });

  // An open question that takes a typed answer turns the message box into its answer field.
  const question = $derived(
    openConversationInputs(agent.data).find(
      (input) => input.request.kind === "question" && input.request.allowFreeform !== false,
    ),
  );

  // The details panel is its own chunk, fetched the first time you open it.
  const loadDetails = () => import("./DetailsPanel.svelte");
  let detailsModule = $state<ReturnType<typeof loadDetails>>();
  $effect(() => {
    if (detailsOpen && !detailsModule) detailsModule = loadDetails();
  });

  function loadDetailsOpen(): boolean {
    try {
      const stored = localStorage.getItem("jobagent:details-open");
      if (stored !== null) return stored === "1";
    } catch {
      // Fall through to the viewport default.
    }
    return window.matchMedia("(min-width: 1024px)").matches;
  }

  let detailsOpen = $state(loadDetailsOpen());
  $effect(() => {
    try {
      localStorage.setItem("jobagent:details-open", detailsOpen ? "1" : "0");
    } catch {
      // Not critical.
    }
  });

  function newChat() {
    if (agent.status === "submitted" || agent.status === "streaming") {
      // Leaving a running turn would keep it going server-side; stop it first.
      void agent.cancel().catch(() => {});
    }
    agent.reset();
    clearChat();
    draft = "";
    composer?.focus();
  }

  function pickSuggestion(prompt: string) {
    draft = prompt;
    composer?.focus();
  }
</script>

<div class="flex h-dvh flex-col">
  <Header
    {agent}
    labels={insights.labels}
    {detailsOpen}
    onToggleDetails={() => (detailsOpen = !detailsOpen)}
    onNewChat={newChat}
  />

  <div class="flex min-h-0 flex-1">
    <main class="flex min-w-0 flex-1 flex-col">
      <div class="min-h-0 flex-1">
        <MessageList {agent} {insights} onPick={pickSuggestion} />
      </div>

      <div class="mx-auto w-full max-w-[46rem] space-y-2.5 px-4 pb-4 sm:px-6">
        {#if agent.error && agent.status === "error"}
          <div
            class="arrive flex items-start justify-between gap-4 rounded-2xl border border-brick/40 bg-sheet px-4 py-3"
            role="alert"
          >
            <div class="min-w-0">
              <p class="text-[14.5px] font-medium text-brick">Lost the connection to the agent</p>
              <p class="mt-0.5 text-[13px] break-words text-pencil">{agent.error.message}</p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-xl bg-well px-3 py-1.5 text-[13.5px] text-ink hover:bg-rule"
              onclick={newChat}>Start a new chat</button
            >
          </div>
        {/if}
        <InputRequests {agent} labels={insights.labels} />
        <Composer bind:this={composer} bind:value={draft} {agent} {question} {onSessionLost} />
      </div>
    </main>

    {#if detailsOpen}
      <!-- Docked beside the chat on wide screens; a drawer over it on narrow ones. -->
      <button
        type="button"
        class="fixed inset-0 z-20 bg-[#121a2b]/40 lg:hidden"
        aria-label="Close details"
        onclick={() => (detailsOpen = false)}
      ></button>
      <div class="fixed inset-y-0 right-0 z-30 w-[min(92vw,380px)] lg:static lg:z-auto lg:w-[380px] lg:shrink-0">
        {#await detailsModule}
          <div class="h-full space-y-4 border-l border-rule bg-sheet p-5" aria-label="Loading details">
            <div class="h-8 w-3/4 skeleton rounded-xl"></div>
            <div class="h-24 skeleton rounded-xl"></div>
            <div class="h-40 skeleton rounded-xl"></div>
          </div>
        {:then module}
          {#if module}
            <module.default {agent} {insights} onClose={() => (detailsOpen = false)} />
          {/if}
        {/await}
      </div>
    {/if}
  </div>
</div>
