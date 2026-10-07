<script lang="ts">
  import CodeBlock from "#lib/components/chat/code-block.svelte";
  import * as Decision from "#lib/components/chat/decision/index.ts";
  import { renderMarkdown } from "#lib/components/chat/markdown.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Collapsible from "#lib/components/ui/collapsible/index.js";
  import { cn } from "#lib/utils.ts";
  import CheckIcon from "@lucide/svelte/icons/check";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import type { ConversationInput, ConversationState, EveDynamicToolPart, UseEveAgentReturn } from "eve/svelte";
  import { openConversationInputs } from "eve/svelte";
  import { humanizeName, inputForCall, isToolRunning, prettyJson } from "./format.ts";

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

  // The first open request takes the number keys, so two decisions never answer at once.
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
    const emptyAnswerBox =
      target instanceof HTMLTextAreaElement && target.dataset.answerBox !== undefined && target.value === "";
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

  const draft = $derived(typeof toolInput.draft === "string" && toolInput.draft.trim() ? toolInput.draft : undefined);
  const postingUrl = $derived(
    typeof toolInput.url === "string" ? toolInput.url : typeof toolInput.jobUrl === "string" ? toolInput.jobUrl : undefined,
  );
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet posting()}
  {#if postingUrl}
    <Button variant="link" size="sm" href={postingUrl} target="_blank" rel="noreferrer" class="h-auto px-0 text-sm">
      View posting <ExternalLinkIcon class="size-3.5" />
    </Button>
  {/if}
{/snippet}

<Decision.Root open={isOpen} class={cn(fresh && "arrive")}>
  <Decision.Header>{heading}</Decision.Header>

  {#if kind === "tool-approval" && toolName === "approve_application"}
    <!-- An application: who, what, and the words that will go out under your name. -->
    <Decision.Title>{String(toolInput.title ?? "Untitled role")}</Decision.Title>
    <div class="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
      <span>{String(toolInput.company ?? "")}</span>
      {@render posting()}
    </div>
    {#if draft}
      <div class="mt-3 rounded-lg border bg-muted/40 px-4 py-3">
        <p class="mb-1.5 text-xs font-medium text-muted-foreground">What will be submitted</p>
        <div
          class={cn(
            "prose prose-chat relative text-sm dark:prose-invert",
            !showDraft && isOpen && "max-h-40 overflow-hidden",
          )}
        >
          {@html renderMarkdown(draft)}
          {#if !showDraft && isOpen}
            <span class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-muted to-transparent"
            ></span>
          {/if}
        </div>
        {#if isOpen}
          <Button variant="link" size="sm" class="mt-1 h-auto px-0" onclick={() => (showDraft = !showDraft)}>
            {showDraft ? "Show less" : "Read the full draft"}
          </Button>
        {/if}
      </div>
    {/if}
  {:else if kind === "tool-approval" && toolName === "browser_submit"}
    <Decision.Title>{String(toolInput.summary ?? prompt)}</Decision.Title>
    {#if isOpen}
      <Decision.Description>
        This presses the final Submit button on the form open in Chrome. It can't be undone.
      </Decision.Description>
    {/if}
    {@render posting()}
  {:else}
    <Decision.Title>{prompt}</Decision.Title>
    {#if kind === "tool-approval" && isOpen && Object.keys(toolInput).length > 0}
      <Collapsible.Root class="mt-2">
        <Collapsible.Trigger
          class="group/run flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRightIcon class="size-3.5 transition-transform group-data-[state=open]/run:rotate-90" />
          What it will run
        </Collapsible.Trigger>
        <Collapsible.Content>
          <CodeBlock class="mt-2" label={toolName} code={prettyJson(toolInput)} />
        </Collapsible.Content>
      </Collapsible.Root>
    {/if}
  {/if}

  {#if isOpen || isSending}
    <Decision.Options layout={kind === "tool-approval" || choices.every((choice) => !choice.description) ? "row" : "list"}>
      {#each choices as choice, index (choice.id ?? choice.label)}
        <Decision.Option
          shortcut={takesKeys && choices.length > 1 ? index + 1 : undefined}
          description={choice.description}
          variant={choice.style ?? "default"}
          selected={chosen === choice.label}
          pending={chosen === choice.label && isSending}
          dimmed={chosen !== undefined && chosen !== choice.label}
          disabled={!isOpen || blocked}
          onclick={() => void choose(choice)}
        >
          {choice.label}
        </Decision.Option>
      {/each}
    </Decision.Options>

    {#if kind === "question" && request?.allowFreeform !== false && isOpen}
      <p class="mt-3 text-[13px] text-muted-foreground">
        {choices.length > 0 ? "Or type your own answer in the message box." : "Type your answer in the message box."}
      </p>
    {/if}
    {#if failure}
      <p class="mt-2 text-[13px] text-destructive">Your answer didn't send: {failure}</p>
    {/if}
  {:else}
    <!-- Settled: the record of what you decided. -->
    <Decision.Result>
      {#if answer && kind !== "tool-approval"}
        <span class="text-muted-foreground">You answered</span>
        <span class="rounded-md bg-muted px-2 py-0.5 font-medium">{answer}</span>
      {/if}
      {#if settledLabel}
        <span
          class={cn(
            "inline-flex items-center gap-1.5",
            outcome === "declined" || executionError
              ? "text-destructive"
              : outcome === "approved"
                ? "text-success"
                : "text-muted-foreground",
          )}
        >
          {#if executing}
            <LoaderIcon class="size-3.5 animate-spin" />
          {:else if outcome === "approved" && !executionError}
            <CheckIcon class="size-4" />
          {/if}
          {settledLabel}
        </span>
      {:else if !answer}
        <span class="text-muted-foreground">Waiting for the agent to continue…</span>
      {/if}
    </Decision.Result>
    {#if executionError}
      <p class="mt-1.5 text-[13px] text-destructive">{executionError}</p>
    {/if}
  {/if}
</Decision.Root>
