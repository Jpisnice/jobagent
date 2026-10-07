<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import { Kbd } from "#lib/components/ui/kbd/index.js";
  import { cn } from "#lib/utils.ts";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import type { Snippet } from "svelte";
  import { getOptionsLayout } from "./context.ts";

  let {
    shortcut,
    description,
    variant = "default",
    selected = false,
    pending = false,
    dimmed = false,
    disabled = false,
    onclick,
    children,
  }: {
    /** The number key that picks this option; shown as a key cap. */
    shortcut?: number;
    description?: string;
    variant?: "primary" | "danger" | "default";
    selected?: boolean;
    /** The choice was sent and the agent hasn't picked it up yet. */
    pending?: boolean;
    /** Another option was chosen. */
    dimmed?: boolean;
    disabled?: boolean;
    onclick: () => void;
    children: Snippet;
  } = $props();

  const layout = getOptionsLayout();
</script>

{#if layout() === "row"}
  <Button
    variant={variant === "primary" ? "default" : variant === "danger" ? "destructive" : "outline"}
    size="lg"
    {disabled}
    {onclick}
    class={cn("px-3.5 disabled:opacity-100", dimmed && "opacity-40")}
  >
    {#if pending}
      <LoaderIcon class="animate-spin" />
    {:else if shortcut !== undefined}
      <Kbd
        class={cn(
          "hidden tabular-nums sm:inline-flex",
          variant === "primary" && "bg-primary-foreground/15 text-primary-foreground",
        )}>{shortcut}</Kbd
      >
    {/if}
    {@render children()}
  </Button>
{:else}
  <button
    type="button"
    {disabled}
    {onclick}
    class={cn(
      "group/option flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-[border-color,background-color,opacity] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
      selected ? "border-foreground/40 bg-muted" : "bg-background enabled:hover:border-foreground/30 enabled:hover:bg-muted/50",
      dimmed && "opacity-40",
    )}
  >
    <span
      class={cn(
        "mt-px grid size-6 shrink-0 place-items-center rounded-md text-xs font-medium tabular-nums transition-colors",
        selected
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground group-enabled/option:group-hover/option:bg-primary group-enabled/option:group-hover/option:text-primary-foreground",
      )}
    >
      {#if pending}
        <LoaderIcon class="size-3.5 animate-spin" />
      {:else}
        {shortcut ?? ""}
      {/if}
    </span>
    <span class="min-w-0">
      <span class="block text-[15px] font-medium">{@render children()}</span>
      {#if description}
        <span class="mt-0.5 block text-sm leading-snug text-muted-foreground">{description}</span>
      {/if}
    </span>
  </button>
{/if}
