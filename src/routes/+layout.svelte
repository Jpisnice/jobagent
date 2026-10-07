<script lang="ts">
  import "../app.css";
  import { chats } from "#lib/agent/chats.svelte.ts";
  import AppSidebar from "#lib/components/app-sidebar.svelte";
  import * as Sidebar from "#lib/components/ui/sidebar/index.js";
  import { Toaster } from "#lib/components/ui/sonner/index.js";
  import { ModeWatcher } from "mode-watcher";

  let { children } = $props();

  chats.init();
</script>

<ModeWatcher defaultMode="system" />
<Toaster position="bottom-center" />

<Sidebar.Provider>
  <AppSidebar />
  <Sidebar.Inset class="h-dvh min-w-0 overflow-hidden">
    {@render children()}
  </Sidebar.Inset>
</Sidebar.Provider>
