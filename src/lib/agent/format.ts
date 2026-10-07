import type { MessageStreamEvent } from "eve/client";
import type {
  ConversationInput,
  ConversationState,
  EveDynamicToolPart,
  EveMessage,
  EveMessagePart,
} from "eve/svelte";

export type ToolState = EveDynamicToolPart["state"];

export interface TokenTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd?: number;
}

export interface CallTiming {
  readonly startedAt: number;
  readonly endedAt?: number;
}

/** What the raw event stream says beyond the projected conversation. */
export interface StreamInsights {
  readonly agentName?: string;
  readonly eveVersion?: string;
  readonly modelId?: string;
  readonly steps: number;
  /** Session-wide usage as of the latest event that reported it, including subagents. */
  readonly sessionUsage?: TokenTotals;
  /** Sum of every completed model call this stream saw; fills in before the session reports. */
  readonly stepUsage: TokenTotals;
  readonly lastStepUsage?: TokenTotals;
  readonly calls: ReadonlyMap<string, CallTiming>;
  /** Human labels tools give their calls, e.g. "Approve application: Acme – Engineer". */
  readonly labels: ReadonlyMap<string, string>;
  readonly startedAt?: number;
  readonly lastEventAt?: number;
}

const EMPTY_TOTALS: TokenTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function toTotals(usage: Partial<TokenTotals> | undefined): TokenTotals | undefined {
  if (usage === undefined) return undefined;
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    costUsd: usage.costUsd,
  };
}

function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  const cost =
    a.costUsd === undefined && b.costUsd === undefined
      ? undefined
      : (a.costUsd ?? 0) + (b.costUsd ?? 0);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: cost,
  };
}

function timeOf(event: MessageStreamEvent): number | undefined {
  const at = Date.parse(event.meta?.at ?? "");
  return Number.isNaN(at) ? undefined : at;
}

/**
 * Builds {@link StreamInsights} as events arrive, reading each event once. The stream only ever
 * grows, so each update starts where the last one stopped; a shorter or different stream (a reset
 * chat) starts over.
 */
export class InsightsTracker {
  #seen = 0;
  #first: MessageStreamEvent | undefined;
  #agentName: string | undefined;
  #eveVersion: string | undefined;
  #modelId: string | undefined;
  #steps = 0;
  #sessionUsage: TokenTotals | undefined;
  #stepUsage = EMPTY_TOTALS;
  #lastStepUsage: TokenTotals | undefined;
  #startedAt: number | undefined;
  #lastEventAt: number | undefined;
  #calls = new Map<string, CallTiming>();
  #labels = new Map<string, string>();

  update(events: readonly MessageStreamEvent[]): StreamInsights {
    if (events.length < this.#seen || (events.length > 0 && events[0] !== this.#first)) this.#restart();
    this.#first = events[0];
    for (let index = this.#seen; index < events.length; index += 1) this.#read(events[index]);
    this.#seen = events.length;
    return {
      agentName: this.#agentName,
      eveVersion: this.#eveVersion,
      modelId: this.#modelId,
      steps: this.#steps,
      sessionUsage: this.#sessionUsage,
      stepUsage: this.#stepUsage,
      lastStepUsage: this.#lastStepUsage,
      // Fresh copies, so anything derived from them sees a change.
      calls: new Map(this.#calls),
      labels: new Map(this.#labels),
      startedAt: this.#startedAt,
      lastEventAt: this.#lastEventAt,
    };
  }

  #restart() {
    this.#seen = 0;
    this.#agentName = this.#eveVersion = this.#modelId = undefined;
    this.#steps = 0;
    this.#sessionUsage = this.#lastStepUsage = undefined;
    this.#stepUsage = EMPTY_TOTALS;
    this.#startedAt = this.#lastEventAt = undefined;
    this.#calls.clear();
    this.#labels.clear();
  }

  #read(event: MessageStreamEvent) {
    if (
      (event.type === "actions.requested" || event.type === "action.result" || event.type === "action.partial") &&
      event.data.presentation
    ) {
      for (const [callId, presentation] of Object.entries(event.data.presentation)) {
        if (presentation.label) this.#labels.set(callId, presentation.label);
      }
    }
    const at = timeOf(event);
    if (at !== undefined) {
      this.#startedAt ??= at;
      this.#lastEventAt = at;
    }
    switch (event.type) {
      case "session.started":
        this.#agentName = event.data.runtime?.agentName ?? event.data.runtime?.agentId;
        this.#eveVersion = event.data.runtime?.eveVersion;
        break;
      case "step.started":
        this.#modelId = event.data.modelId;
        break;
      case "step.completed": {
        this.#steps += 1;
        const usage = toTotals(event.data.usage);
        if (usage !== undefined) {
          this.#lastStepUsage = usage;
          this.#stepUsage = addTotals(this.#stepUsage, usage);
        }
        break;
      }
      case "turn.waiting":
      case "session.waiting":
      case "session.failed":
        this.#sessionUsage = toTotals(event.data.usage) ?? this.#sessionUsage;
        break;
      case "session.completed":
        this.#sessionUsage = toTotals(event.data?.usage) ?? this.#sessionUsage;
        break;
      case "actions.requested":
        if (at !== undefined) {
          for (const action of event.data.actions) {
            if (!this.#calls.has(action.callId)) this.#calls.set(action.callId, { startedAt: at });
          }
        }
        break;
      case "action.result": {
        const timing = this.#calls.get(event.data.result.callId);
        if (timing !== undefined && at !== undefined) {
          this.#calls.set(event.data.result.callId, { ...timing, endedAt: at });
        }
        break;
      }
    }
  }
}

export function streamInsights(events: readonly MessageStreamEvent[]): StreamInsights {
  return new InsightsTracker().update(events);
}

/** A part that belongs in a work log: reasoning or a tool call that needs nothing from you. */
export type WorkPart = Extract<EveMessagePart, { type: "reasoning" }> | EveDynamicToolPart;

/** How an assistant message reads: prose, grouped background work, and decisions for you. */
export type Segment =
  | { readonly kind: "text"; readonly key: string; readonly part: Extract<EveMessagePart, { type: "text" }> }
  | { readonly kind: "work"; readonly key: string; readonly parts: readonly WorkPart[] }
  | { readonly kind: "decision"; readonly key: string; readonly part: EveDynamicToolPart }
  | { readonly kind: "other"; readonly key: string; readonly part: EveMessagePart };

/** Questions and approval-gated calls are decisions; they get their own slip in the thread. */
export function isDecisionPart(part: EveDynamicToolPart): boolean {
  return (
    part.toolName === "ask_question" ||
    part.state === "approval-requested" ||
    part.state === "approval-responded" ||
    part.state === "output-denied" ||
    part.approval !== undefined ||
    part.toolMetadata?.eve?.inputRequest !== undefined
  );
}

/** Groups a message's parts so consecutive background work reads as one log. */
export function segmentParts(parts: readonly EveMessagePart[]): Segment[] {
  const segments: Segment[] = [];
  let work: WorkPart[] = [];
  const flush = () => {
    if (work.length === 0) return;
    const first = work[0];
    segments.push({
      kind: "work",
      key: `work-${first.type === "dynamic-tool" ? first.toolCallId : (first.id ?? segments.length)}`,
      parts: work,
    });
    work = [];
  };

  parts.forEach((part, index) => {
    if (part.type === "step-start") return;
    if (part.type === "reasoning") {
      if (part.text.trim().length > 0 || part.state === "streaming") work.push(part);
      return;
    }
    if (part.type === "dynamic-tool") {
      if (isDecisionPart(part)) {
        flush();
        segments.push({ kind: "decision", key: `decision-${part.toolCallId}`, part });
      } else {
        work.push(part);
      }
      return;
    }
    flush();
    if (part.type === "text") {
      if (part.text.trim().length > 0 || part.state === "streaming") {
        segments.push({ kind: "text", key: `text-${part.id ?? index}`, part });
      }
      return;
    }
    segments.push({ kind: "other", key: `${part.type}-${index}`, part });
  });
  flush();
  return segments;
}

/** The input request a tool call raised, open or settled. */
export function inputForCall(state: ConversationState, callId: string): ConversationInput | undefined {
  let found: ConversationInput | undefined;
  for (const input of Object.values(state.inputs)) {
    if (input.request.action.callId === callId) found = input;
  }
  return found;
}

/** Every tool part across the conversation, oldest first. */
export function allToolParts(messages: readonly EveMessage[]): EveDynamicToolPart[] {
  const parts: EveDynamicToolPart[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "dynamic-tool") parts.push(part);
    }
  }
  return parts;
}

export function isToolRunning(state: ToolState): boolean {
  return state === "input-streaming" || state === "input-available";
}

export const TOOL_STATE_LABEL: Record<ToolState, string> = {
  "input-streaming": "Preparing",
  "input-available": "Running",
  "approval-requested": "Needs approval",
  "approval-responded": "Approval sent",
  "output-available": "Done",
  "output-error": "Error",
  "output-denied": "Denied",
};

export type Tone = "accent" | "ok" | "warn" | "bad" | "muted";

export const TOOL_STATE_TONE: Record<ToolState, Tone> = {
  "input-streaming": "accent",
  "input-available": "accent",
  "approval-requested": "warn",
  "approval-responded": "muted",
  "output-available": "ok",
  "output-error": "bad",
  "output-denied": "bad",
};

/** Badge colors per tone. Only `warn` (waiting on you) uses the attention color. */
export const TONE_CLASS: Record<Tone, string> = {
  accent: "border-transparent bg-primary text-primary-foreground",
  ok: "border-success/30 bg-success/10 text-success",
  warn: "border-attention/40 bg-attention-soft text-attention-foreground",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

/** Dot colors per tone, for timelines. */
export const TONE_DOT: Record<Tone, string> = {
  accent: "animate-pulse bg-foreground",
  ok: "bg-success",
  warn: "bg-attention",
  bad: "bg-destructive",
  muted: "bg-muted-foreground/50",
};

/** What each of this agent's tools is doing, in words: [while running, once done]. */
const TOOL_PHRASES: Record<string, readonly [string, string]> = {
  profile_status: ["Checking your profile", "Checked your profile"],
  get_profile: ["Loading your profile", "Loaded your profile"],
  save_profile: ["Saving your profile", "Saved your profile"],
  read_resume: ["Reading your resume", "Read your resume"],
  fetch_jobs: ["Fetching job postings", "Fetched job postings"],
  list_jobs: ["Looking up tracked jobs", "Looked up tracked jobs"],
  screen_jobs: ["Screening postings against your profile", "Screened postings"],
  record_job: ["Updating the job tracker", "Updated the job tracker"],
  draft_application: ["Drafting the application", "Drafted the application"],
  browser_task: ["Working in Chrome", "Worked in Chrome"],
  web_search: ["Searching the web", "Searched the web"],
  web_fetch: ["Reading a page", "Read a page"],
  send_alert: ["Sending the email digest", "Sent the email digest"],
  load_skill: ["Loading instructions", "Loaded instructions"],
};

/** A readable line for a tool call: a phrase for its state, else the label the stream gave it. */
export function toolPhrase(part: EveDynamicToolPart, labels?: ReadonlyMap<string, string>): string {
  const name = part.toolMetadata?.eve?.name ?? part.toolName;
  const phrases = TOOL_PHRASES[name];
  if (phrases) return isToolRunning(part.state) ? phrases[0] : phrases[1];
  const label = labels?.get(part.toolCallId);
  if (label) return label;
  if (part.toolMetadata?.eve?.kind === "load-skill") {
    const skill = (part.input as { name?: unknown } | undefined)?.name;
    return typeof skill === "string" ? `Loading the ${humanizeName(skill).toLowerCase()} guide` : "Loading instructions";
  }
  if (part.toolMetadata?.eve?.kind === "subagent-call") {
    return `${isToolRunning(part.state) ? "Asking" : "Asked"} the ${humanizeName(name).toLowerCase()}`;
  }
  return humanizeName(name);
}

/** Turns snake_case and camelCase tool names into readable labels. */
export function humanizeName(name: string): string {
  const spaced = name.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function prettyJson(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** A one-line preview of a tool's input, e.g. `query: "react", limit: 10`. */
export function inputPreview(input: unknown, max = 80): string {
  if (input === undefined || input === null) return "";
  let text: string;
  if (typeof input === "object" && !Array.isArray(input)) {
    text = Object.entries(input as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value) ?? ""}`)
      .join(", ");
  } else {
    text = JSON.stringify(input) ?? "";
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return "—";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function formatTime(at: string | undefined): string {
  if (!at) return "";
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Why the latest turn failed, if it did, in the words of the innermost error. eve's turn state
 * only says "failed"; the reason travels on the `step.failed` and `turn.failed` events.
 */
export function lastTurnFailure(
  state: ConversationState,
  events: readonly MessageStreamEvent[],
): { readonly turnId: string; readonly message: string } | undefined {
  const turn = Object.values(state.turns).at(-1);
  if (turn?.status !== "failed") return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "step.failed" && event.type !== "turn.failed") continue;
    const data = ("data" in event ? event.data : undefined) as
      | { turnId?: string; message?: string; details?: { message?: string } }
      | undefined;
    if (data?.turnId !== undefined && data.turnId !== turn.turnId) continue;
    const raw = data?.details?.message ?? data?.message;
    if (!raw) continue;
    // "AI_RetryError: Failed after 3 attempts. Last error: AI_APICallError: <the reason>"
    const message = raw.split(/\b\w*Error: /).at(-1)?.trim() || raw;
    return { turnId: turn.turnId, message };
  }
  return { turnId: turn.turnId, message: "The agent stopped before it could reply." };
}

/** The first thing you said in a chat, trimmed to fit a sidebar row. */
export function chatTitle(messages: readonly EveMessage[], max = 48): string | undefined {
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.parts) {
      if (part.type !== "text") continue;
      const text = part.text.replace(/\s+/g, " ").trim();
      if (text) return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
    }
  }
  return undefined;
}
