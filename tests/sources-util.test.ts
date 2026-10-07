import { describe, expect, it } from "vitest";
import { clip, eachSlug, feed, getJson, getText, xmlTag } from "../agent/lib/sources/util";
import { stubFetch, textResponse } from "./helpers";

describe("clip", () => {
  it("strips html tags and collapses whitespace", () => {
    expect(clip("<p>Hello   <b>world</b></p>\n\n<ul><li>one</li></ul>")).toBe("Hello world one");
  });

  it("decodes entities, including html that arrives escaped", () => {
    expect(clip("&lt;p&gt;Remote &amp; hybrid&lt;/p&gt;")).toBe("Remote & hybrid");
    expect(clip("It&#39;s &quot;fine&quot;&nbsp;here")).toBe('It\'s "fine" here');
    expect(clip("https:&#x2F;&#x2F;example.com&#x2F;jobs")).toBe("https://example.com/jobs");
  });

  it("decodes twice for doubly escaped markup", () => {
    expect(clip("&amp;lt;b&amp;gt;bold&amp;lt;/b&amp;gt;")).toBe("bold");
  });

  it("truncates to the requested length", () => {
    expect(clip("a".repeat(1000), 600)).toHaveLength(600);
    expect(clip("abcdef", 3)).toBe("abc");
  });

  it("copes with null, undefined and numbers", () => {
    expect(clip(null)).toBe("");
    expect(clip(undefined)).toBe("");
    expect(clip(42)).toBe("42");
  });
});

describe("xmlTag", () => {
  it("reads a tag and strips CDATA", () => {
    expect(xmlTag("<item><title><![CDATA[Acme: Engineer]]></title></item>", "title")).toBe("Acme: Engineer");
  });

  it("reads a tag that has attributes", () => {
    expect(xmlTag('<guid isPermaLink="false">abc</guid>', "guid")).toBe("abc");
  });

  it("returns an empty string when the tag is missing", () => {
    expect(xmlTag("<item></item>", "region")).toBe("");
  });

  it("matches across line breaks", () => {
    expect(xmlTag("<description>line one\nline two</description>", "description")).toBe("line one\nline two");
  });
});

describe("eachSlug", () => {
  const job = (slug: string) => ({ title: "t", company: slug, location: "", url: `https://x/${slug}`, source: "s" });

  it("collects jobs from every slug", async () => {
    const r = await eachSlug(["a", "b"], async (s) => [job(s)]);
    expect(r.jobs.map((j) => j.company)).toEqual(["a", "b"]);
    expect(r.errors).toEqual([]);
  });

  it("one dead slug does not hide the others, and its error names the slug", async () => {
    const r = await eachSlug(["good", "dead", "also-good"], async (s) => {
      if (s === "dead") throw new Error("https://x/dead -> 404");
      return [job(s)];
    });
    expect(r.jobs.map((j) => j.company)).toEqual(["good", "also-good"]);
    expect(r.errors).toEqual(["dead: https://x/dead -> 404"]);
  });

  it("handles an empty slug list", async () => {
    expect(await eachSlug([], async () => [])).toEqual({ jobs: [], errors: [] });
  });
});

describe("feed", () => {
  it("returns the jobs on success", async () => {
    const r = await feed(async () => [{ title: "t", company: "c", location: "", url: "u", source: "s" }]);
    expect(r.jobs).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  it("turns a thrown error into an error entry instead of throwing", async () => {
    const r = await feed(async () => {
      throw new Error("boom");
    });
    expect(r).toEqual({ jobs: [], errors: ["boom"] });
  });
});

describe("getJson / getText", () => {
  it("returns parsed json and sends a user agent", async () => {
    const { calls } = stubFetch({ "api.example.com": { ok: true } });
    expect(await getJson("https://api.example.com/x")).toEqual({ ok: true });
    expect((calls[0]!.init!.headers as Record<string, string>)["user-agent"]).toMatch(/jobagent/);
  });

  it("returns text", async () => {
    stubFetch({ "feed.example.com": textResponse("<rss/>") });
    expect(await getText("https://feed.example.com/rss")).toBe("<rss/>");
  });

  it("throws with the status code and url on a non-2xx response", async () => {
    stubFetch({ "api.example.com": textResponse("nope", 503) });
    await expect(getJson("https://api.example.com/x")).rejects.toThrow("api.example.com/x -> 503");
  });
});
