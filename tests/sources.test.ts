import { describe, expect, it } from "vitest";
import { ashby, greenhouse, lever, recruitee, smartrecruiters, workable } from "../agent/lib/sources/ats";
import {
  arbeitnow, himalayas, hnHiring, jobicy, remoteok, remotive, weworkremotely,
} from "../agent/lib/sources/boards";
import { sourceIds, sources } from "../agent/lib/sources";
import { jsonResponse, stubFetch, textResponse } from "./helpers";

describe("registry", () => {
  it("registers every provider once, keyed by id", () => {
    expect([...sourceIds].sort()).toEqual(
      ["arbeitnow", "ashby", "greenhouse", "himalayas", "hn-hiring", "jobicy", "lever", "recruitee",
       "remoteok", "remotive", "smartrecruiters", "weworkremotely", "workable"].sort(),
    );
    for (const id of sourceIds) expect(sources[id]!.id).toBe(id);
  });

  it("marks company-board providers as ats and single feeds as board", () => {
    const ats = sourceIds.filter((id) => sources[id]!.kind === "ats").sort();
    expect(ats).toEqual(["ashby", "greenhouse", "lever", "recruitee", "smartrecruiters", "workable"]);
  });
});

describe("ATS providers", () => {
  it("greenhouse: maps jobs and uses the slug as the company", async () => {
    const { calls } = stubFetch({
      "boards-api.greenhouse.io/v1/boards/acme/jobs": {
        jobs: [{ title: "Software Engineer", absolute_url: "https://g/1", location: { name: "Remote" }, content: "<p>Build &amp; ship</p>" }],
      },
    });
    const r = await greenhouse.run(["acme"]);
    expect(r.jobs).toEqual([
      { title: "Software Engineer", company: "acme", location: "Remote", url: "https://g/1", source: "greenhouse", description: "Build & ship" },
    ]);
    expect(calls[0]!.url).toContain("content=true");
  });

  it("greenhouse: tolerates a missing location and empty board", async () => {
    stubFetch({ "boards/acme": { jobs: [{ title: "T", absolute_url: "u" }] }, "boards/empty": {} });
    expect((await greenhouse.run(["acme"])).jobs[0]!.location).toBe("");
    expect((await greenhouse.run(["empty"])).jobs).toEqual([]);
  });

  it("lever: maps postings", async () => {
    stubFetch({
      "api.lever.co/v0/postings/acme": [
        { text: "Backend Engineer", hostedUrl: "https://l/1", categories: { location: "Bengaluru" }, descriptionPlain: "Go services" },
      ],
    });
    const r = await lever.run(["acme"]);
    expect(r.jobs[0]).toMatchObject({ title: "Backend Engineer", location: "Bengaluru", url: "https://l/1", source: "lever", description: "Go services" });
  });

  it("ashby: maps postings", async () => {
    stubFetch({
      "job-board/acme": { jobs: [{ title: "Full Stack Engineer", jobUrl: "https://a/1", location: "Remote", descriptionPlain: "TypeScript" }] },
    });
    const r = await ashby.run(["acme"]);
    expect(r.jobs[0]).toMatchObject({ company: "acme", url: "https://a/1", source: "ashby" });
  });

  it("workable: builds the url from the shortcode when none is given and joins the location", async () => {
    stubFetch({
      "accounts/acme": { name: "Acme Inc", jobs: [{ title: "Dev", shortcode: "ABC123", city: "Paris", state: "", country: "France", description: "<p>x</p>" }] },
    });
    const r = await workable.run(["acme"]);
    expect(r.jobs[0]).toMatchObject({ company: "Acme Inc", location: "Paris, France", url: "https://apply.workable.com/acme/j/ABC123/" });
  });

  it("smartrecruiters: builds the posting url and marks remote roles", async () => {
    stubFetch({
      "companies/Wise/postings": {
        content: [{ id: "744", name: "Engineer", company: { name: "Wise" }, location: { city: "London", country: "gb", remote: true } }],
      },
    });
    const r = await smartrecruiters.run(["Wise"]);
    expect(r.jobs[0]).toMatchObject({ url: "https://jobs.smartrecruiters.com/Wise/744", location: "London, gb, Remote", company: "Wise" });
  });

  it("recruitee: falls back to Remote when there is no location", async () => {
    stubFetch({
      "acme.recruitee.com/api/offers": { offers: [{ title: "Dev", careers_url: "https://r/1", remote: true, company_name: "Acme", description: "d" }] },
    });
    expect((await recruitee.run(["acme"])).jobs[0]).toMatchObject({ location: "Remote", url: "https://r/1" });
  });

  it("reports a dead company slug as an error and keeps the good ones", async () => {
    stubFetch({ "boards/dead": textResponse("nope", 404), "boards/ok": { jobs: [{ title: "T", absolute_url: "u" }] } });
    const r = await greenhouse.run(["dead", "ok"]);
    expect(r.jobs).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^dead: .*404/);
  });
});

describe("remote boards", () => {
  it("remoteok: skips the legal notice object at index 0", async () => {
    stubFetch({
      "remoteok.com/api": [
        { legal: "terms" },
        { position: "Engineer", company: "Acme", location: "", url: "https://r/1", description: "<b>x</b>" },
      ],
    });
    const r = await remoteok.run([]);
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({ title: "Engineer", location: "Remote", source: "remoteok", description: "x" });
  });

  it("remotive: maps the required-location field", async () => {
    stubFetch({
      "remotive.com/api": { jobs: [{ title: "Dev", company_name: "Acme", candidate_required_location: "USA, India", url: "https://rm/1", description: "d" }] },
    });
    expect((await remotive.run([])).jobs[0]).toMatchObject({ company: "Acme", location: "USA, India", source: "remotive" });
  });

  it("himalayas: prefers the application link and joins location restrictions", async () => {
    stubFetch({
      "himalayas.app": {
        jobs: [
          { title: "A", companyName: "X", locationRestrictions: ["US", "UK"], applicationLink: "https://h/apply", guid: "https://h/guid", excerpt: "e" },
          { title: "B", companyName: "Y", guid: "https://h/guid2" },
        ],
      },
    });
    const r = await himalayas.run([]);
    expect(r.jobs[0]).toMatchObject({ url: "https://h/apply", location: "US, UK" });
    expect(r.jobs[1]).toMatchObject({ url: "https://h/guid2", location: "Remote" });
  });

  it("arbeitnow: marks remote roles in the location", async () => {
    stubFetch({
      "arbeitnow.com": { data: [{ title: "Dev", company_name: "Acme", location: "Berlin", remote: true, url: "https://an/1", description: "d" }] },
    });
    expect((await arbeitnow.run([])).jobs[0]!.location).toBe("Berlin (Remote)");
  });

  it("jobicy: maps its own field names", async () => {
    stubFetch({
      "jobicy.com": { jobs: [{ jobTitle: "Dev", companyName: "Acme", jobGeo: "", url: "https://j/1", jobExcerpt: "ex" }] },
    });
    expect((await jobicy.run([])).jobs[0]).toMatchObject({ title: "Dev", location: "Remote", description: "ex", source: "jobicy" });
  });

  const rss = (title: string, link: string, region = "Anywhere") =>
    `<rss><channel><item><title><![CDATA[${title}]]></title><region>${region}</region><link>${link}</link><description>&lt;p&gt;desc&lt;/p&gt;</description></item></channel></rss>`;

  it("weworkremotely: splits 'Company: Title' and reads all three category feeds", async () => {
    const { calls } = stubFetch({
      "full-stack": textResponse(rss("Acme: Full Stack Engineer", "https://w/1")),
      "back-end": textResponse(rss("Beta: Backend: Senior", "https://w/2", "USA Only")),
      "front-end": textResponse("down", 500),
    });
    const r = await weworkremotely.run([]);
    expect(calls).toHaveLength(3);
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs[0]).toMatchObject({ company: "Acme", title: "Full Stack Engineer", location: "Anywhere", description: "desc" });
    expect(r.jobs[1]).toMatchObject({ company: "Beta", title: "Backend: Senior", location: "USA Only" });
  });

  it("weworkremotely: keeps the whole title when there is no company prefix", async () => {
    stubFetch({ weworkremotely: textResponse(rss("Just a title", "https://w/3")) });
    expect((await weworkremotely.run([])).jobs[0]).toMatchObject({ title: "Just a title", company: "" });
  });

  describe("hn-hiring", () => {
    const thread = { hits: [{ title: "Ask HN: Who wants to be hired?", objectID: "1" }, { title: "Ask HN: Who is hiring? (October 2026)", objectID: "100" }] };

    it("reads top-level comments of the latest 'Who is hiring' thread and finds the role segment", async () => {
      stubFetch({
        "search_by_date": thread,
        "tags=comment,story_100": {
          hits: [
            { objectID: "201", parent_id: 100, comment_text: "Acme | Senior Backend Engineer | REMOTE (US) | $150k &amp; equity" },
            { objectID: "202", parent_id: 999, comment_text: "A reply to someone else" },
            { objectID: "203", parent_id: 100, comment_text: null },
          ],
        },
      });
      const r = await hnHiring.run([]);
      expect(r.jobs).toHaveLength(1);
      expect(r.jobs[0]).toMatchObject({
        company: "Acme",
        title: "Senior Backend Engineer",
        location: "REMOTE (US)",
        url: "https://news.ycombinator.com/item?id=201",
        source: "hn-hiring",
      });
      expect(r.jobs[0]!.description).toContain("$150k & equity");
    });

    it("returns nothing when there is no 'Who is hiring' thread", async () => {
      stubFetch({ "search_by_date": { hits: [{ title: "Something else", objectID: "1" }] } });
      expect(await hnHiring.run([])).toEqual({ jobs: [], errors: [] });
    });

    it("reports a failed lookup as an error", async () => {
      stubFetch({ "search_by_date": jsonResponse({}, 500) });
      const r = await hnHiring.run([]);
      expect(r.jobs).toEqual([]);
      expect(r.errors[0]).toMatch(/500/);
    });
  });

  it("a failing board returns an error entry rather than throwing", async () => {
    stubFetch({ "remotive.com": textResponse("rate limited", 429) });
    const r = await remotive.run([]);
    expect(r.jobs).toEqual([]);
    expect(r.errors[0]).toMatch(/429/);
  });
});
