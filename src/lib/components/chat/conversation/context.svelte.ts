import { createContext } from "svelte";

/** Scroll state shared by a conversation and its scroll-to-bottom button. */
export class ConversationScroll {
  /** Near enough to the bottom that new content should keep the view pinned there. */
  atBottom = $state(true);
  viewport: HTMLElement | undefined;

  scrollToBottom(behavior: ScrollBehavior = "smooth") {
    this.viewport?.scrollTo({ top: this.viewport.scrollHeight, behavior });
  }
}

export const [getConversation, setConversation] = createContext<ConversationScroll>();
