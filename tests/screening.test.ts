import { describe, expect, it } from "vitest";
import { ProfileSchema } from "../agent/lib/profile";
import { batches, matcherMessage, mergeVerdicts, slimProfile, VerdictsSchema } from "../agent/lib/screening";
import { sampleProfile } from "./fixtures";

const job = (n: number) => ({
  title: `Engineer ${n}`, company: `Co${n}`, location: "Remote", url: `https://jobs.example.com/${n}`, source: "board",
  description: `Build things ${n}`,
});
const verdict = (n: number, relevant: boolean, score: number) => ({
  url: `https://jobs.example.com/${n}`, relevant, score, reason: `reason ${n}`,
});

describe("batches", () => {
  it("splits into groups of the given size and keeps every item", () => {
    const groups = batches(Array.from({ length: 23 }, (_, i) => i), 10);
    expect(groups.map((g) => g.length)).toEqual([10, 10, 3]);
    expect(groups.flat()).toEqual(Array.from({ length: 23 }, (_, i) => i));
  });

  it("returns no batches for no items", () => {
    expect(batches([], 10)).toEqual([]);
  });
});

describe("matcherMessage", () => {
  const profile = slimProfile(ProfileSchema.parse(sampleProfile()));

  it("carries the slim profile and every posting, so the matcher needs no tools", () => {
    const msg = matcherMessage(profile, [job(1), job(2)]);
    expect(msg).toContain(JSON.stringify(profile));
    expect(msg).toContain("https://jobs.example.com/1");
    expect(msg).toContain("https://jobs.example.com/2");
    expect(msg).toContain("Build things 2");
  });

  it("leaves contact details out", () => {
    expect(matcherMessage(profile, [job(1)])).not.toMatch(/555 010|test\.candidate@/);
  });
});

describe("mergeVerdicts", () => {
  it("pairs verdicts with jobs by url, whatever order they come back in", () => {
    const out = mergeVerdicts([job(1), job(2)], [verdict(2, false, 10), verdict(1, true, 90)], 70);
    expect(out.map((s) => [s.job.url, s.relevant, s.score])).toEqual([
      ["https://jobs.example.com/1", true, 90],
      ["https://jobs.example.com/2", false, 10],
    ]);
  });

  it("matches a url with a trailing slash or fragment", () => {
    const out = mergeVerdicts([job(1)], [{ ...verdict(1, true, 90), url: "https://jobs.example.com/1/#apply" }], 70);
    expect(out[0]!.relevant).toBe(true);
  });

  it("treats a posting with no verdict as not relevant", () => {
    const [only] = mergeVerdicts([job(1)], [], 70);
    expect(only).toMatchObject({ relevant: false, score: 0 });
    expect(only!.reason).toMatch(/no verdict/i);
  });

  it("demotes a relevant verdict below the candidate's minScore", () => {
    const [only] = mergeVerdicts([job(1)], [verdict(1, true, 60)], 70);
    expect(only).toMatchObject({ relevant: false, score: 60 });
  });

  it("ignores verdicts for postings that were not sent", () => {
    expect(mergeVerdicts([job(1)], [verdict(1, true, 80), verdict(9, true, 99)], 70)).toHaveLength(1);
  });
});

describe("VerdictsSchema", () => {
  it("accepts a well-formed batch and rejects scores out of range", () => {
    expect(VerdictsSchema.safeParse({ verdicts: [verdict(1, true, 80)] }).success).toBe(true);
    expect(VerdictsSchema.safeParse({ verdicts: [verdict(1, true, 180)] }).success).toBe(false);
  });
});
