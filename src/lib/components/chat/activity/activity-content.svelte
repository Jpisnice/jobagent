<script lang="ts">
  import * as Collapsible from "#lib/components/ui/collapsible/index.js";
  import { cn } from "#lib/utils.ts";
  import type { Snippet } from "svelte";

  let { class: className, children }: { class?: string; children: Snippet } = $props();
</script>

<Collapsible.Content>
  <!-- The rail joins the steps in the order they ran. -->
  <ol class={cn("mt-2 ml-[6.5px] flex flex-col gap-1 border-l py-1 pl-5", className)}>
    {@render children()}
  </ol>
</Collapsible.Content>
