<script lang="ts">
  import type { ConversationInput, ConversationState, EveDynamicToolPart, UseEveAgentReturn } from "eve/svelte";
  import { openConversationInputs } from "eve/svelte";
  import JsonBlock from "./JsonBlock.svelte";
  import { humanizeName, inputForCall, isToolRunning, prettyJson, renderMarkdown } from "./format.ts";

  let {
    agent,
    part,
    input: givenInput,
    labels,
    fresh = false,
  }: {
    agent: UseEveAgentReturn<ConversationState>;
    /** The tool call that asked, when it is in the thread. */
    part?: EveDynamicToolPart;
    /** A request with no call in the thread, e.g. from a subagent or a session limit. */
    input?: ConversationInput;
    labels?: ReadonlyMap<string, string>;
    fresh?: boolean;
  } = $props();

  type Choice = { id?: string; label: string; description?: string; style?: "danger" | "default" | "primary" };

  const input = $derived(givenInput ?? (part ? inputForCall(agent.data, part.toolCallId) : undefined));
  const request = $derived(input?.request ?? part?.toolMetadata?.eve?.inputRequest);
  const kind = $derived(request?.kind ?? (part?.toolName === "ask_question" ? "question" : "tool-approval"));
  const toolName = $derived(input?.request.action.toolName ?? part?.toolName ?? "");
  const toolInput = $derived((part?.input ?? input?.request.action.input ?? {}) as Record<string, unknown>);

  const isOpen = $derived(input?.status === "open");
  const isSending = $derived(input?.status === "responded");
  const blocked = $derived(agent.status === "resuming");

  // The first open request takes the number keys, so two slips never answer at once.
  const takesKeys = $derived(
    isOpen && input !== undefined && openConversationInputs(agent.data)[0]?.request.requestId === input.request.requestId,
  );

  const prompt = $derived(
    request?.prompt ??
      (typeof toolInput.question === "string" ? toolInput.question : undefined) ??
      (part ? labels?.get(part.toolCallId) : undefined) ??
      humanizeName(toolName),
  );

  const choices = $derived.by((): Choice[] => {
    if (request?.options?.length) return request.options.map((option) => ({ ...option }));
    const fromInput = toolInput.options;
    if (Array.isArray(fromInput)) {
      return fromInput.flatMap((option) =>
        option && typeof option === "object" && typeof (option as Choice).label === "string"
          ? [{ label: (option as Choice).label, description: (option as Choice).description }]
          : [],
      );
    }
    return kind === "tool-approval"
      ? [
          { id: "approve", label: "Approve", style: "primary" },
          { id: "cancel", label: "Decline", style: "danger" },
        ]
      : [];
  });

  // What you decided, once you have.
  const answer = $derived.by(() => {
    const response = input?.response;
    if (response && "optionId" in response && response.optionId) {
      return choices.find((choice) => choice.id === response.optionId)?.label ?? response.optionId;
    }
    if (response && "text" in response && typeof response.text === "string") return response.text;
    const output = part?.state === "output-available" ? (part.output as Record<string, unknown> | undefined) : undefined;
    if (output && typeof output.answer === "string") return output.answer;
    return undefined;
  });

  const outcome = $derived.by((): "approved" | "declined" | "withdrawn" | "unavailable" | undefined => {
    if (part?.state === "output-denied" || part?.approval?.approved === false) return "declined";
    if (kind === "tool-approval" && (part?.approval?.approved === true || input?.outcome === "approved")) return "approved";
    const output = part?.state === "output-available" ? (part.output as Record<string, unknown> | undefined) : undefined;
    if (output?.interrupted === true || input?.outcome === "cancelled") return "withdrawn";
    if (output?.status === "unavailable") return "unavailable";
    return undefined;
  });

  let chosen = $state<string | undefined>();
  let failure = $state<string | undefined>();
  let showDraft = $state(false);

  async function choose(choice: Choice) {
    if (!input || !isOpen || blocked) return;
    chosen = choice.label;
    failure = undefined;
    try {
      await agent.respond([
        choice.id
          ? { requestId: input.request.requestId, optionId: choice.id }
          : { requestId: input.request.requestId, text: choice.label },
      ]);
    } catch (error) {
      chosen = undefined;
      failure = error instanceof Error ? error.message : String(error);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (!takesKeys || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    // The answer box counts as "not typing" while it's empty, so a digit there picks an option.
    const emptyAnswerBox = target instanceof HTMLTextAreaElement && target.dataset.answerBox !== undefined && target.value === "";
    if (!emptyAnswerBox && target?.closest("input, textarea, [contenteditable='true']")) return;
    const index = Number(event.key) - 1;
    if (Number.isInteger(index) && index >= 0 && index < choices.length) {
      event.preventDefault();
      void choose(choices[index]);
    }
  }

  const heading = $derived(
    kind === "question"
      ? isOpen
        ? "The agent needs your answer"
        : "You were asked"
      : kind === "session-limit"
        ? "Session limit reached"
        : isOpen
          ? toolName === "browser_submit"
            ? "Approve the final submit?"
            : toolName === "approve_application"
              ? "Approve this application?"
              : "Approval needed"
          : toolName === "browser_submit"
            ? "Final submit"
            : toolName === "approve_application"
              ? "Application"
              : "Approval",
  );

  const executing = $derived(outcome === "approved" && part !== undefined && isToolRunning(part.state));
  const executionError = $derived(part?.state === "output-error" ? part.errorText : undefined);
  const settledLabel = $derived(
    outcome === "approved"
      ? executing
        ? toolName === "browser_submit"
          ? "Approved. Pressing Submit in Chrome…"
          : "Approved. Working on it…"
        : executionError
          ? "Approved, but the step failed"
          : "Approved"
      : outcome === "declined"
        ? "Declined"
        : outcome === "withdrawn"
          ? "Withdrawn when you sent a new message"
          : outcome === "unavailable"
            ? "Skipped, since nobody could answer then"
            : undefined,
  );
</script>

<svelte:window onkeydown={onKeydown} />

<section
  class="relative overflow-hidden rounded-2xl border transition-[border-color,box-shadow] duration-300 {isOpen
    ? 'border-marigold/60 bg-sheet shadow-[0_10px_30px_-18px_var(--color-marigold)]'
    : 'border-rule bg-sheet/70'} {fresh ? 'arrive' : ''}"
  aria-live={isOpen ? "polite" : undefined}
>
  <!-- The marigold band marks anything that waits on you. -->
  <span
    class="absolute inset-y-0 left-0 w-1 transition-colors duration-300 {isOpen ? 'bg-marigold' : 'bg-rule'}"
    aria-hidden="true"
  ></span>

  <div class="py-4 pr-4 pl-5 sm:pr-5 sm:pl-6">
    <p class="flex items-center gap-2 text-[13px] {isOpen ? 'font-medium text-marigold-ink' : 'text-pencil'}">
      {#if isOpen}
        <span class="relative flex size-2" aria-hidden="true">
          <span class="absolute inline-flex size-full animate-ping rounded-full bg-marigold opacity-60 motion-reduce:hidden"></span>
          <span class="relative inline-flex size-2 rounded-full bg-marigold"></span>
        </span>
      {/if}
      {heading}
    </p>

    {#if kind === "tool-approval" && toolName === "approve_application"}
      <!-- An application: who, what, and the words that will go out under your name. -->
      <h3 class="mt-2 font-display text-[22px] leading-tight font-semibold tracking-[-0.01em] text-ink">
        {String(toolInput.title ?? "Untitled role")}
      </h3>
      <p class="mt-0.5 text-[15px] text-pencil">
        {String(toolInput.company ?? "")}
        {#if typeof toolInput.url === "string"}
          <a class="ml-2 text-pen underline-offset-2 hover:underline" href={toolInput.url} target="_blank" rel="noreferrer"
            >View posting</a
          >
        {/if}
      </p>
      {#if typeof toolInput.draft === "string" && toolInput.draft.trim()}
        <div class="mt-3 rounded-xl bg-well/70 px-4 py-3">
          <p class="mb-1.5 text-[13px] text-pencil">What will be submitted</p>
          <div
            class="prose prose-chat relative text-[14px] {showDraft || !isOpen ? '' : 'max-h-40 overflow-hidden'}"
          >
            {@html renderMarkdown(toolInput.draft)}
            {#if !showDraft && isOpen}
              <span class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-well to-transparent"
              ></span>
            {/if}
          </div>
          {#if isOpen}
            <button
              type="button"
              class="mt-2 text-[13px] font-medium text-pen hover:underline"
              onclick={() => (showDraft = !showDraft)}>{showDraft ? "Show less" : "Read the full draft"}</button
            >
          {/if}
        </div>
      {/if}
    {:else if kind === "tool-approval" && toolName === "browser_submit"}
      <h3 class="mt-2 font-display text-[22px] leading-tight font-semibold tracking-[-0.01em] text-ink">
        {String(toolInput.summary ?? prompt)}
      </h3>
      {#if isOpen}
        <p class="mt-1.5 text-[14px] text-pencil">
          This presses the final Submit button on the form open in Chrome. It can't be undone.
        </p>
      {/if}
      {#if typeof toolInput.jobUrl === "string"}
        <a
          class="mt-1 inline-block text-[14px] text-pen underline-offset-2 hover:underline"
          href={toolInput.jobUrl}
          target="_blank"
          rel="noreferrer">View posting</a
        >
      {/if}
    {:else}
      <h3
        class="mt-2 font-display leading-snug font-medium tracking-[-0.01em] whitespace-pre-wrap text-ink {isOpen
          ? 'text-[21px]'
          : 'text-[17px]'}"
      >
        {prompt}
      </h3>
      {#if kind === "tool-approval" && isOpen && Object.keys(toolInput).length > 0}
        <details class="mt-2">
          <summary class="cursor-pointer text-[13px] text-pencil hover:text-ink">What it will run</summary>
          <div class="mt-2"><JsonBlock label={toolName} value={prettyJson(toolInput)} /></div>
        </details>
      {/if}
    {/if}

    {#if isOpen || isSending}
      {#if kind === "tool-approval" || choices.every((choice) => !choice.description)}
        <!-- Short choices: one row of buttons. -->
        <div class="mt-4 flex flex-wrap gap-2">
          {#each choices as choice, index (choice.id ?? choice.label)}
            <button
              type="button"
              disabled={!isOpen || blocked}
              onclick={() => void choose(choice)}
              class="group inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[14.5px] font-medium transition-[background-color,box-shadow,opacity] duration-150 disabled:cursor-default {choice.style ===
              'primary'
                ? 'bg-pen text-white dark:text-[#121a2b] shadow-[0_6px_16px_-8px_var(--color-pen)] hover:brightness-110'
                : choice.style === 'danger'
                  ? 'text-brick ring-1 ring-brick/35 ring-inset hover:bg-brick/8'
                  : 'bg-well text-ink ring-1 ring-rule ring-inset hover:ring-pen/50'} {chosen &&
              chosen !== choice.label
                ? 'opacity-40'
                : ''}"
            >
              {#if chosen === choice.label && isSending}
                <span class="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current"></span>
              {:else if choices.length > 1 && takesKeys}
                <kbd
                  class="hidden rounded-md px-1.5 text-[11.5px] font-normal tabular-nums sm:inline {choice.style === 'primary'
                    ? 'bg-white/20'
                    : 'bg-sheet text-pencil'}">{index + 1}</kbd
                >
              {/if}
              {choice.label}
            </button>
          {/each}
        </div>
      {:else}
        <!-- Considered choices: each option with its reasoning, as a list to pick from. -->
        <ul class="mt-4 grid gap-2">
          {#each choices as choice, index (choice.id ?? choice.label)}
            <li class={fresh ? "arrive" : ""} style="--stagger: {index + 1}">
              <button
                type="button"
                disabled={!isOpen || blocked}
                onclick={() => void choose(choice)}
                class="group flex w-full items-start gap-3.5 rounded-xl border px-4 py-3 text-left transition-[border-color,background-color,opacity] duration-150 disabled:cursor-default {chosen ===
                choice.label
                  ? 'border-pen bg-pen-soft'
                  : 'border-rule bg-bg/40 hover:border-pen/60 hover:bg-pen-soft/40'} {chosen && chosen !== choice.label
                  ? 'opacity-40'
                  : ''}"
              >
                <span
                  class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg text-[12.5px] font-medium tabular-nums transition-colors {chosen ===
                  choice.label
                    ? 'bg-pen text-white dark:text-[#121a2b]'
                    : 'bg-well text-pencil group-hover:bg-pen group-hover:text-white dark:group-hover:text-[#121a2b]'}"
                >
                  {#if chosen === choice.label && isSending}
                    <span class="size-3 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
                  {:else}
                    {index + 1}
                  {/if}
                </span>
                <span class="min-w-0">
                  <span class="block text-[15px] font-medium text-ink">{choice.label}</span>
                  {#if choice.description}
                    <span class="mt-0.5 block text-[13.5px] leading-snug text-pencil">{choice.description}</span>
                  {/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if kind === "question" && request?.allowFreeform !== false && isOpen}
        <p class="mt-3 text-[13px] text-pencil">
          {choices.length > 0 ? "Or type your own answer in the message box below." : "Type your answer in the message box below."}
        </p>
      {/if}
      {#if failure}
        <p class="mt-2 text-[13px] text-brick">Couldn't send your answer: {failure}</p>
      {/if}
    {:else}
      <!-- Settled: the record of what you decided. -->
      <div class="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
        {#if answer && kind !== "tool-approval"}
          <span class="text-pencil">You answered</span>
          <span class="rounded-lg bg-pen-soft px-2.5 py-1 font-medium text-pen">{answer}</span>
        {/if}
        {#if settledLabel}
          <span
            class="inline-flex items-center gap-1.5 {outcome === 'declined' || executionError
              ? 'text-brick'
              : outcome === 'approved'
                ? 'text-sage'
                : 'text-pencil'}"
          >
            {#if executing}
              <span class="size-3.5 animate-spin rounded-full border-2 border-pen/25 border-t-pen"></span>
            {:else if outcome === "approved" && !executionError}
              <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                ><path d="m5 12.5 4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round" /></svg
              >
            {/if}
            {settledLabel}
          </span>
        {:else if !answer}
          <span class="text-pencil">Waiting for the agent to continue…</span>
        {/if}
      </div>
      {#if executionError}
        <p class="mt-1.5 text-[13px] text-brick">{executionError}</p>
      {/if}
    {/if}
  </div>
</section>
