import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { InsightsTracker, streamInsights } from "../src/lib/agent/format";
import { splitBlocks } from "../src/lib/components/chat/markdown";

describe("splitBlocks", () => {
  it("splits paragraphs at blank lines", () => {
    expect(splitBlocks("One.\n\nTwo.\n\nThree")).toEqual(["One.", "Two.", "Three"]);
  });

  it("keeps a code fence with blank lines inside it as one block", () => {
    const fence = "```ts\nconst a = 1;\n\nconst b = 2;\n```";
    expect(splitBlocks(`Intro\n\n${fence}\n\nAfter`)).toEqual(["Intro", fence, "After"]);
  });

  it("keeps an unclosed fence open, as it is while streaming", () => {
    expect(splitBlocks("Intro\n\n```\ncode\n\nmore")).toEqual(["Intro", "```\ncode\n\nmore"]);
  });

  it("returns the text as one block when there is no blank line", () => {
    expect(splitBlocks("Writing a sentence")).toEqual(["Writing a sentence"]);
    expect(splitBlocks("")).toEqual([""]);
  });

  it("only ever grows the last block as text streams in", () => {
    const full = "First paragraph.\n\nSecond paragraph is longer.\n\n- a\n- b";
    let previous: string[] = [];
    for (let end = 1; end <= full.length; end += 1) {
      const blocks = splitBlocks(full.slice(0, end));
      // Every block before the last stays exactly as it was.
      expect(blocks.slice(0, previous.length - 1)).toEqual(previous.slice(0, -1));
      previous = blocks;
    }
  });
});

const at = (second: number) => ({ at: new Date(Date.UTC(2026, 9, 7, 12, 0, second)).toISOString() });
const EVENTS = [
  { type: "session.started", data: { runtime: { agentName: "jobagent", eveVersion: "0.72.1" } }, meta: at(0) },
  { type: "step.started", data: { modelId: "google/gemini" }, meta: at(1) },
  {
    type: "actions.requested",
    data: { actions: [{ callId: "c1" }], presentation: { c1: { label: "Checking profile" } } },
    meta: at(2),
  },
  { type: "action.result", data: { result: { callId: "c1" } }, meta: at(4) },
  { type: "step.completed", data: { usage: { inputTokens: 100, outputTokens: 20 } }, meta: at(5) },
] as unknown as MessageStreamEvent[];

describe("InsightsTracker", () => {
  it("matches a full read when fed one event at a time", () => {
    const tracker = new InsightsTracker();
    const growing: MessageStreamEvent[] = [];
    let last;
    for (const event of EVENTS) {
      growing.push(event);
      last = tracker.update(growing);
    }
    expect(last).toEqual(streamInsights(EVENTS));
    expect(last?.calls.get("c1")).toEqual({ startedAt: Date.parse(at(2).at), endedAt: Date.parse(at(4).at) });
    expect(last?.labels.get("c1")).toBe("Checking profile");
    expect(last?.steps).toBe(1);
  });

  it("starts over when the stream is replaced", () => {
    const tracker = new InsightsTracker();
    tracker.update(EVENTS);
    expect(tracker.update(EVENTS.slice(0, 2)).steps).toBe(0);
    expect(tracker.update([]).agentName).toBeUndefined();
  });
});
