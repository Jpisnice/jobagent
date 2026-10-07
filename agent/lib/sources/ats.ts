import type { Source } from "./types";
import { clip, eachSlug, getJson } from "./util";

export const greenhouse: Source = {
  id: "greenhouse",
  kind: "ats",
  run: (slugs) =>
    eachSlug(slugs, async (slug) => {
      const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
      return (d.jobs ?? []).map((j: any) => ({
        title: j.title, company: slug, location: j.location?.name ?? "", url: j.absolute_url,
        source: "greenhouse", description: clip(j.content),
      }));
    }),
};

export const lever: Source = {
  id: "lever",
  kind: "ats",
  run: (slugs) =>
    eachSlug(slugs, async (slug) => {
      const d = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
      return (d ?? []).map((j: any) => ({
        title: j.text, company: slug, location: j.categories?.location ?? "", url: j.hostedUrl,
        source: "lever", description: clip(j.descriptionPlain),
      }));
    }),
};

export const ashby: Source = {
  id: "ashby",
  kind: "ats",
  run: (slugs) =>
    eachSlug(slugs, async (slug) => {
      const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
      return (d.jobs ?? []).map((j: any) => ({
        title: j.title, company: slug, location: j.location ?? "", url: j.jobUrl,
        source: "ashby", description: clip(j.descriptionPlain),
      }));
    }),
};

export const workable: Source = {
  id: "workable",
  kind: "ats",
  run: (slugs) =>
    eachSlug(slugs, async (slug) => {
      const d = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${slug}`);
      return (d.jobs ?? []).map((j: any) => ({
        title: j.title, company: d.name ?? slug,
        location: [j.city, j.state, j.country].filter(Boolean).join(", "),
        url: j.url ?? `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
        source: "workable", description: clip(j.description),
      }));
    }),
};

export const smartrecruiters: Source = {
  id: "smartrecruiters",
  kind: "ats",
  run: (slugs) =>
    eachSlug(slugs, async (slug) => {
      const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`);
      return (d.content ?? []).map((j: any) => ({
        title: j.name, company: j.company?.name ?? slug,
        location: [j.location?.city, j.location?.country, j.location?.remote ? "Remote" : ""].filter(Boolean).join(", "),
        url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
        source: "smartrecruiters", description: clip(j.department?.label ?? ""),
      }));
    }),
};

export const recruitee: Source = {
  id: "recruitee",
  kind: "ats",
  run: (slugs) =>
    eachSlug(slugs, async (slug) => {
      const d = await getJson(`https://${slug}.recruitee.com/api/offers/`);
      return (d.offers ?? []).map((j: any) => ({
        title: j.title, company: j.company_name ?? slug,
        location: j.location || (j.remote ? "Remote" : ""),
        url: j.careers_url, source: "recruitee", description: clip(j.description),
      }));
    }),
};
