<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import { fly } from "svelte/transition";

  let {
    label,
    since,
    class: className,
  }: {
    /** What's happening now, e.g. "Searching the web". */
    label: string;
    /** When the work started (ms since epoch); shows a running timer. */
    since?: number;
    class?: string;
  } = $props();

  // One clock per indicator, ticking only while it's on screen.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  const elapsed = $derived(since === undefined ? undefined : Math.max(0, Math.floor((now - since) / 1000)));
  const clock = $derived(
    elapsed === undefined ? "" : elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`,
  );
</script>

<div
  role="status"
  aria-live="polite"
  class={cn("flex items-center gap-3 text-sm", className)}
  in:fly={{ y: 4, duration: 180 }}
>
  <span class="flex h-5 items-center gap-1" aria-hidden="true">
    <span class="working-dot"></span>
    <span class="working-dot [animation-delay:160ms]"></span>
    <span class="working-dot [animation-delay:320ms]"></span>
  </span>
  <span class="min-w-0 truncate shimmer">{label}…</span>
  {#if clock}
    <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{clock}</span>
  {/if}
</div>
