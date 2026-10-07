<script lang="ts">
  import type { ConversationState, UseEveAgentReturn } from "eve/svelte";
  import { openConversationInputs } from "eve/svelte";
  import AgentDecision from "./agent-decision.svelte";
  import { allToolParts } from "./format.ts";

  let {
    agent,
    labels,
  }: { agent: UseEveAgentReturn<ConversationState>; labels: ReadonlyMap<string, string> } = $props();

  // Requests whose call is in the thread get their card there. The rest (a subagent's question,
  // a session limit) dock above the message box so they can't be missed.
  const orphans = $derived.by(() => {
    const inThread = new Set(allToolParts(agent.data.messages).map((part) => part.toolCallId));
    return openConversationInputs(agent.data).filter((input) => !inThread.has(input.request.action.callId));
  });
</script>

{#if orphans.length > 0}
  <div class="flex max-h-[45vh] flex-col gap-2 overflow-y-auto">
    {#each orphans as input (input.request.requestId)}
      <AgentDecision {agent} {input} {labels} fresh />
    {/each}
  </div>
{/if}
