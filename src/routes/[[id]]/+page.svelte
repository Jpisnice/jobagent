<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import AgentChat from "#lib/agent/agent-chat.svelte";
  import { type SavedChat, chats, newChatId, sessionIsLive } from "#lib/agent/chats.svelte.ts";
  import { untrack } from "svelte";

  // `/` is a new chat with an id picked here; `/<id>` is a saved one. A new chat moves to its
  // own address once it's saved, keeping the same id, so it doesn't remount mid-reply.
  let draftId = $state(newChatId());
  const id = $derived(page.params.id ?? draftId);

  interface Opened {
    readonly id: string;
    readonly saved: SavedChat;
    readonly ended: boolean;
    readonly firstMessage?: string;
  }
  let opened = $state<Opened | undefined>();

  // Resume a saved chat only if the server still has its session; otherwise show it as ended.
  async function open(target: string): Promise<Opened> {
    const firstMessage = chats.pendingMessage;
    chats.pendingMessage = undefined;
    const saved = chats.load(target);
    if (!saved.session) return { id: target, saved: {}, ended: false, firstMessage };
    if (await sessionIsLive(saved.session.sessionId)) return { id: target, saved, ended: false, firstMessage };
    // Nothing worth reading was saved before the session went away: just start over here.
    if (!saved.events?.some((event) => event.type === "message.received")) {
      return { id: target, saved: {}, ended: false, firstMessage };
    }
    return { id: target, saved, ended: true, firstMessage };
  }

  $effect(() => {
    const target = id;
    if (untrack(() => opened?.id) === target) return;
    let cancelled = false;
    void open(target).then((result) => {
      if (!cancelled) opened = result;
    });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (page.params.id !== undefined || !chats.get(draftId)) return;
    const created = draftId;
    void goto(`/${created}`, { replace: true, reset: false }).then(() => {
      draftId = newChatId();
    });
  });

  function startNewChat() {
    draftId = newChatId();
    void goto("/");
  }

  function onSessionLost(text: string) {
    chats.pendingMessage = text;
    startNewChat();
  }
</script>

{#if opened && opened.id === id}
  {#key opened.id}
    <AgentChat
      id={opened.id}
      saved={opened.saved}
      ended={opened.ended}
      firstMessage={opened.firstMessage}
      {onSessionLost}
      onNewChat={startNewChat}
    />
  {/key}
{:else}
  <div class="grid flex-1 place-items-center text-sm text-muted-foreground">
    <span class="shimmer">Opening your chat…</span>
  </div>
{/if}
