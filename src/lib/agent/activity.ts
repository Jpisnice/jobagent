import type { StatusTone } from "#lib/components/chat/status.ts";
import type { ConversationState, UseEveAgentReturn } from "eve/svelte";
import { openConversationInputs } from "eve/svelte";
import { isToolRunning, toolPhrase } from "./format.ts";

export interface AgentActivity {
  readonly tone: StatusTone;
  readonly label: string;
  /** A turn is running and nothing is waiting on you. */
  readonly working: boolean;
}

/** The most specific thing the agent is doing right now, in plain words. */
export function describeActivity(
  agent: Pick<UseEveAgentReturn<ConversationState>, "status" | "data">,
  labels: ReadonlyMap<string, string>,
): AgentActivity {
  const { status, data } = agent;
  if (status === "error") return { tone: "error", label: "Disconnected", working: false };
  if (status === "resuming") return { tone: "working", label: "Reconnecting", working: false };
  if (openConversationInputs(data).length > 0) return { tone: "attention", label: "Waiting for you", working: false };
  if (status === "submitted") return { tone: "working", label: "Reading your message", working: true };
  if (status === "streaming") {
    // Running work lives in the latest reply; no need to walk the whole conversation.
    const last = data.messages.at(-1);
    if (last?.role === "assistant") {
      const running = last.parts.findLast((part) => part.type === "dynamic-tool" && isToolRunning(part.state));
      if (running?.type === "dynamic-tool") return { tone: "working", label: toolPhrase(running, labels), working: true };
      const tail = last.parts.at(-1);
      if (tail?.type === "reasoning" && tail.state === "streaming") return { tone: "working", label: "Thinking", working: true };
      if (tail?.type === "text" && tail.state === "streaming") return { tone: "working", label: "Writing", working: true };
    }
    const turnId = data.activeTurnId;
    if (turnId && data.turns[turnId]?.waiting) {
      return { tone: "working", label: "Waiting on background work", working: true };
    }
    // Between steps: the model is deciding what to do next.
    return { tone: "working", label: "Thinking", working: true };
  }
  if (Object.values(data.turns).at(-1)?.status === "failed") {
    return { tone: "error", label: "Last reply failed", working: false };
  }
  return { tone: "idle", label: "Ready", working: false };
}
