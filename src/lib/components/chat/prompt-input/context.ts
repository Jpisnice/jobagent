import { createContext } from "svelte";

export interface PromptInputContext {
  value: string;
  readonly disabled: boolean;
  readonly canSubmit: boolean;
  submit(): void;
}

export const [getPromptInput, setPromptInput] = createContext<PromptInputContext>();
