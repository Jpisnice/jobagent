import type { ClientSessionState, MessageStreamEvent } from "eve/client";

/** What a chat needs to come back after a reload: the server cursor and the events so far. */
export interface SavedChat {
  readonly session?: ClientSessionState;
  readonly events?: readonly MessageStreamEvent[];
}

export interface ChatSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
}

const INDEX_KEY = "jobagent:chats";
/** Where the single-chat UI kept its one conversation; moved into the list once. */
const LEGACY_KEY = "jobagent:chat";
const chatKey = (id: string) => `jobagent:chat:${id}`;

// Storage can be missing or throw (private windows, blocked site data); chats then live only
// for this page.
function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function drop(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to remove.
  }
}

export function newChatId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

class ChatStore {
  /** Saved chats, most recently active first. */
  list = $state<ChatSummary[]>([]);
  /** What the open chat is doing right now, for its row in the sidebar. */
  live = $state<{ readonly id: string; readonly tone: "working" | "attention" } | undefined>();
  /** A message for the next new chat to send as it opens, e.g. one that hit a lost session. */
  pendingMessage: string | undefined;

  #ready = false;

  init(): void {
    if (this.#ready) return;
    this.#ready = true;
    this.list = (read<ChatSummary[]>(INDEX_KEY) ?? []).toSorted((a, b) => b.updatedAt - a.updatedAt);

    const legacy = read<SavedChat>(LEGACY_KEY);
    if (legacy?.session) {
      const id = newChatId();
      this.save(id, legacy, "Earlier chat");
    }
    drop(LEGACY_KEY);
  }

  get(id: string): ChatSummary | undefined {
    return this.list.find((chat) => chat.id === id);
  }

  load(id: string): SavedChat {
    return read<SavedChat>(chatKey(id)) ?? {};
  }

  save(id: string, chat: SavedChat, title: string): void {
    // Over quota: keep the cursor so a reload can still resume from the server.
    if (!write(chatKey(id), chat)) write(chatKey(id), { session: chat.session });
    const summary: ChatSummary = { id, title, updatedAt: Date.now() };
    this.list = [summary, ...this.list.filter((existing) => existing.id !== id)];
    write(INDEX_KEY, this.list);
  }

  rename(id: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    this.list = this.list.map((chat) => (chat.id === id ? { ...chat, title: trimmed } : chat));
    write(INDEX_KEY, this.list);
  }

  /** Deletes a chat from this device and returns a function that puts it back. */
  remove(id: string): () => void {
    const summary = this.get(id);
    const data = read<SavedChat>(chatKey(id));
    drop(chatKey(id));
    this.list = this.list.filter((chat) => chat.id !== id);
    write(INDEX_KEY, this.list);
    return () => {
      if (!summary) return;
      if (data) write(chatKey(id), data);
      this.list = [...this.list, summary].toSorted((a, b) => b.updatedAt - a.updatedAt);
      write(INDEX_KEY, this.list);
    };
  }
}

export const chats = new ChatStore();

/**
 * Whether the server still has this session. A live session's stream replays `session.started`
 * from index 0 at once; one the server forgot (eve dev restarted) answers 200 and stays silent,
 * which would leave a resume stuck forever.
 */
export async function sessionIsLive(sessionId: string, timeoutMs = 4000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=0`, {
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return false;
    // Skip keep-alive newlines; the first real NDJSON event proves the session exists.
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return false;
      buffered += value;
      if (buffered.trim().length > 0 && buffered.includes('"type"')) return true;
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
