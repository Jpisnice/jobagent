import { createContext } from "svelte";

export type MessageFrom = "user" | "assistant";

export const [getMessageFrom, setMessageFrom] = createContext<() => MessageFrom>();
