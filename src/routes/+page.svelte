<script lang="ts">
  import Chat from "#lib/chat/Chat.svelte";
  import { type SavedChat, clearChat, loadChat, sessionIsLive } from "#lib/chat/persistence.ts";

  // Resume a saved chat only if the server still has its session; otherwise start fresh.
  let ready = $state(false);
  let saved = $state<SavedChat>({});
  let firstMessage = $state<string | undefined>();
  let generation = $state(0);

  async function restore() {
    const stored = loadChat();
    if (stored.session && (await sessionIsLive(stored.session.sessionId))) {
      saved = stored;
    } else if (stored.session) {
      clearChat();
    }
    ready = true;
  }
  void restore();

  function onSessionLost(text: string) {
    clearChat();
    saved = {};
    firstMessage = text;
    generation += 1;
  }
</script>

<svelte:head>
  <title>Job Agent</title>
</svelte:head>

{#if ready}
  {#key generation}
    <Chat {saved} {firstMessage} {onSessionLost} />
  {/key}
{:else}
  <div class="grid h-dvh place-items-center text-sm text-muted">Connecting to the agent…</div>
{/if}
