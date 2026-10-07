<script lang="ts">
  import * as Message from "#lib/components/chat/message/index.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import { cn } from "#lib/utils.ts";
  import PaperclipIcon from "@lucide/svelte/icons/paperclip";
  import type { ConversationState, EveMessage, UseEveAgentReturn } from "eve/svelte";
  import { untrack } from "svelte";
  import AgentActivity from "./agent-activity.svelte";
  import AgentDecision from "./agent-decision.svelte";
  import { type StreamInsights, segmentParts } from "./format.ts";

  let {
    agent,
    message,
    insights,
    streaming,
    fresh,
    lazy,
  }: {
    agent: UseEveAgentReturn<ConversationState>;
    message: EveMessage;
    insights: StreamInsights;
    /** The reply being written right now. */
    streaming: boolean;
    /** Arrived while you were watching. */
    fresh: boolean;
    /** Well above the fold: skip layout and paint until scrolled near. */
    lazy: boolean;
  } = $props();

  // A finished message only needs the conversation and stream stats as they were when it ended;
  // it stops following them, so the reply being streamed below doesn't re-render it every frame.
  const conversation = $derived(streaming ? agent.conversation : untrack(() => agent.conversation));
  const stats = $derived(streaming ? insights : untrack(() => insights));

  const segments = $derived(message.role === "user" ? [] : segmentParts(message.parts));
  const text = $derived(
    message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n")
      .trim(),
  );
</script>

<!-- A reply that failed before saying anything has nothing to show; the thread says why. -->
{#if message.role === "user" || segments.length > 0}
  <Message.Root
    from={message.role === "user" ? "user" : "assistant"}
    class={cn(lazy && "lazy-block", fresh && "arrive")}
  >
    {#if message.role === "user"}
      <Message.Content
        class={cn(
          message.metadata?.status === "failed" && "ring-1 ring-destructive",
          message.metadata?.optimistic && "opacity-70",
        )}
      >
        {#each message.parts as part, index (index)}
          {#if part.type === "text"}
            {part.text}
          {:else if part.type === "file"}
            <span class="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <PaperclipIcon class="size-3.5" />{part.filename ?? part.mediaType}
            </span>
          {/if}
        {/each}
      </Message.Content>
      {#if message.metadata?.status === "failed"}
        <span class="text-xs text-destructive">Not sent. Try again.</span>
      {/if}
    {:else}
      <Message.Content>
        {#each segments as segment (segment.key)}
          {#if segment.kind === "text"}
            <Message.Markdown text={segment.part.text} streaming={segment.part.state === "streaming"} />
          {:else if segment.kind === "work"}
            <AgentActivity parts={segment.parts} {conversation} insights={stats} {fresh} />
          {:else if segment.kind === "decision"}
            <AgentDecision {agent} part={segment.part} labels={stats.labels} {fresh} />
          {:else if segment.part.type === "authorization"}
            {@const auth = segment.part}
            <div class="rounded-xl border bg-card px-5 py-4">
              {#if auth.state === "completed"}
                <p class="text-sm text-muted-foreground">
                  {auth.outcome === "authorized"
                    ? `Connected to ${auth.displayName}.`
                    : `${auth.displayName} sign-in ${auth.outcome}.`}
                </p>
              {:else}
                <p class="font-medium">Sign in to {auth.displayName}</p>
                <p class="mt-1 text-sm text-muted-foreground">
                  {auth.authorization?.instructions ?? auth.description}
                </p>
                <div class="mt-3 flex flex-wrap items-center gap-3">
                  {#if auth.authorization?.userCode}
                    <code class="rounded-md bg-muted px-2.5 py-1 font-mono text-sm">{auth.authorization.userCode}</code>
                  {/if}
                  {#if auth.authorization?.url}
                    <Button href={auth.authorization.url} target="_blank" rel="noreferrer">
                      Sign in to {auth.displayName}
                    </Button>
                  {/if}
                </div>
              {/if}
            </div>
          {:else if segment.part.type === "file"}
            <p class="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <PaperclipIcon class="size-3.5" />{segment.part.filename ?? segment.part.mediaType}
            </p>
          {/if}
        {/each}
      </Message.Content>
      {#if text && !streaming}
        <Message.Actions>
          <Message.Copy {text} />
        </Message.Actions>
      {/if}
    {/if}
  </Message.Root>
{/if}
