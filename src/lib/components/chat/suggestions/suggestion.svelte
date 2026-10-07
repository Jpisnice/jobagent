<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { Component } from "svelte";

  let {
    title,
    description,
    icon: Icon,
    onclick,
    class: className,
  }: {
    title: string;
    description?: string;
    icon?: Component<{ class?: string }>;
    onclick: () => void;
    class?: string;
  } = $props();
</script>

<button
  type="button"
  {onclick}
  class={cn(
    "group/suggestion flex items-start gap-3 rounded-xl border bg-background px-4 py-3 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50",
    className,
  )}
>
  {#if Icon}
    <Icon class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover/suggestion:text-foreground" />
  {/if}
  <span class="min-w-0">
    <span class="block text-sm font-medium">{title}</span>
    {#if description}
      <span class="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{description}</span>
    {/if}
  </span>
</button>
