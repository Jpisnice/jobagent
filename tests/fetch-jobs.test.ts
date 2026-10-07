import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import companies from "../data/companies.json";
import { freshStore, parseInput, toolCtx } from "./helpers";

type J = { title: string; company: string; location: string; url: string; source: string; description?: string };
const job = (n: number, o: Partial<J> = {}): J => ({
  title: "Software Engineer", company: `Co${n}`, location: "Remote", url: `https://x/${n}`, source: "board-a", description: "", ...o,
});

// Fake sources, so these tests are deterministic and offline.
const fake = vi.hoisted(() => ({
  jobs: {} as Record<string, J[]>,
  errors: {} as Record<string, string[]>,
  slugsSeen: {} as Record<string, string[]>,
}));

vi.mock("../agent/lib/sources", () => {
  const make = (id: string, kind: "board" | "ats") => ({
    id,
    kind,
    run: async (slugs: string[]) => {
      fake.slugsSeen[id] = slugs;
      return { jobs: fake.jobs[id] ?? [], errors: fake.errors[id] ?? [] };
    },
  });
  const all = [make("board-a", "board"), make("board-b", "board"), make("hn-hiring", "board"), make("greenhouse", "ats")];
  return { sources: Object.fromEntries(all.map((s) => [s.id, s])), sourceIds: all.map((s) => s.id) };
});

let ctx: Awaited<ReturnType<typeof freshStore>>;
let tool: { execute(input: never, ctx: never): Promise<any>; inputSchema: any };

async function run(input: Record<string, unknown> = {}) {
  return tool.execute(parseInput(tool, input), toolCtx());
}

beforeEach(async () => {
  fake.jobs = {};
  fake.errors = {};
  fake.slugsSeen = {};
  ctx = await freshStore();
  tool = (await import("../agent/tools/fetch_jobs")).default as never;
});
afterEach(() => ctx.cleanup());

describe("filtering by level", () => {
  it.each([
    "Senior Software Engineer", "Sr. Backend Engineer", "Staff Engineer", "Principal Engineer", "Engineering Manager",
    "Tech Lead", "Software Engineering Intern", "Head of Engineering", "Director of Engineering", "Solutions Architect",
  ])("drops %s before the matcher ever sees it", async (title) => {
    fake.jobs["board-a"] = [job(1, { title })];
    expect((await run()).jobs).toEqual([]);
  });

  it("counts what it dropped in sourceStats", async () => {
    fake.jobs["board-a"] = [job(1, { title: "Senior Engineer" }), job(2, { title: "Staff Engineer" }), job(3)];
    expect((await run()).sourceStats["board-a"]).toMatchObject({ fetched: 3, new: 3, tooSenior: 2, returned: 1 });
  });

  it("keeps words that merely contain a senior word", async () => {
    fake.jobs["board-a"] = [job(1, { title: "Software Engineer, Leadership Tools" }), job(2, { title: "Internal Tools Engineer" })];
    expect((await run()).count).toBe(2);
  });
});

describe("keyword matching", () => {
  it("matches whole words only, so 'Go' does not match 'Google'", async () => {
    fake.jobs["board-a"] = [
      job(1, { title: "Software Engineer at Google", description: "Search ads" }),
      job(2, { title: "Go Developer" }),
    ];
    const { jobs } = await run({ keywords: ["Go"] });
    expect(jobs.map((j: J) => j.url)).toEqual(["https://x/2"]);
  });

  it("does not match a keyword inside a longer word, at either end", async () => {
    fake.jobs["board-a"] = [
      job(1, { title: "Mongo Engineer" }), // "Go" at the end of a word
      job(2, { title: "JavaScript Developer" }), // "Java" at the start of a word
      job(3, { title: "Java Developer" }),
      job(4, { title: "Backend Engineer", description: "Written in Go." }),
    ];
    const goJobs = (await run({ keywords: ["Go"] })).jobs.map((j: J) => j.url);
    expect(goJobs).toEqual(["https://x/4"]);
    const javaJobs = (await run({ keywords: ["Java"] })).jobs.map((j: J) => j.url);
    expect(javaJobs).toEqual(["https://x/3"]);
  });

  it("is case insensitive and handles punctuation in keywords such as Next.js and C++", async () => {
    fake.jobs["board-a"] = [job(1, { title: "next.js engineer" }), job(2, { title: "C++ Developer" }), job(3, { title: "Nextxjs Engineer" })];
    const { jobs } = await run({ keywords: ["Next.js", "C++"] });
    expect(jobs.map((j: J) => j.url).sort()).toEqual(["https://x/1", "https://x/2"]);
  });

  it("with no keywords every non-senior job passes", async () => {
    fake.jobs["board-a"] = [job(1, { title: "Anything" }), job(2, { title: "Nurse" })];
    expect((await run()).count).toBe(2);
  });

  it("ranks a title match above a description-only match", async () => {
    fake.jobs["board-a"] = [
      job(1, { title: "Software Engineer", description: "uses React daily" }),
      job(2, { title: "React Engineer", description: "" }),
    ];
    expect((await run({ keywords: ["React"] })).jobs.map((j: J) => j.url)).toEqual(["https://x/2", "https://x/1"]);
  });

  it("a description-only hit needs an engineering-looking title", async () => {
    fake.jobs["board-a"] = [
      job(1, { title: "Executive Assistant", description: "must know React" }),
      job(2, { title: "Full Stack Developer", description: "must know React" }),
    ];
    expect((await run({ keywords: ["React"] })).jobs.map((j: J) => j.url)).toEqual(["https://x/2"]);
  });

  it("hacker news comments are matched on their text since their titles are free-form", async () => {
    fake.jobs["hn-hiring"] = [job(1, { source: "hn-hiring", title: "https://acme.com", description: "We use Rust and Postgres" })];
    expect((await run({ keywords: ["Rust"] })).count).toBe(1);
  });
});

describe("what comes back", () => {
  it("excludes jobs already in the store", async () => {
    fake.jobs["board-a"] = [job(1), job(2)];
    await ctx.store.upsertJob({ url: "https://x/1", title: "Software Engineer", company: "Co1", status: "skipped" });
    const out = await run();
    expect(out.jobs.map((j: J) => j.url)).toEqual(["https://x/2"]);
    expect(out.sourceStats["board-a"]).toMatchObject({ fetched: 2, new: 1 });
  });

  it("keeps one posting per company and title when it is listed for several locations", async () => {
    fake.jobs["board-a"] = [
      job(1, { company: "Resend", title: "Software Engineer" }),
      job(2, { company: "resend", title: "software engineer" }),
      job(3, { company: "Resend", title: "Developer Advocate Engineer" }),
    ];
    expect((await run()).count).toBe(2);
  });

  it("caps each source, then interleaves sources so none dominates", async () => {
    fake.jobs["board-a"] = [1, 2, 3, 4, 5].map((n) => job(n, { source: "board-a" }));
    fake.jobs["board-b"] = [11, 12, 13, 14, 15].map((n) => job(n, { source: "board-b" }));
    const out = await run({ perSource: 2, limit: 10 });
    expect(out.sourceStats["board-a"].returned).toBe(2);
    expect(out.jobs.map((j: J) => j.source)).toEqual(["board-a", "board-b", "board-a", "board-b"]);
  });

  it("stops at the overall limit", async () => {
    fake.jobs["board-a"] = [1, 2, 3, 4, 5, 6].map((n) => job(n));
    fake.jobs["board-b"] = [11, 12, 13, 14, 15, 16].map((n) => job(n, { source: "board-b" }));
    expect((await run({ perSource: 6, limit: 5 })).count).toBe(5);
  });

  it("applies the defaults when only keywords are given", async () => {
    const parsed = parseInput(tool, { keywords: ["x"] }) as any;
    expect(parsed).toMatchObject({ perSource: 6, limit: 30, extraCompanies: [] });
  });

  it("rejects out-of-range limits", () => {
    expect(() => tool.inputSchema.parse({ limit: 500 })).toThrow();
    expect(() => tool.inputSchema.parse({ perSource: 0 })).toThrow();
  });
});

describe("sources and companies", () => {
  it("searches every source by default", async () => {
    await run();
    expect(Object.keys(fake.slugsSeen).sort()).toEqual(["board-a", "board-b", "greenhouse", "hn-hiring"]);
  });

  it("only searches the sources asked for and ignores unknown names", async () => {
    await run({ sources: ["board-b", "nonsense"] });
    expect(Object.keys(fake.slugsSeen)).toEqual(["board-b"]);
  });

  it("gives ats sources the built-in company list", async () => {
    await run();
    expect(fake.slugsSeen["greenhouse"]).toEqual((companies as Record<string, string[]>)["greenhouse"]);
  });

  it("adds extra companies on top of the built-in list, only for the matching ats", async () => {
    await run({ extraCompanies: [{ source: "greenhouse", slug: "my-company" }, { source: "lever", slug: "ignored-here" }] });
    expect(fake.slugsSeen["greenhouse"]).toEqual([...(companies as Record<string, string[]>)["greenhouse"]!, "my-company"]);
  });

  it("boards are run without any company slugs", async () => {
    await run();
    expect(fake.slugsSeen["board-a"]).toEqual([]);
  });

  it("reports a source's errors in sourceStats instead of failing, and still returns the rest", async () => {
    fake.jobs["board-b"] = [job(1, { source: "board-b" })];
    fake.errors["board-a"] = ["https://down -> 503", "x", "y", "z"];
    const out = await run();
    expect(out.count).toBe(1);
    expect(out.sourceStats["board-a"].errors).toEqual(["https://down -> 503", "x", "y"]);
  });

  it("drops postings with no url", async () => {
    fake.jobs["board-a"] = [job(1, { url: "" }), job(2)];
    expect((await run()).count).toBe(1);
  });
});
