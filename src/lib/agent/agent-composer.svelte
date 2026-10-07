<script lang="ts">
  import * as PromptInput from "#lib/components/chat/prompt-input/index.ts";
  import CornerDownRightIcon from "@lucide/svelte/icons/corner-down-right";
  import type { ConversationInput, ConversationState, UseEveAgentReturn } from "eve/svelte";
  import { openConversationInputs } from "eve/svelte";
  import type { AgentActivity } from "./activity.ts";

  let {
    agent,
    activity,
    value = $bindable(""),
    question,
    onSessionLost,
  }: {
    agent: UseEveAgentReturn<ConversationState>;
    activity: AgentActivity;
    value?: string;
    /** An open question that takes a typed answer; the box answers it. */
    question?: ConversationInput;
    /** Called with the unsent text when the server no longer has this session. */
    onSessionLost?: (text: string) => void;
  } = $props();

  let textarea: HTMLTextAreaElement | null = $state(null);
  let failure = $state<string | undefined>();
  let stopping = $state(false);

  const busy = $derived(agent.status === "submitted" || agent.status === "streaming");
  const answering = $derived(question !== undefined);
  // An approval (or a question without a typed answer) is answered on its card, not here.
  const choosing = $derived(!answering && openConversationInputs(agent.data).length > 0);
  // One thing at a time: while a turn runs, the box waits; only a question opens it.
  const locked = $derived(agent.status === "resuming" || (busy && !answering) || choosing);
  const choiceCount = $derived(question?.request.options?.length ?? 0);

  // A new question pulls focus here so you can just start typing; so does the box unlocking.
  $effect(() => {
    if (question || !locked) textarea?.focus({ preventScroll: true });
  });

  export function focus() {
    textarea?.focus();
  }

  export async function sendText(text: string) {
    failure = undefined;
    try {
      if (question) {
        await agent.respond([{ requestId: question.request.requestId, text }]);
        return;
      }
      await agent.send(text);
    } catch (error) {
      // The server forgot this session (e.g. `npm run dev` restarted); the client never replaces
      // a session on its own, so hand the message to a fresh chat instead of failing forever.
      if (onSessionLost && (error as { code?: unknown }).code === "session_not_active") {
        onSessionLost(text);
        return;
      }
      value = text;
      failure = error instanceof Error ? error.message : String(error);
    }
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    try {
      await agent.cancel();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      stopping = false;
    }
  }

  function onWindowKeydown(event: KeyboardEvent) {
    // Esc stops the running turn, unless it is closing a dialog or menu.
    if (event.key !== "Escape" || event.defaultPrevented || !busy || answering) return;
    if (document.querySelector("[role='dialog'], [role='menu']")) return;
    event.preventDefault();
    void stop();
  }

  const placeholder = $derived(
    agent.status === "resuming"
      ? "Reconnecting to your conversation…"
      : answering
        ? "Type your answer…"
        : choosing
          ? "Choose an option above to continue"
          : busy
            ? "The agent is working. You can type once it's done."
            : "Ask about jobs, your profile, or an application…",
  );
</script>

<svelte:window onkeydown={onWindowKeydown} />

<PromptInput.Root
  bind:value
  disabled={locked}
  working={busy && !answering && !choosing}
  variant={answering ? "attention" : "default"}
  onSubmit={(text) => void sendText(text)}
>
  {#if answering && question}
    <PromptInput.Header class="text-attention-foreground">
      <CornerDownRightIcon class="size-3.5 shrink-0" />
      <span class="truncate">Answering: {question.request.prompt}</span>
    </PromptInput.Header>
  {/if}
  <PromptInput.Textarea
    bind:ref={textarea}
    {placeholder}
    aria-label={answering ? "Your answer" : "Message the agent"}
    data-answer-box={answering ? "" : undefined}
  />
  <PromptInput.Toolbar>
    <PromptInput.Hint tone={failure ? "error" : "default"}>
      {#if failure}
        {failure}
      {:else if answering && choiceCount > 1}
        Press 1–{choiceCount} to pick an option, or type your own answer
      {:else if answering}
        Enter sends your answer
      {:else if busy && !choosing}
        {activity.label}… Press Esc to stop
      {:else}
        Shift+Enter for a new line
      {/if}
    </PromptInput.Hint>
    {#if busy && !answering && !choosing}
      <PromptInput.Stop {stopping} onclick={stop} />
    {:else}
      <PromptInput.Submit label={answering ? "Send answer" : "Send"} />
    {/if}
  </PromptInput.Toolbar>
</PromptInput.Root>
