<script lang="ts">
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

  let textarea: HTMLTextAreaElement | undefined = $state();
  let failure = $state<string | undefined>();
  let stopping = $state(false);

  const busy = $derived(agent.status === "submitted" || agent.status === "streaming");
  const disabled = $derived(agent.status === "resuming");
  const canSend = $derived(!disabled && value.trim().length > 0);
  const answering = $derived(question !== undefined);
  const choiceCount = $derived(question?.request.options?.length ?? 0);

  // Grow with the content up to a cap, then scroll.
  $effect(() => {
    void value;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  });

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

  async function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    value = "";
    await sendText(text);
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

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
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

<form
  class="rounded-2xl border bg-sheet transition-[border-color,box-shadow] duration-200 {answering
    ? 'border-marigold/60 shadow-[0_8px_24px_-16px_var(--color-marigold)]'
    : 'border-rule shadow-[0_8px_24px_-18px_rgb(34_38_42/0.35)] focus-within:border-pen/50'}"
  onsubmit={(event) => {
    event.preventDefault();
    void submit();
  }}
>
  {#if answering && question}
    <p class="truncate px-4 pt-3 text-[13px] text-marigold-ink">Answering: {question.request.prompt}</p>
  {/if}
  <textarea
    bind:this={textarea}
    bind:value
    onkeydown={onKeydown}
    rows="1"
    {disabled}
    {placeholder}
    aria-label={answering ? "Your answer" : "Message the agent"}
    data-answer-box={answering ? "" : undefined}
    class="block max-h-[240px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1.5 text-[15px] leading-relaxed text-ink placeholder:text-faint focus:outline-none focus-visible:outline-none disabled:opacity-60"
  ></textarea>
  <div class="flex items-center justify-between gap-3 px-3 pb-2.5 pl-4">
    <p class="min-w-0 truncate text-[12.5px] text-faint">
      {#if failure}
        <span class="text-brick">{failure}</span>
      {:else if answering && choiceCount > 1}
        Press 1–{choiceCount} to pick an option, or type your own answer
      {:else if answering}
        Enter sends your answer
      {:else if busy}
        Enter adds your note to the running task
      {:else}
        Shift+Enter for a new line
      {/if}
    </p>
    <div class="flex shrink-0 items-center gap-2">
      {#if busy && !answering}
        <button
          type="button"
          onclick={stop}
          disabled={stopping}
          class="inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-[13.5px] font-medium text-pencil transition-colors hover:bg-brick/10 hover:text-brick disabled:opacity-50"
        >
          <span class="size-2.5 rounded-[3px] bg-current"></span>
          {stopping ? "Stopping…" : "Stop"}
        </button>
      {/if}
      <button
        type="submit"
        disabled={!canSend}
        aria-label={answering ? "Send answer" : "Send"}
        class="grid size-9 place-items-center rounded-xl transition-[background-color,opacity,transform] duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 {answering
          ? 'bg-marigold text-[#22262a]'
          : 'bg-pen text-white dark:text-[#121a2b]'}"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
          ><path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round" /></svg
        >
      </button>
    </div>
  </div>
</form>
