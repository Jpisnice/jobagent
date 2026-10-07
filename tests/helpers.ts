import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const textResponse = (body: string, status = 200) => new Response(body, { status });

type Route = unknown | ((url: string, init?: RequestInit) => Response | Promise<Response>);

// Replaces global fetch. A route key matches when the requested URL contains it; the first match wins.
// Plain values become JSON 200 responses; Response objects and functions are used as-is.
export function stubFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    for (const [key, value] of Object.entries(routes)) {
      if (!url.includes(key)) continue;
      if (typeof value === "function") return (value as (u: string, i?: RequestInit) => Response)(url, init);
      if (value instanceof Response) return value.clone();
      return jsonResponse(value);
    }
    return jsonResponse({ error: "no route" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

// Gives each test its own empty job store file, then loads a fresh copy of the store module.
export async function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "jobagent-store-"));
  const file = join(dir, "nested", "jobs.json");
  vi.stubEnv("JOB_STORE_PATH", file);
  vi.resetModules();
  const store = await import("../agent/lib/store");
  return { store, file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// A stand-in for the context eve passes to tools.
export const toolCtx = (callId = "call-1") => ({
  callId,
  abortSignal: new AbortController().signal,
}) as never;

// Tools declare their input with zod; parse like the runtime does so defaults are applied.
export const parseInput = (tool: { inputSchema: { parse(x: unknown): unknown } }, input: unknown) =>
  tool.inputSchema.parse(input) as never;
