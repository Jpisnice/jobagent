import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { health, runTask } from "../agent/lib/browser";
import { jsonResponse, stubFetch, textResponse } from "./helpers";

const job = (status: string, extra = {}) => ({ status, steps: 3, result: null, reason: null, seconds: 5, ...extra });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("BROWSER_SERVICE_URL", "http://svc.test:8765/");
  vi.stubEnv("BROWSER_SERVICE_TOKEN", "secret-token");
});
afterEach(() => vi.useRealTimers());

// Starts runTask and lets fake time pass so polling can proceed.
async function settle<T>(p: Promise<T>, ms = 0): Promise<T> {
  p.catch(() => undefined);
  await vi.advanceTimersByTimeAsync(ms);
  return p;
}

describe("runTask", () => {
  it("starts the task with snake_case fields, the token and the configured url", async () => {
    const { calls } = stubFetch({ "/run": { jobId: "j1" }, "/jobs/j1": job("done", { result: "ok" }) });
    await settle(runTask({ task: "fill it", files: ["resume.pdf"], maxSteps: 40, key: "k1", allowSubmit: true }));
    const start = calls[0]!;
    expect(start.url).toBe("http://svc.test:8765/run");
    expect((start.init!.headers as Record<string, string>)["x-token"]).toBe("secret-token");
    expect(JSON.parse(start.init!.body as string)).toEqual({
      task: "fill it", files: ["resume.pdf"], max_steps: 40, key: "k1", allow_submit: true,
    });
  });

  it("defaults to no files, 60 steps and no submitting", async () => {
    const { calls } = stubFetch({ "/run": { jobId: "j1" }, "/jobs/j1": job("done") });
    await settle(runTask({ task: "t", key: "k" }));
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({ files: [], max_steps: 60, allow_submit: false });
  });

  it("polls every few seconds until the job leaves the running state", async () => {
    let polls = 0;
    const { calls } = stubFetch({
      "/run": { jobId: "j1" },
      "/jobs/j1": () => jsonResponse(++polls < 3 ? job("running") : job("done", { result: "finished" })),
    });
    const p = runTask({ task: "t", key: "k" });
    const result = await settle(p, 7_000);
    expect(result).toMatchObject({ status: "done", result: "finished" });
    expect(calls.filter((c) => c.url.includes("/jobs/j1"))).toHaveLength(3);
  });

  it.each(["failed", "needs_human", "needs_submit_approval"])("returns when the job ends as %s", async (status) => {
    stubFetch({ "/run": { jobId: "j1" }, "/jobs/j1": job(status, { reason: "why" }) });
    expect(await settle(runTask({ task: "t", key: "k" }))).toMatchObject({ status, reason: "why" });
  });

  it("tells the user to start the service when it is not running", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(settle(runTask({ task: "t", key: "k" }))).rejects.toThrow(/npm run browser/);
  });

  it("explains a rejected token", async () => {
    stubFetch({ "/run": textResponse("bad token", 401) });
    await expect(settle(runTask({ task: "t", key: "k" }))).rejects.toThrow(/BROWSER_SERVICE_TOKEN/);
  });

  it("surfaces a service error with its status", async () => {
    stubFetch({ "/run": textResponse("another browser task is still running", 409) });
    await expect(settle(runTask({ task: "t", key: "k" }))).rejects.toThrow(/409.*still running/);
  });

  it("cancels the job and throws when the turn is aborted", async () => {
    const { calls } = stubFetch({ "/run": { jobId: "j1" }, "/jobs/j1": job("running"), "/cancel": { ok: true } });
    const ac = new AbortController();
    const p = runTask({ task: "t", key: "k" }, ac.signal);
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(3_100);
    ac.abort();
    await vi.advanceTimersByTimeAsync(3_100);
    await expect(p).rejects.toThrow(/cancelled/);
    expect(calls.some((c) => c.url.endsWith("/jobs/j1/cancel") && c.init?.method === "POST")).toBe(true);
  });

  it("cancels the job and throws when it takes too long", async () => {
    const { calls } = stubFetch({ "/run": { jobId: "j1" }, "/jobs/j1": job("running"), "/cancel": { ok: true } });
    const p = runTask({ task: "t", key: "k" }, undefined, 10_000);
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(p).rejects.toThrow(/timed out/);
    expect(calls.some((c) => c.url.endsWith("/cancel"))).toBe(true);
  });

  it("uses the default local url when none is configured", async () => {
    vi.stubEnv("BROWSER_SERVICE_URL", "");
    vi.unstubAllEnvs();
    vi.stubEnv("BROWSER_SERVICE_TOKEN", "t");
    const { calls } = stubFetch({ "/run": { jobId: "j1" }, "/jobs/j1": job("done") });
    delete process.env.BROWSER_SERVICE_URL;
    await settle(runTask({ task: "t", key: "k" }));
    expect(calls[0]!.url).toBe("http://127.0.0.1:8765/run");
  });
});

describe("health", () => {
  it("is true when the service answers", async () => {
    stubFetch({ "/health": { ok: true } });
    expect(await health()).toBe(true);
  });

  it("is false when the service is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await health()).toBe(false);
  });
});
