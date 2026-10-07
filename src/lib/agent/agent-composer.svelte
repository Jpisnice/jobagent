<script lang="ts">
  import * as PromptInput from "#lib/components/chat/prompt-input/index.ts";
  import CornerDownRightIcon from "@lucide/svelte/icons/corner-down-right";
  import type { ConversationInput, ConversationState, UseEveAgentReturn } from "eve/svelte";

  let {
    agent,
    value = $bindable(""),
    question,
    onSessionLost,
  }: {
    agent: UseEveAgentReturn<ConversationState>;
    value?: string;
    /** An open question that takes a typed answer; the box answers it instead of steering. */
    question?: ConversationInput;
    /** Called with the unsent text when the server no longer has this session. */
    onSessionLost?: (text: string) => void;
  } = $props();

  let textarea: HTMLTextAreaElement | null = $state(null);
  let failure = $state<string | undefined>();
  let stopping = $state(false);

  const busy = $derived(agent.status === "submitted" || agent.status === "streaming");
  const disabled = $derived(agent.status === "resuming");
  const answering = $derived(question !== undefined);
  const choiceCount = $derived(question?.request.options?.length ?? 0);

  // A new question pulls focus here so you can just start typing.
  $effect(() => {
    if (question) textarea?.focus({ preventScroll: true });
  });

  export function focus() {
    textarea?.focus();
  }

  export async function sendText(text: string) {
    failure = undefined;
    try {
      if (question) {
        // Answering keeps the turn going; steering would withdraw the question.
        await agent.respond([{ requestId: question.request.requestId, text }]);
        return;
      }
      // While a turn runs, a follow-up steers it instead of being rejected.
      await agent.send(text, busy ? { turnPolicy: "steer" } : undefined);
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
    stopping = true;
    try {
      await agent.cancel();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      stopping = false;
    }
  }

  const placeholder = $derived(
    disabled
      ? "Reconnecting to your conversation…"
      : answering
        ? "Type your answer…"
        : busy
          ? "Add a note to steer what it's doing…"
          : "Ask about jobs, your profile, or an application…",
  );
</script>

<PromptInput.Root
  bind:value
  {disabled}
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
      {:else if busy}
        Enter adds your note to the running task
      {:else}
        Shift+Enter for a new line
      {/if}
    </PromptInput.Hint>
    <div class="flex shrink-0 items-center gap-1.5">
      {#if busy && !answering}
        <PromptInput.Stop {stopping} onclick={stop} />
      {/if}
      <PromptInput.Submit label={answering ? "Send answer" : "Send"} />
    </div>
  </PromptInput.Toolbar>
</PromptInput.Root>
