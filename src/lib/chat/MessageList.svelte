<script lang="ts">
  import type { ConversationState, EveMessage, UseEveAgentReturn } from "eve/svelte";
  import { tick, untrack } from "svelte";
  import DecisionSlip from "./DecisionSlip.svelte";
  import StreamingText from "./StreamingText.svelte";
  import WorkLog from "./WorkLog.svelte";
  import { type StreamInsights, segmentParts } from "./format.ts";

  let {
    agent,
    insights,
    onPick,
  }: {
    agent: UseEveAgentReturn<ConversationState>;
    insights: StreamInsights;
    onPick: (prompt: string) => void;
  } = $props();

  const STARTERS = [
    { action: "Set up my profile", prompt: "Help me set up my job-search profile." },
    { action: "Find jobs that fit me", prompt: "Find new jobs that match my profile and screen them." },
    { action: "Show my best matches", prompt: "Show me the jobs you've screened so far, best matches first." },
    { action: "Check what my profile is missing", prompt: "What's my profile status? Is anything missing?" },
  ];

  // Messages already here when the chat opened render still; only new ones animate in.
  const historyIds = new Set(untrack(() => agent.data.messages.map((message) => message.id)));
  const isFresh = (message: EveMessage) => !historyIds.has(message.id);

  let scroller: HTMLDivElement | undefined = $state();
  let pinned = true;

  function onScroll() {
    if (!scroller) return;
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  }

  // Follow the stream while you're at the bottom; stay put once you scroll up to read.
  $effect(() => {
    void agent.data.messages.length;
    void agent.events.length;
    if (!pinned) return;
    void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
  });

  const busy = $derived(agent.status === "submitted" || agent.status === "streaming");
  const lastIsUser = $derived(agent.data.messages.at(-1)?.role === "user");
  const count = $derived(agent.data.messages.length);
</script>

<div bind:this={scroller} onscroll={onScroll} class="h-full overflow-y-auto">
  <div class="mx-auto w-full max-w-[46rem] px-4 pt-8 pb-10 sm:px-6">
    {#if agent.status === "resuming" && count === 0}
      <!-- Restoring a conversation: hold its shape while it loads. -->
      <div class="space-y-6" aria-label="Loading conversation">
        <div class="ml-auto h-10 w-2/5 skeleton rounded-2xl"></div>
        <div class="space-y-2.5">
          <div class="h-3.5 w-11/12 skeleton"></div>
          <div class="h-3.5 w-4/5 skeleton"></div>
          <div class="h-3.5 w-3/5 skeleton"></div>
        </div>
        <div class="h-12 w-full skeleton rounded-xl"></div>
      </div>
    {:else if count === 0}
      <div class="flex min-h-[58vh] flex-col justify-center arrive">
        <h1 class="font-display text-[clamp(2rem,5vw,2.9rem)] leading-[1.05] font-semibold tracking-[-0.025em] text-ink">
          What should we work on today?
        </h1>
        <p class="mt-3 max-w-[34rem] text-[16px] leading-relaxed text-pencil">
          I search job boards and company sites, screen what I find against your profile, and draft
          applications. Nothing gets submitted until you approve it.
        </p>
        <ul class="mt-8 border-t border-rule">
          {#each STARTERS as starter, index (starter.action)}
            <li class="arrive border-b border-rule" style="--stagger: {index + 2}">
              <button
                type="button"
                class="group flex w-full items-center justify-between gap-4 py-3.5 text-left"
                onclick={() => onPick(starter.prompt)}
              >
                <span class="text-[16px] text-ink transition-colors group-hover:text-pen">{starter.action}</span>
                <svg
                  class="size-4 shrink-0 -translate-x-1 text-faint opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:text-pen group-hover:opacity-100 group-focus-visible:opacity-100"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" /></svg
                >
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {:else}
      <div class="space-y-7">
        {#each agent.data.messages as message, index (message.id)}
          {@const fresh = isFresh(message)}
          <!-- Turns well above the fold skip rendering work until you scroll to them. -->
          <article class="{!fresh && index < count - 3 ? 'lazy-block' : ''} {fresh ? 'arrive' : ''}">
            {#if message.role === "user"}
              <div class="flex justify-end">
                <div
                  class="max-w-[85%] rounded-2xl rounded-br-md bg-pen-soft px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-ink {message
                    .metadata?.status === 'failed'
                    ? 'ring-1 ring-brick'
                    : message.metadata?.optimistic
                      ? 'opacity-70'
                      : ''}"
                >
                  {#each message.parts as part, partIndex (partIndex)}
                    {#if part.type === "text"}
                      {part.text}
                    {:else if part.type === "file"}
                      <span class="mt-1 block text-[13px] text-pencil">Attached {part.filename ?? part.mediaType}</span>
                    {/if}
                  {/each}
                  {#if message.metadata?.status === "failed"}
                    <span class="mt-1 block text-[12.5px] text-brick">Not sent. Try again.</span>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="space-y-3.5">
                {#each segmentParts(message.parts) as segment (segment.key)}
                  {#if segment.kind === "text"}
                    <StreamingText
                      text={segment.part.text}
                      streaming={segment.part.state === "streaming"}
                      animate={fresh}
                    />
                  {:else if segment.kind === "work"}
                    <WorkLog parts={segment.parts} conversation={agent.conversation} {insights} {fresh} />
                  {:else if segment.kind === "decision"}
                    <DecisionSlip {agent} part={segment.part} labels={insights.labels} {fresh} />
                  {:else if segment.part.type === "authorization"}
                    {@const auth = segment.part}
                    <div class="rounded-2xl border border-rule bg-sheet px-5 py-4">
                      {#if auth.state === "completed"}
                        <p class="text-[14px] text-pencil">
                          {auth.outcome === "authorized"
                            ? `Connected to ${auth.displayName}.`
                            : `${auth.displayName} sign-in ${auth.outcome}.`}
                        </p>
                      {:else}
                        <p class="font-display text-[18px] font-medium text-ink">Sign in to {auth.displayName}</p>
                        <p class="mt-1 text-[14px] text-pencil">{auth.authorization?.instructions ?? auth.description}</p>
                        <div class="mt-3 flex flex-wrap items-center gap-3">
                          {#if auth.authorization?.userCode}
                            <code class="rounded-lg bg-well px-2.5 py-1 font-mono text-[14px] text-ink"
                              >{auth.authorization.userCode}</code
                            >
                          {/if}
                          {#if auth.authorization?.url}
                            <a
                              class="rounded-xl bg-pen px-4 py-2 text-[14px] font-medium text-white dark:text-[#121a2b]"
                              href={auth.authorization.url}
                              target="_blank"
                              rel="noreferrer">Sign in to {auth.displayName}</a
                            >
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {:else if segment.part.type === "file"}
                    <p class="text-[13px] text-pencil">File: {segment.part.filename ?? segment.part.mediaType}</p>
                  {/if}
                {/each}
              </div>
            {/if}
          </article>
        {/each}

        {#if busy && lastIsUser}
          <!-- Between your message and the agent's first word. -->
          <div class="arrive space-y-2.5" aria-label="The agent is reading your message">
            <div class="h-3.5 w-3/4 skeleton"></div>
            <div class="h-3.5 w-1/2 skeleton"></div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
