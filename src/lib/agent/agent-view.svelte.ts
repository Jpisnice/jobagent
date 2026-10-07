import type { ClientSessionState, MessageStreamEvent } from "eve/client";
import type { ConversationState, UseEveAgentReturn } from "eve/svelte";
import { untrack } from "svelte";
import { InsightsTracker, type StreamInsights } from "./format.ts";

type Agent = UseEveAgentReturn<ConversationState>;

/**
 * The agent as the UI reads it. eve publishes on every stream event, and a reply arrives as
 * hundreds of small deltas; reading the agent directly re-runs every derived value per delta.
 * This view copies its state at most once per animation frame, so a burst of deltas costs one
 * update. Status changes still land at once, so buttons never lag behind the stream.
 *
 * Construct it during component initialisation: it owns an effect.
 */
export class AgentView implements Agent {
  data = $state.raw<ConversationState>() as ConversationState;
  conversation = $state.raw<ConversationState>() as ConversationState;
  events = $state.raw<readonly MessageStreamEvent[]>([]);
  status = $state<Agent["status"]>("ready");
  error = $state.raw<Agent["error"]>();
  session = $state.raw<ClientSessionState | undefined>();
  /** Stream stats, kept up to date incrementally instead of re-reading every event. */
  insights = $state.raw<StreamInsights>() as StreamInsights;

  readonly send: Agent["send"];
  readonly respond: Agent["respond"];
  readonly cancel: Agent["cancel"];
  readonly reset: Agent["reset"];
  readonly resume: Agent["resume"];
  readonly prewarm: Agent["prewarm"];

  #agent: Agent;
  #tracker = new InsightsTracker();
  #frame: number | undefined;

  constructor(agent: Agent) {
    this.#agent = agent;
    this.send = agent.send;
    this.respond = agent.respond;
    this.cancel = agent.cancel;
    this.reset = agent.reset;
    this.resume = agent.resume;
    this.prewarm = agent.prewarm;
    this.#flush();

    $effect(() => {
      // Subscribe to everything the view mirrors.
      void agent.data;
      void agent.conversation;
      void agent.events.length;
      void agent.session;
      void agent.error;
      const status = agent.status;
      if (status !== untrack(() => this.status)) {
        this.#flush();
      } else if (this.#frame === undefined) {
        this.#frame = requestAnimationFrame(() => this.#flush());
      }
    });
    $effect(() => () => {
      if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    });
  }

  #flush() {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    const agent = this.#agent;
    this.data = agent.data;
    this.conversation = agent.conversation;
    this.status = agent.status;
    this.error = agent.error;
    this.session = agent.session;
    // eve appends to one array in place; a copy is what tells readers it grew.
    this.events = agent.events.slice();
    this.insights = this.#tracker.update(agent.events);
  }
}
