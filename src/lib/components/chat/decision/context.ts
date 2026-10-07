import { createContext } from "svelte";

export const [getDecisionOpen, setDecisionOpen] = createContext<() => boolean>();
export const [getOptionsLayout, setOptionsLayout] = createContext<() => "row" | "list">();
