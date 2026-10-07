<script lang="ts">
  import { cn } from "#lib/utils.ts";
  import type { Snippet } from "svelte";
  import { setPromptInput } from "./context.ts";

  let {
    value = $bindable(""),
    disabled = false,
    variant = "default",
    onSubmit,
    class: className,
    children,
  }: {
    value?: string;
    disabled?: boolean;
    /** `attention` when the box answers something the agent is waiting on. */
    variant?: "default" | "attention";
    /** Called with the trimmed text; the box clears first. */
    onSubmit: (text: string) => void;
    class?: string;
    children: Snippet;
  } = $props();

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    value = "";
    onSubmit(text);
  }

  setPromptInput({
    get value() {
      return value;
    },
    set value(next) {
      value = next;
    },
    get disabled() {
      return disabled;
    },
    get canSubmit() {
      return !disabled && value.trim().length > 0;
    },
    submit,
  });
</script>

<form
  class={cn(
    "flex flex-col rounded-2xl border bg-background shadow-sm transition-[border-color,box-shadow] duration-200",
    variant === "attention"
      ? "border-attention/70 ring-4 ring-attention/15"
      : "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25",
    className,
  )}
  onsubmit={(event) => {
    event.preventDefault();
    submit();
  }}
>
  {@render children()}
</form>
