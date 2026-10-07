import type { Job, SourceResult } from "./types";

const ENTITIES: Record<string, string> = {
  "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&#x27;": "'",
  "&#x2F;": "/", "&nbsp;": " ",
};
const decode = (s: string) => s.replace(/&(?:lt|gt|amp|quot|nbsp|#39|#x27|#x2F);/gi, (m) => ENTITIES[m] ?? ENTITIES[m.toLowerCase()] ?? m);

// Decode first (some feeds escape their HTML), then strip tags and collapse whitespace.
export const clip = (s: unknown, n = 600) =>
  decode(decode(String(s ?? "")))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

async function get(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { "user-agent": "jobagent/0.1", accept: "application/json, text/xml, */*" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res;
}

export async function getJson(url: string): Promise<any> {
  return (await get(url)).json();
}

export async function getText(url: string): Promise<string> {
  return (await get(url)).text();
}

// Run one fetcher per company slug; one dead slug must not hide the rest.
export async function eachSlug(
  slugs: string[],
  fn: (slug: string) => Promise<Job[]>,
): Promise<SourceResult> {
  const settled = await Promise.allSettled(slugs.map(fn));
  const jobs: Job[] = [];
  const errors: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") jobs.push(...r.value);
    else errors.push(`${slugs[i]}: ${String(r.reason).replace(/^Error: /, "")}`);
  });
  return { jobs, errors };
}

// Run a single feed and turn a failure into an error entry instead of throwing.
export async function feed(fn: () => Promise<Job[]>): Promise<SourceResult> {
  try {
    return { jobs: await fn(), errors: [] };
  } catch (e) {
    return { jobs: [], errors: [String(e).replace(/^Error: /, "")] };
  }
}

export const xmlTag = (block: string, tag: string) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return (m?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
};
