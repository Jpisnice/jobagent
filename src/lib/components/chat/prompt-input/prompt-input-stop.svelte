<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";

  let { stopping = false, onclick }: { stopping?: boolean; onclick: () => void } = $props();
</script>

<Button type="button" variant="ghost" size="sm" disabled={stopping} {onclick} class="text-muted-foreground">
  <span class="size-2.5 rounded-[2px] bg-current" aria-hidden="true"></span>
  {stopping ? "Stopping…" : "Stop"}
</Button>
