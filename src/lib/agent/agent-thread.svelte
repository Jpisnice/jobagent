<script lang="ts">
  import * as Conversation from "#lib/components/chat/conversation/index.ts";
  import * as Message from "#lib/components/chat/message/index.ts";
  import * as Suggestions from "#lib/components/chat/suggestions/index.ts";
  import * as Alert from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { cn } from "#lib/utils.ts";
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import PaperclipIcon from "@lucide/svelte/icons/paperclip";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import SearchIcon from "@lucide/svelte/icons/search";
  import TrophyIcon from "@lucide/svelte/icons/trophy";
  import UserRoundIcon from "@lucide/svelte/icons/user-round";
  import type { ConversationState, EveMessage, UseEveAgentReturn } from "eve/svelte";
  import { untrack } from "svelte";
  import AgentActivity from "./agent-activity.svelte";
  import AgentDecision from "./agent-decision.svelte";
  import { type StreamInsights, lastTurnFailure, segmentParts } from "./format.ts";

  let {
    agent,
    insights,
    onPick,
    onRetry,
  }: {
    agent: UseEveAgentReturn<ConversationState>;
    insights: StreamInsights;
    onPick: (prompt: string) => void;
    /** Sends your last message again after a failed reply. */
    onRetry: (text: string) => void;
  } = $props();

  const STARTERS = [
    {
      title: "Set up my profile",
      description: "Tell me what you're after, or share a resume",
      prompt: "Help me set up my job-search profile.",
      icon: UserRoundIcon,
    },
    {
      title: "Find jobs that fit me",
      description: "Search boards and screen against your profile",
      prompt: "Find new jobs that match my profile and screen them.",
      icon: SearchIcon,
    },
    {
      title: "Show my best matches",
      description: "Screened jobs, strongest fit first",
      prompt: "Show me the jobs you've screened so far, best matches first.",
      icon: TrophyIcon,
    },
    {
      title: "Check what my profile is missing",
      description: "Gaps that weaken screening",
      prompt: "What's my profile status? Is anything missing?",
      icon: ListChecksIcon,
    },
  ];

  // Messages already here when the chat opened render still; only new ones animate in.
  const historyIds = new Set(untrack(() => agent.data.messages.map((message) => message.id)));
  const isFresh = (message: EveMessage) => !historyIds.has(message.id);

  const busy = $derived(agent.status === "submitted" || agent.status === "streaming");
  const lastIsUser = $derived(agent.data.messages.at(-1)?.role === "user");
  const count = $derived(agent.data.messages.length);
  const failure = $derived(lastTurnFailure(agent.data, agent.events));
  const lastUserText = $derived.by(() => {
    const message = agent.data.messages.findLast((candidate) => candidate.role === "user");
    return message ? plainText(message) : "";
  });

  function plainText(message: EveMessage): string {
    return message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n")
      .trim();
  }
</script>

<Conversation.Root>
  <Conversation.Content>
    {#if agent.status === "resuming" && count === 0}
      <!-- Restoring a conversation: hold its shape while it loads. -->
      <div class="flex flex-col gap-6" aria-label="Loading conversation">
        <Skeleton class="ml-auto h-10 w-2/5 rounded-2xl" />
        <div class="flex flex-col gap-2.5">
          <Skeleton class="h-3.5 w-11/12" />
          <Skeleton class="h-3.5 w-4/5" />
          <Skeleton class="h-3.5 w-3/5" />
        </div>
      </div>
    {:else if count === 0}
      <Conversation.Empty
        title="What should we work on?"
        description="I search job boards and company sites, screen what I find against your profile, and draft applications. Nothing gets submitted until you approve it."
      >
        <Suggestions.Root>
          {#each STARTERS as starter (starter.title)}
            <Suggestions.Item
              title={starter.title}
              description={starter.description}
              icon={starter.icon}
              onclick={() => onPick(starter.prompt)}
            />
          {/each}
        </Suggestions.Root>
      </Conversation.Empty>
    {:else}
      {#each agent.data.messages as message, index (message.id)}
        {@const fresh = isFresh(message)}
        {@const streaming = busy && index === count - 1}
        {@const segments = message.role === "user" ? [] : segmentParts(message.parts)}
        <!-- A reply that failed before saying anything has nothing to show; the failure says why. -->
        {#if message.role === "user" || segments.length > 0}
          <!-- Turns well above the fold skip rendering work until you scroll to them. -->
          <Message.Root
            from={message.role === "user" ? "user" : "assistant"}
            class={cn(!fresh && index < count - 3 && "lazy-block", fresh && "arrive")}
          >
            {#if message.role === "user"}
              <Message.Content
                class={cn(
                  message.metadata?.status === "failed" && "ring-1 ring-destructive",
                  message.metadata?.optimistic && "opacity-70",
                )}
              >
                {#each message.parts as part, partIndex (partIndex)}
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
                    <Message.Markdown
                      text={segment.part.text}
                      streaming={segment.part.state === "streaming"}
                      animate={fresh}
                    />
                  {:else if segment.kind === "work"}
                    <AgentActivity parts={segment.parts} conversation={agent.conversation} {insights} {fresh} />
                  {:else if segment.kind === "decision"}
                    <AgentDecision {agent} part={segment.part} labels={insights.labels} {fresh} />
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
              {@const text = plainText(message)}
              {#if text && !streaming}
                <Message.Actions>
                  <Message.Copy {text} />
                </Message.Actions>
              {/if}
            {/if}
          </Message.Root>
        {/if}
      {/each}

      {#if failure && !busy}
        <Alert.Root variant="destructive" class="arrive">
          <CircleAlertIcon />
          <Alert.Title>The agent couldn't finish this reply</Alert.Title>
          <Alert.Description class="break-words">{failure.message}</Alert.Description>
          {#if lastUserText}
            <Alert.Action>
              <Button size="sm" variant="outline" onclick={() => onRetry(lastUserText)}>
                <RotateCcwIcon />Try again
              </Button>
            </Alert.Action>
          {/if}
        </Alert.Root>
      {/if}

      {#if busy && lastIsUser}
        <!-- Between your message and the agent's first word. -->
        <p class="arrive text-sm" aria-label="The agent is reading your message">
          <span class="shimmer">Reading your message…</span>
        </p>
      {/if}
    {/if}
  </Conversation.Content>
  <Conversation.ScrollButton />
</Conversation.Root>
