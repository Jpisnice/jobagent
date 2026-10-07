<script lang="ts">
  import * as Collapsible from "#lib/components/ui/collapsible/index.js";
  import { cn } from "#lib/utils.ts";
  import CheckIcon from "@lucide/svelte/icons/check";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import type { Snippet } from "svelte";

  let {
    status,
    duration,
    note,
    class: className,
    children,
  }: {
    status: "running" | "done" | "failed";
    /** Formatted time the work took, shown once it's done. */
    duration?: string;
    /** A short trailing remark, e.g. "1 failed". */
    note?: string;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<Collapsible.Trigger
  class={cn(
    "group/activity flex max-w-full items-center gap-2 rounded-md py-0.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground",
    className,
  )}
>
  {#if status === "running"}
    <LoaderIcon class="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
  {:else if status === "failed"}
    <CircleAlertIcon class="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
  {:else}
    <CheckIcon class="size-3.5 shrink-0" aria-hidden="true" />
  {/if}
  <span class={cn("min-w-0 truncate", status === "running" && "shimmer")}>{@render children()}</span>
  {#if note}
    <span class="shrink-0 text-xs text-destructive">{note}</span>
  {/if}
  {#if duration}
    <span class="shrink-0 text-xs tabular-nums opacity-70">{duration}</span>
  {/if}
  <ChevronRightIcon
    class="size-3.5 shrink-0 opacity-60 transition-transform duration-200 group-data-[state=open]/activity:rotate-90"
    aria-hidden="true"
  />
</Collapsible.Trigger>
