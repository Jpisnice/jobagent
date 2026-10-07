import type { ClientSessionState, MessageStreamEvent } from "eve/client";

const KEY = "jobagent:chat";

export interface SavedChat {
  readonly session?: ClientSessionState;
  readonly events?: readonly MessageStreamEvent[];
}

/** Storage can be missing or throw (private windows, blocked site data); the chat then starts fresh. */
export function loadChat(): SavedChat {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedChat) : {};
  } catch {
    return {};
  }
}

export function saveChat(chat: SavedChat): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(chat));
  } catch {
    // Over quota: keep the cursor so a reload can still resume from the server.
    try {
      localStorage.setItem(KEY, JSON.stringify({ session: chat.session }));
    } catch {
      // Nothing else to do.
    }
  }
}

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

export function clearChat(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
