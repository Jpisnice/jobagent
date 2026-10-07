<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { Snippet } from "svelte";

  let {
    title,
    description,
    class: className,
    children,
  }: { title: string; description?: string; class?: string; children?: Snippet } = $props();
</script>

<div class={cn("my-auto flex flex-col py-10", className)}>
  <h1 class="text-[28px] leading-tight font-semibold tracking-tight text-balance">{title}</h1>
  {#if description}
    <p class="mt-2 max-w-xl text-[15px] leading-relaxed text-pretty text-muted-foreground">{description}</p>
  {/if}
  {#if children}
    <div class="mt-8">{@render children()}</div>
  {/if}
</div>
