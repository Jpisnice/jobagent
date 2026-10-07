<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Tooltip from "#lib/components/ui/tooltip/index.js";
  import { Kbd } from "#lib/components/ui/kbd/index.js";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";

  let { stopping = false, onclick }: { stopping?: boolean; onclick: () => void } = $props();
</script>

<!-- Takes the send button's place while something runs. -->
<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        type="button"
        size="icon"
        class="rounded-full"
        disabled={stopping}
        aria-label={stopping ? "Stopping" : "Stop"}
        {onclick}
      >
        {#if stopping}
          <LoaderIcon class="size-4 animate-spin" />
        {:else}
          <span class="size-3 rounded-[3px] bg-current" aria-hidden="true"></span>
        {/if}
      </Button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content>Stop <Kbd>Esc</Kbd></Tooltip.Content>
</Tooltip.Root>
