<script lang="ts">
  import { prettyJson } from "./format.ts";

  let {
    label,
    value,
    tone = "default",
  }: { label: string; value: unknown; tone?: "default" | "bad" } = $props();

  const text = $derived(prettyJson(value));
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {
      // Clipboard can be blocked outside a secure context; nothing to do.
    }
  }
</script>

{#if text}
  <div class="min-w-0">
    <div class="mb-1 flex items-center justify-between">
      <span class="text-[12.5px] font-medium text-pencil">{label}</span>
      <button type="button" class="text-[12px] text-faint transition-colors hover:text-ink" onclick={copy}
        >{copied ? "Copied" : "Copy"}</button
      >
    </div>
    <pre
      class="max-h-72 overflow-auto rounded-lg bg-well px-3 py-2.5 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap {tone ===
      'bad'
        ? 'text-brick'
        : 'text-ink/90'}">{text}</pre>
  </div>
{/if}
