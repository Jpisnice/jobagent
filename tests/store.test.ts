import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshStore } from "./helpers";

let ctx: Awaited<ReturnType<typeof freshStore>>;
beforeEach(async () => {
  ctx = await freshStore();
});
afterEach(() => ctx.cleanup());

const job = (n: number, extra = {}) => ({
  url: `https://jobs.example.com/${n}`,
  title: `Engineer ${n}`,
  company: "Acme",
  status: "seen" as const,
  ...extra,
});

describe("jobId", () => {
  it("is a stable 16 character hex id", () => {
    const id = ctx.store.jobId("https://a.com/job/1");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(ctx.store.jobId("https://a.com/job/1")).toBe(id);
  });

  it("ignores a #fragment and a trailing slash so the same posting is not stored twice", () => {
    const base = ctx.store.jobId("https://a.com/job/1");
    expect(ctx.store.jobId("https://a.com/job/1/")).toBe(base);
    expect(ctx.store.jobId("https://a.com/job/1#apply")).toBe(base);
  });

  it("gives different postings different ids", () => {
    expect(ctx.store.jobId("https://a.com/job/1")).not.toBe(ctx.store.jobId("https://a.com/job/2"));
  });
});

describe("getJobs / upsertJob", () => {
  it("starts empty when no file exists", async () => {
    expect(await ctx.store.getJobs()).toEqual({});
  });

  it("creates the folder and saves a record keyed by job id", async () => {
    const saved = await ctx.store.upsertJob(job(1, { score: 88 }));
    expect(saved.id).toBe(ctx.store.jobId("https://jobs.example.com/1"));
    expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const onDisk = JSON.parse(readFileSync(ctx.file, "utf8"));
    expect(onDisk[saved.id]).toMatchObject({ title: "Engineer 1", score: 88, status: "seen" });
  });

  it("merges an update into the existing record instead of replacing it", async () => {
    await ctx.store.upsertJob(job(1, { score: 90, note: "great fit" }));
    const next = await ctx.store.upsertJob({ ...job(1), status: "notified" });
    expect(next).toMatchObject({ status: "notified", score: 90, note: "great fit", title: "Engineer 1" });
    expect(Object.keys(await ctx.store.getJobs())).toHaveLength(1);
  });

  it("treats the same url with a trailing slash as the same job", async () => {
    await ctx.store.upsertJob(job(1));
    await ctx.store.upsertJob({ ...job(1), url: "https://jobs.example.com/1/", status: "applied" });
    const all = Object.values(await ctx.store.getJobs());
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("applied");
  });

  it("refreshes updatedAt on every write", async () => {
    const first = await ctx.store.upsertJob(job(1));
    await new Promise((r) => setTimeout(r, 5));
    const second = await ctx.store.upsertJob({ ...job(1), status: "applied" });
    expect(second.updatedAt >= first.updatedAt).toBe(true);
    expect(second.updatedAt).not.toBe(first.updatedAt);
  });

  it("does not lose records when many writes happen at once", async () => {
    // Regression: parallel record_job calls used to overwrite each other.
    await Promise.all(Array.from({ length: 40 }, (_, i) => ctx.store.upsertJob(job(i))));
    expect(Object.keys(await ctx.store.getJobs())).toHaveLength(40);
  });

  it("keeps the last status when the same job is written concurrently", async () => {
    await Promise.all(
      (["seen", "notified", "approved", "applied"] as const).map((status) => ctx.store.upsertJob({ ...job(1), status })),
    );
    const [only] = Object.values(await ctx.store.getJobs());
    expect(only!.status).toBe("applied");
  });

  it("recovers from a corrupt store file instead of crashing", async () => {
    mkdirSync(dirname(ctx.file), { recursive: true });
    writeFileSync(ctx.file, "{ not json");
    expect(await ctx.store.getJobs()).toEqual({});
    await ctx.store.upsertJob(job(1));
    expect(Object.keys(JSON.parse(readFileSync(ctx.file, "utf8")))).toHaveLength(1);
  });

  it("keeps working after a failed write", async () => {
    const bad = ctx.store.upsertJob({ title: "x", company: "y", status: "seen" } as never);
    await expect(bad).rejects.toThrow();
    await expect(ctx.store.upsertJob(job(2))).resolves.toMatchObject({ title: "Engineer 2" });
  });
});
