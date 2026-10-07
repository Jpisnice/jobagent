<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { type ChatSummary, chats } from "#lib/agent/chats.svelte.ts";
  import StatusDot from "#lib/components/chat/status-dot.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Dialog from "#lib/components/ui/dialog/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import * as Sidebar from "#lib/components/ui/sidebar/index.js";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import MonitorIcon from "@lucide/svelte/icons/monitor";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import SquarePenIcon from "@lucide/svelte/icons/square-pen";
  import SunIcon from "@lucide/svelte/icons/sun";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { setMode, userPrefersMode } from "mode-watcher";
  import { toast } from "svelte-sonner";

  const sidebar = Sidebar.useSidebar();
  const activeId = $derived(page.params.id);

  // Recent chats first, grouped the way you'd remember them.
  const groups = $derived.by(() => {
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const day = 24 * 60 * 60 * 1000;
    const buckets: { label: string; chats: ChatSummary[] }[] = [
      { label: "Today", chats: [] },
      { label: "Yesterday", chats: [] },
      { label: "Previous 7 days", chats: [] },
      { label: "Older", chats: [] },
    ];
    for (const chat of chats.list) {
      const bucket =
        chat.updatedAt >= startOfToday
          ? 0
          : chat.updatedAt >= startOfToday - day
            ? 1
            : chat.updatedAt >= startOfToday - 7 * day
              ? 2
              : 3;
      buckets[bucket].chats.push(chat);
    }
    return buckets.filter((bucket) => bucket.chats.length > 0);
  });

  function closeOnMobile() {
    if (sidebar.isMobile) sidebar.setOpenMobile(false);
  }

  function newChat() {
    closeOnMobile();
    void goto("/");
  }

  let renaming = $state<ChatSummary | undefined>();
  let renameValue = $state("");

  function startRename(chat: ChatSummary) {
    renaming = chat;
    renameValue = chat.title;
  }

  function saveRename(event: SubmitEvent) {
    event.preventDefault();
    if (renaming) chats.rename(renaming.id, renameValue);
    renaming = undefined;
  }

  function remove(chat: ChatSummary) {
    const restore = chats.remove(chat.id);
    if (chat.id === activeId) void goto("/");
    toast("Chat deleted", { action: { label: "Undo", onClick: restore } });
  }

  const THEMES = [
    { value: "light", label: "Light", icon: SunIcon },
    { value: "dark", label: "Dark", icon: MoonIcon },
    { value: "system", label: "System", icon: MonitorIcon },
  ] as const;
  const currentTheme = $derived(THEMES.find((theme) => theme.value === userPrefersMode.current) ?? THEMES[2]);
</script>

<Sidebar.Root>
  <Sidebar.Header>
    <div class="flex items-center justify-between gap-2 px-2 pt-1">
      <a href="/" class="flex items-center gap-2 rounded-md text-sm font-semibold" onclick={closeOnMobile}>
        <svg class="size-6" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" class="fill-primary" />
          <path d="M10 10h12M10 15h12M10 20h7" class="stroke-primary-foreground" stroke-width="2.4" stroke-linecap="round" />
          <circle cx="22" cy="21.5" r="3" class="fill-attention" />
        </svg>
        Job Agent
      </a>
    </div>
    <Sidebar.Menu class="mt-2">
      <Sidebar.MenuItem>
        <Sidebar.MenuButton onclick={newChat}>
          <SquarePenIcon />
          <span>New chat</span>
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>

  <Sidebar.Content>
    {#if groups.length === 0}
      <p class="px-4 py-2 text-[13px] text-muted-foreground">Your chats are saved here, on this device.</p>
    {/if}
    {#each groups as group (group.label)}
      <Sidebar.Group>
        <Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
        <Sidebar.Menu>
          {#each group.chats as chat (chat.id)}
            {@const live = chats.live?.id === chat.id ? chats.live.tone : undefined}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton isActive={chat.id === activeId}>
                {#snippet child({ props })}
                  <a href="/{chat.id}" {...props} onclick={closeOnMobile}>
                    <span>{chat.title}</span>
                  </a>
                {/snippet}
              </Sidebar.MenuButton>
              {#if live}
                <!-- Sits where the menu button reveals on hover, so the two don't overlap. -->
                <span
                  class="pointer-events-none absolute top-3 right-2.5 group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0"
                  title={live === "attention" ? "Waiting for you" : "Working"}
                >
                  <StatusDot tone={live} />
                </span>
              {/if}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <Sidebar.MenuAction showOnHover {...props} aria-label="Options for {chat.title}">
                      <EllipsisIcon />
                    </Sidebar.MenuAction>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content side="right" align="start" class="w-40">
                  <DropdownMenu.Item onSelect={() => startRename(chat)}>
                    <PencilIcon />Rename
                  </DropdownMenu.Item>
                  <DropdownMenu.Item variant="destructive" onSelect={() => remove(chat)}>
                    <Trash2Icon />Delete
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.Group>
    {/each}
  </Sidebar.Content>

  <Sidebar.Footer>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Sidebar.MenuButton {...props}>
                <currentTheme.icon />
                <span>Theme: {currentTheme.label}</span>
              </Sidebar.MenuButton>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content side="top" align="start" class="w-(--bits-dropdown-menu-anchor-width)">
            <DropdownMenu.RadioGroup value={currentTheme.value} onValueChange={(value) => setMode(value as "light" | "dark" | "system")}>
              {#each THEMES as theme (theme.value)}
                <DropdownMenu.RadioItem value={theme.value}>{theme.label}</DropdownMenu.RadioItem>
              {/each}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>
  <Sidebar.Rail />
</Sidebar.Root>

<Dialog.Root open={renaming !== undefined} onOpenChange={(open) => !open && (renaming = undefined)}>
  <Dialog.Content class="sm:max-w-sm">
    <form class="flex flex-col gap-4" onsubmit={saveRename}>
      <Dialog.Header>
        <Dialog.Title>Rename chat</Dialog.Title>
      </Dialog.Header>
      <Input bind:value={renameValue} aria-label="Chat name" maxlength={80} />
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (renaming = undefined)}>Cancel</Button>
        <Button type="submit" disabled={!renameValue.trim()}>Rename</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
