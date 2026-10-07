import companies from "../../data/companies.json";
import { sourceIds, sources, type Job } from "./sources";
import { getJobs, jobId } from "./store";

export const ats = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee"] as const;
const defaults = companies as Record<string, string[]>;

// Word-boundary match so short keywords like "Go" don't hit "Google".
const hit = (text: string, kw: string) =>
  new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text);

// Cheap pre-filter: the candidate wants mid level, so skip clearly senior/management/intern titles
// before spending matcher tokens on them.
const TOO_SENIOR =
  /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp|intern|internship|trainee|architect|distinguished|fellow|chief)\b/i;

// A description-only keyword hit only counts for engineering-looking titles, so roles like
// "Executive Assistant" that merely mention React don't reach the matcher.
const ENG_TITLE = /engineer|developer|software|full.?stack|back.?end|front.?end|programmer|swe/i;

// 2 = keyword in the title, 1 = only in the description, 0 = no match.
const relevance = (j: Job, kws: string[]) => {
  if (kws.length === 0) return 1;
  if (kws.some((k) => hit(j.title, k))) return 2;
  const engineering = ENG_TITLE.test(j.title) || j.source === "hn-hiring";
  return engineering && kws.some((k) => hit(j.description ?? "", k)) ? 1 : 0;
};

export interface SearchInput {
  keywords: string[];
  sources?: string[];
  extraCompanies: Array<{ source: (typeof ats)[number]; slug: string }>;
  perSource: number;
  limit: number;
}

export interface SourceStat {
  fetched: number;
  new: number;
  tooSenior: number;
  matched: number;
  returned: number;
  errors?: string[];
}

// Searches every requested source, drops jobs already in the store and too-senior titles, keeps
// keyword matches, and interleaves sources so no single one fills the result.
export async function searchJobs(
  input: SearchInput,
): Promise<{ count: number; jobs: Job[]; sourceStats: Record<string, SourceStat> }> {
  const seen = await getJobs();
  const wanted = (input.sources?.length ? input.sources : sourceIds).filter((s) => sources[s]);

  const runs = await Promise.all(
    wanted.map(async (id) => {
      const src = sources[id]!;
      const slugs =
        src.kind === "ats"
          ? [...(defaults[id] ?? []), ...input.extraCompanies.filter((c) => c.source === id).map((c) => c.slug)]
          : [];
      return [id, await src.run(slugs)] as const;
    }),
  );

  const stats: Record<string, SourceStat> = {};
  const perSource: Job[][] = [];
  for (const [id, r] of runs) {
    const fresh = r.jobs.filter((j) => j.url && !seen[jobId(j.url)]);
    const levelOk = fresh.filter((j) => !TOO_SENIOR.test(j.title));
    const matched = levelOk
      .map((j) => ({ j, s: relevance(j, input.keywords) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.j);
    // Multi-location postings repeat the same role; keep one per company and title.
    const uniq = new Set<string>();
    const returned = matched
      .filter((j) => {
        const key = `${j.company}|${j.title}`.toLowerCase();
        return uniq.has(key) ? false : (uniq.add(key), true);
      })
      .slice(0, input.perSource);
    stats[id] = {
      fetched: r.jobs.length,
      new: fresh.length,
      tooSenior: fresh.length - levelOk.length,
      matched: matched.length,
      returned: returned.length,
      ...(r.errors.length ? { errors: r.errors.slice(0, 3) } : {}),
    };
    perSource.push(returned);
  }

  // Round-robin across sources so no single source fills the whole result.
  const jobs: Job[] = [];
  for (let i = 0; jobs.length < input.limit && perSource.some((p) => i < p.length); i++) {
    for (const p of perSource) if (p[i] && jobs.length < input.limit) jobs.push(p[i]!);
  }
  return { count: jobs.length, jobs, sourceStats: stats };
}
