<script lang="ts">
  import type { ConversationState, UseEveAgentReturn } from "eve/svelte";
  import StatusPill from "./StatusPill.svelte";
  import type { StreamInsights } from "./format.ts";

  let {
    agent,
    labels,
    detailsOpen,
    onToggleDetails,
    onNewChat,
  }: {
    agent: UseEveAgentReturn<ConversationState>;
    labels: StreamInsights["labels"];
    detailsOpen: boolean;
    onToggleDetails: () => void;
    onNewChat: () => void;
  } = $props();
</script>

<header class="flex h-14 shrink-0 items-center gap-4 border-b border-rule bg-bg/85 px-4 backdrop-blur-md sm:px-5">
  <div class="flex min-w-0 items-center gap-2.5">
    <svg class="size-7 shrink-0" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--color-pen)" />
      <path d="M10 10h12M10 15h12M10 20h7" stroke="var(--color-sheet)" stroke-width="2.4" stroke-linecap="round" />
      <circle cx="22" cy="21.5" r="3.2" fill="var(--color-marigold)" />
    </svg>
    <span class="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">Job desk</span>
  </div>

  <div class="hidden h-5 w-px bg-rule sm:block" aria-hidden="true"></div>
  <div class="min-w-0 flex-1">
    <StatusPill {agent} {labels} />
  </div>

  <div class="flex shrink-0 items-center gap-1">
    <button
      type="button"
      onclick={onNewChat}
      aria-label="New chat"
      class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[14px] text-pencil transition-colors hover:bg-well hover:text-ink"
    >
      <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        ><path d="M12 5v14M5 12h14" stroke-linecap="round" /></svg
      >
      <span class="hidden sm:inline">New chat</span>
    </button>
    <button
      type="button"
      onclick={onToggleDetails}
      aria-pressed={detailsOpen}
      aria-label="Show session details"
      title="Session details"
      class="grid size-9 place-items-center rounded-xl transition-colors {detailsOpen
        ? 'bg-pen-soft text-pen'
        : 'text-pencil hover:bg-well hover:text-ink'}"
    >
      <svg class="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        ><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /></svg
      >
    </button>
  </div>
</header>
