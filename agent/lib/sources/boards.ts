import type { Source } from "./types";
import { clip, feed, getJson, getText, xmlTag } from "./util";

export const remoteok: Source = {
  id: "remoteok",
  kind: "board",
  run: () =>
    feed(async () => {
      const d = await getJson("https://remoteok.com/api");
      return d.slice(1).map((j: any) => ({
        title: j.position, company: j.company, location: j.location || "Remote",
        url: j.url, source: "remoteok", description: clip(j.description),
      }));
    }),
};

export const remotive: Source = {
  id: "remotive",
  kind: "board",
  run: () =>
    feed(async () => {
      const d = await getJson("https://remotive.com/api/remote-jobs?category=software-dev&limit=150");
      return (d.jobs ?? []).map((j: any) => ({
        title: j.title, company: j.company_name, location: j.candidate_required_location || "Remote",
        url: j.url, source: "remotive", description: clip(j.description),
      }));
    }),
};

export const himalayas: Source = {
  id: "himalayas",
  kind: "board",
  run: () =>
    feed(async () => {
      const d = await getJson("https://himalayas.app/jobs/api?limit=100");
      return (d.jobs ?? []).map((j: any) => ({
        title: j.title, company: j.companyName,
        location: (j.locationRestrictions ?? []).join(", ") || "Remote",
        url: j.applicationLink ?? j.guid, source: "himalayas", description: clip(j.excerpt ?? j.description),
      }));
    }),
};

export const arbeitnow: Source = {
  id: "arbeitnow",
  kind: "board",
  run: () =>
    feed(async () => {
      const d = await getJson("https://www.arbeitnow.com/api/job-board-api");
      return (d.data ?? []).map((j: any) => ({
        title: j.title, company: j.company_name, location: `${j.location ?? ""}${j.remote ? " (Remote)" : ""}`.trim(),
        url: j.url, source: "arbeitnow", description: clip(j.description),
      }));
    }),
};

export const jobicy: Source = {
  id: "jobicy",
  kind: "board",
  run: () =>
    feed(async () => {
      const d = await getJson("https://jobicy.com/api/v2/remote-jobs?count=50&industry=dev");
      return (d.jobs ?? []).map((j: any) => ({
        title: j.jobTitle, company: j.companyName, location: j.jobGeo || "Remote",
        url: j.url, source: "jobicy", description: clip(j.jobExcerpt ?? j.jobDescription),
      }));
    }),
};

export const weworkremotely: Source = {
  id: "weworkremotely",
  kind: "board",
  run: () =>
    feed(async () => {
      const feeds = [
        "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
        "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
        "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
      ];
      const texts = await Promise.allSettled(feeds.map(getText));
      return texts.flatMap((t) =>
        t.status === "fulfilled"
          ? (t.value.match(/<item>[\s\S]*?<\/item>/g) ?? []).map((item) => {
              const raw = xmlTag(item, "title");
              const [company, ...rest] = raw.split(":");
              return {
                title: rest.join(":").trim() || raw, company: rest.length ? company!.trim() : "",
                location: xmlTag(item, "region") || "Remote", url: xmlTag(item, "link"),
                source: "weworkremotely", description: clip(xmlTag(item, "description")),
              };
            })
          : [],
      );
    }),
};

// "Ask HN: Who is hiring?" comments from the latest monthly thread.
export const hnHiring: Source = {
  id: "hn-hiring",
  kind: "board",
  run: () =>
    feed(async () => {
      const t = await getJson(
        "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5",
      );
      const thread = (t.hits ?? []).find((h: any) => /who is hiring/i.test(h.title ?? ""));
      if (!thread) return [];
      const c = await getJson(
        `https://hn.algolia.com/api/v1/search?tags=comment,story_${thread.objectID}&hitsPerPage=200`,
      );
      return (c.hits ?? [])
        .filter((h: any) => Number(h.parent_id) === Number(thread.objectID) && h.comment_text)
        .map((h: any) => {
          const text = clip(h.comment_text, 700);
          const head = text.split("|").map((s: string) => s.trim());
          return {
            // Comments are usually "Company | Role | Location | ..."; find the role segment.
            title:
              head.find((s: string) => /engineer|developer|designer|scientist|architect|lead|manager/i.test(s)) ??
              head[1] ?? text.slice(0, 80),
            company: head[0] ?? "", location: head.find((s: string) => /remote|onsite|hybrid/i.test(s)) ?? "",
            url: `https://news.ycombinator.com/item?id=${h.objectID}`, source: "hn-hiring", description: text,
          };
        });
    }),
};
