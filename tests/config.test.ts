import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import companies from "../data/companies.json";
import profile from "../data/profile.json";
import { sources } from "../agent/lib/sources";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const toolFiles = readdirSync(join(root, "agent/tools")).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("data/companies.json", () => {
  const entries = Object.entries(companies as Record<string, string[]>);

  it("has a list for every company-board provider, and only those", () => {
    const ats = Object.values(sources).filter((s) => s.kind === "ats").map((s) => s.id).sort();
    expect(entries.map(([k]) => k).sort()).toEqual(ats);
  });

  it.each(entries)("%s: slugs are non-empty, trimmed strings without duplicates", (_name, slugs) => {
    expect(slugs.length).toBeGreaterThan(0);
    for (const s of slugs) {
      expect(typeof s).toBe("string");
      expect(s).toBe(s.trim());
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toMatch(/[\s/]/);
    }
    expect(new Set(slugs.map((s) => s.toLowerCase())).size).toBe(slugs.length);
  });
});

describe("data/profile.json", () => {
  it("has the identity and contact fields applications need", () => {
    expect(profile.name).toBeTruthy();
    expect(profile.contact.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(profile.contact.phone.replace(/\D/g, "").length).toBeGreaterThanOrEqual(10);
    expect(profile.contact.location).toBeTruthy();
  });

  it("lists skills, experience, projects and education", () => {
    expect(profile.skills.languages.length).toBeGreaterThan(0);
    expect(profile.experience.length).toBeGreaterThan(0);
    expect(profile.projects.length).toBeGreaterThan(0);
    expect(profile.education.length).toBeGreaterThan(0);
  });

  it("has well-formed experience entries with at most one current job", () => {
    for (const e of profile.experience) {
      expect(e.start).toMatch(/^\d{4}-\d{2}$/);
      expect(e.end === null || /^\d{4}-\d{2}$/.test(e.end as string)).toBe(true);
      expect(e.current).toBe(e.end === null);
    }
    expect(profile.experience.filter((e) => e.current).length).toBeLessThanOrEqual(1);
  });

  it("encodes the job-search rules the matcher depends on", () => {
    const p = profile.preferences;
    expect(p.seniority).toBe("mid");
    expect(p.minScore).toBeGreaterThanOrEqual(0);
    expect(p.minScore).toBeLessThanOrEqual(100);
    expect(p.locations.India.workMode).toEqual(["remote"]);
    expect(p.locations.India.required).toBe(true);
    expect(p.locations.India.minSalaryINR).toBe(1_000_000);
    expect(p.locations.abroad.minSalaryINR).toBe(1_400_000);
    expect(p.locations.abroad.regions).toEqual(expect.arrayContaining(["US", "UK", "UAE", "Europe"]));
    expect(p.targetRoles.length).toBeGreaterThan(0);
    expect(p.keywords.length).toBeGreaterThan(0);
  });

  it("has the standard application answers", () => {
    expect(profile.answers.noticePeriod).toBe("30 days");
    expect(profile.answers.workAuthorization).toBeTruthy();
  });
});

describe("alertEmail", () => {
  it("defaults to the resume email and can be overridden", async () => {
    vi.resetModules();
    delete process.env.ALERT_TO_EMAIL;
    const { alertEmail } = await import("../agent/lib/profile");
    expect(alertEmail()).toBe(profile.contact.email);
    vi.stubEnv("ALERT_TO_EMAIL", "other@example.com");
    expect(alertEmail()).toBe("other@example.com");
    vi.unstubAllEnvs();
  });
});

describe("schedule", () => {
  it("runs on a valid 5-field cron and tells the agent never to apply", async () => {
    const def = (await import("../agent/schedules/job-search")).default as any;
    expect(def.cron.trim().split(/\s+/)).toHaveLength(5);
    expect(def.markdown).toMatch(/matcher/);
    expect(def.markdown).toMatch(/Do NOT submit/i);
    expect(def.markdown).toMatch(/fetch_jobs/);
  });
});

describe("agent settings", () => {
  it("sets a context window, compaction and usage caps so sessions cannot run away", async () => {
    const def = (await import("../agent/agent")).default as any;
    expect(def.modelContextWindowTokens).toBeGreaterThan(0);
    expect(def.compaction.thresholdPercent).toBeGreaterThan(0);
    expect(def.compaction.thresholdPercent).toBeLessThan(1);
    expect(def.limits.maxInputTokensPerSession).toBeGreaterThan(0);
    expect(def.limits.maxOutputTokensPerSession).toBeGreaterThan(0);
  });

  it("gives the matcher a hard, small budget", async () => {
    const def = (await import("../agent/subagents/matcher/agent")).default as any;
    expect(def.description).toBeTruthy();
    expect(def.reasoning).toBe("minimal");
    expect(def.limits.maxOutputTokensPerSession).toBeLessThanOrEqual(5_000);
    expect(def.limits.maxInputTokensPerSession).toBeLessThanOrEqual(100_000);
  });
});

describe("tool definitions", () => {
  const own = ["approve_application", "browser_submit", "browser_task", "draft_application", "fetch_jobs", "get_profile", "record_job", "send_alert"];

  it.each(own)("%s has a description and an input schema", async (name) => {
    const tool = (await import(`../agent/tools/${name}.ts`)).default as any;
    expect(tool.description.length).toBeGreaterThan(30);
    expect(typeof tool.inputSchema.parse).toBe("function");
    expect(typeof tool.execute).toBe("function");
  });

  it("only the approval-gated tools can finish an application", async () => {
    const gated: string[] = [];
    for (const name of toolFiles) {
      const tool = (await import(`../agent/tools/${name}.ts`)).default as any;
      if (typeof tool?.approval === "function") gated.push(name);
    }
    expect(gated.sort()).toEqual(["approve_application", "browser_submit"]);
  });

  it("web_search stays disabled because Gemini cannot mix it with function tools", () => {
    expect(read("agent/tools/web_search.ts")).toMatch(/disableTool\(\)/);
  });
});

describe("instructions", () => {
  const instructions = read("agent/instructions.md");
  const subagents = readdirSync(join(root, "agent/subagents"));
  const known = new Set([...toolFiles, ...subagents]);
  // Tokens in backticks that are statuses or fields, not tools.
  const notTools = new Set(["needs_human", "needs_submit_approval", "min_score"]);

  it("only names tools and subagents that exist", () => {
    const named = [...instructions.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!).filter((t) => !notTools.has(t));
    const missing = named.filter((t) => !known.has(t));
    expect(missing).toEqual([]);
  });

  it("names the matcher subagent and the approval tools", () => {
    expect(subagents).toContain("matcher");
    for (const t of ["matcher", "approve_application", "browser_task", "browser_submit", "fetch_jobs", "send_alert"]) {
      expect(instructions).toContain(`\`${t}\``);
    }
  });

  it("keeps the safety rules", () => {
    expect(instructions).toMatch(/Never submit an application without an approved/i);
    expect(instructions).toMatch(/Never invent/i);
  });

  it("matcher instructions only use the matcher's own tool and ask for compact json", () => {
    const text = read("agent/subagents/matcher/instructions.md");
    expect(text).toContain("get_profile");
    expect(text).not.toMatch(/fetch_jobs|send_alert|browser_/);
    expect(text).toMatch(/ONLY a compact JSON array/);
  });
});

describe("no leftovers from removed setups", () => {
  const files = walk(join(root, "agent")).filter((f) => /\.(ts|md)$/.test(f));

  it("nothing under agent/ refers to Browserbase, Playwright or the old chrome_ tools", () => {
    const hits = files.filter((f) => /browserbase|playwright|chrome_(open|click|fill|snapshot|press|upload|submit)/i.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the old tool files are gone", () => {
    for (const f of ["agent/lib/chrome.ts", "agent/tools/chrome_open.ts", "agent/extensions"]) {
      expect(existsSync(join(root, f))).toBe(false);
    }
  });

  it("package.json has no Browserbase or Playwright dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /browserbase|playwright/i.test(d))).toEqual([]);
  });

  it("secrets and local browser data stay out of git", () => {
    const ignore = read(".gitignore");
    for (const entry of [".env", ".chrome-profile", ".data", "browser-service/.venv"]) expect(ignore).toContain(entry);
  });
});
