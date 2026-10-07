<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { Snippet } from "svelte";

  let {
    status,
    title,
    preview,
    duration,
    open = $bindable(false),
    details,
    children,
  }: {
    status: "running" | "done" | "failed" | "thought";
    title: string;
    /** A one-line hint of what the step was given. */
    preview?: string;
    duration?: string;
    open?: boolean;
    /** Shown when the step is opened, e.g. the call's input and output. */
    details?: Snippet;
    /** Always shown under the step, e.g. a subagent's own work. */
    children?: Snippet;
  } = $props();
</script>

<li class="relative">
  <span
    class={cn(
      "absolute top-[7px] -left-6 size-2 rounded-full ring-4 ring-background",
      status === "running" && "animate-pulse bg-foreground",
      status === "done" && "bg-muted-foreground/50",
      status === "failed" && "bg-destructive",
      status === "thought" && "border-[1.5px] border-muted-foreground/60 bg-background",
    )}
    aria-hidden="true"
  ></span>

  {#snippet line()}
    <span class="min-w-0 flex-1 truncate">
      <span
        class={cn(
          status === "running"
            ? "shimmer"
            : status === "failed"
              ? "text-destructive"
              : "text-foreground/80 group-hover/step:text-foreground",
        )}>{title}</span
      >
      {#if preview}
        <span class="ml-1.5 text-muted-foreground/80">{preview}</span>
      {/if}
    </span>
    {#if duration}
      <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{duration}</span>
    {/if}
  {/snippet}

  {#if details}
    <button
      type="button"
      class="group/step flex w-full items-baseline gap-3 rounded-sm py-0.5 text-left text-sm"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      {@render line()}
    </button>
  {:else}
    <div class="flex w-full items-baseline gap-3 py-0.5 text-sm">{@render line()}</div>
  {/if}

  {#if children}
    <div class="mt-1.5">{@render children()}</div>
  {/if}

  {#if open && details}
    <div class="mt-2 mb-2 grid gap-3 animate-in fade-in-0 slide-in-from-top-1">{@render details()}</div>
  {/if}
</li>
