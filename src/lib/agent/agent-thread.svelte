<script lang="ts">
  import * as Conversation from "#lib/components/chat/conversation/index.ts";
  import * as Suggestions from "#lib/components/chat/suggestions/index.ts";
  import WorkingIndicator from "#lib/components/chat/working-indicator.svelte";
  import * as Alert from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import SearchIcon from "@lucide/svelte/icons/search";
  import TrophyIcon from "@lucide/svelte/icons/trophy";
  import UserRoundIcon from "@lucide/svelte/icons/user-round";
  import type { ConversationState, EveMessage, UseEveAgentReturn } from "eve/svelte";
  import { untrack } from "svelte";
  import type { AgentActivity } from "./activity.ts";
  import AgentMessage from "./agent-message.svelte";
  import { type StreamInsights, lastTurnFailure } from "./format.ts";

  let {
    agent,
    insights,
    activity,
    busySince,
    onPick,
    onRetry,
  }: {
    agent: UseEveAgentReturn<ConversationState>;
    insights: StreamInsights;
    activity: AgentActivity;
    /** When the running turn started, for the working indicator's timer. */
    busySince?: number;
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

  const busy = $derived(agent.status === "submitted" || agent.status === "streaming");
  const count = $derived(agent.data.messages.length);
  const failure = $derived(lastTurnFailure(agent.data, agent.events));
  const stopped = $derived(Object.values(agent.data.turns).at(-1)?.status === "cancelled");
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
        <AgentMessage
          {agent}
          {message}
          {insights}
          streaming={busy && index === count - 1}
          fresh={!historyIds.has(message.id)}
          lazy={!busy && historyIds.has(message.id) && index < count - 3}
        />
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

      {#if stopped && !busy}
        <p class="text-[13px] text-muted-foreground">You stopped this reply.</p>
      {/if}

      {#if activity.working}
        <!-- Always in view at the end of the thread while the agent works. -->
        <WorkingIndicator label={activity.label} since={busySince} />
      {/if}
    {/if}
  </Conversation.Content>
  <Conversation.ScrollButton />
</Conversation.Root>
