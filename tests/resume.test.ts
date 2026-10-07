import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readResume } from "../agent/lib/resume";
import { makeDocx, makePdf, sampleResumeLines, useProfile } from "./fixtures";

let env: ReturnType<typeof useProfile>;
beforeEach(() => {
  env = useProfile(null);
});
afterEach(() => env.cleanup());

const put = (name: string, content: string | Buffer) => writeFileSync(join(env.dataDir, name), content);

describe("readResume: formats", () => {
  it("reads a DOCX, keeping one line per paragraph", async () => {
    put("resume.docx", await makeDocx(sampleResumeLines));
    const r = await readResume("resume.docx");
    expect(r).toMatchObject({ file: "resume.docx", kind: "docx", truncated: false });
    expect(r.text).toContain("TEST CANDIDATE");
    expect(r.text.split("\n")).toContain("Go, Python, PostgreSQL, gRPC, Kafka");
    expect(r.warning).toBeUndefined();
  });

  it("reads a PDF", async () => {
    put("resume.pdf", makePdf(sampleResumeLines));
    const r = await readResume("resume.pdf");
    expect(r.kind).toBe("pdf");
    expect(r.text).toContain("Backend Engineer, Initech");
    expect(r.text).toContain("test.candidate@example.com");
  });

  it("reads TXT and Markdown", async () => {
    put("resume.txt", sampleResumeLines.join("\n"));
    put("resume.md", "# Test Candidate\n" + sampleResumeLines.join("\n"));
    expect((await readResume("resume.txt")).kind).toBe("text");
    expect((await readResume("resume.md")).text).toContain("# Test Candidate");
  });

  it("handles upper-case extensions", async () => {
    put("RESUME.PDF", makePdf(sampleResumeLines));
    expect((await readResume("RESUME.PDF")).kind).toBe("pdf");
  });

  it("escapes in a DOCX are read back as the original characters", async () => {
    put("r.docx", await makeDocx(["R&D Engineer <Acme> - " + "x".repeat(300)]));
    expect((await readResume("r.docx")).text).toContain("R&D Engineer <Acme>");
  });

  it("tidies line endings and blank lines", async () => {
    put("r.txt", "A\r\n\r\n\r\n\r\nB   \r\n" + "x".repeat(300));
    const r = await readResume("r.txt");
    expect(r.text.startsWith("A\n\nB\n")).toBe(true);
    expect(r.text).not.toContain("\r");
  });
});

describe("readResume: limits and warnings", () => {
  it("truncates a very long resume and says so, reporting the full length", async () => {
    put("long.txt", "word ".repeat(10_000));
    const r = await readResume("long.txt");
    expect(r.truncated).toBe(true);
    expect(r.text).toHaveLength(20_000);
    expect(r.chars).toBeGreaterThan(20_000);
  });

  it("warns when almost no text was found, as for a scanned resume", async () => {
    put("scan.pdf", makePdf(["."]));
    const r = await readResume("scan.pdf");
    expect(r.warning).toMatch(/paste/i);
  });

  it("rejects a file over 10 MB", async () => {
    put("huge.txt", Buffer.alloc(10 * 1024 * 1024 + 1, "a"));
    await expect(readResume("huge.txt")).rejects.toThrow(/10 MB/);
  });
});

describe("readResume: errors the model can act on", () => {
  it("says what to do when the file is not in data/", async () => {
    await expect(readResume("nope.pdf")).rejects.toThrow(/No file named nope\.pdf.*copy their resume/s);
  });

  it("rejects an empty file", async () => {
    put("empty.pdf", "");
    await expect(readResume("empty.pdf")).rejects.toThrow(/empty/);
  });

  it.each(["resume.doc", "resume.rtf", "resume.pages", "resume"])("rejects the unsupported type %s", async (name) => {
    put(name, "some text that is long enough to count as a file");
    await expect(readResume(name)).rejects.toThrow(/Unsupported file type.*PDF, DOCX or TXT/);
  });

  it("a corrupt DOCX fails instead of returning nonsense", async () => {
    put("bad.docx", "this is not a zip file");
    await expect(readResume("bad.docx")).rejects.toThrow();
  });
});

describe("readResume: only files inside data/", () => {
  it.each(["../secret.txt", "..\\secret.txt", "sub/../../secret.txt"])("blocks %s", async (name) => {
    writeFileSync(join(env.dir, "secret.txt"), "top secret ".repeat(40));
    await expect(readResume(name)).rejects.toThrow(/inside the data\/ folder/);
  });

  it("blocks an absolute path outside data/", async () => {
    const outside = join(env.dir, "outside.txt");
    writeFileSync(outside, "x".repeat(300));
    await expect(readResume(outside)).rejects.toThrow(/inside the data\/ folder/);
  });

  it("blocks the data folder itself", async () => {
    await expect(readResume(".")).rejects.toThrow(/inside the data\/ folder/);
  });

  it("allows a file in a subfolder of data/", async () => {
    mkdirSync(join(env.dataDir, "cv"));
    writeFileSync(join(env.dataDir, "cv", "me.txt"), "x".repeat(300));
    expect((await readResume("cv/me.txt")).kind).toBe("text");
  });

  it("does not follow a link out of data/", async () => {
    // A directory junction (Windows) or symlink (elsewhere); junctions need no special rights.
    const outsideDir = join(env.dir, "outside");
    mkdirSync(outsideDir);
    writeFileSync(join(outsideDir, "secret.txt"), "top secret ".repeat(40));
    symlinkSync(outsideDir, join(env.dataDir, "escape"), "junction");
    await expect(readResume("escape/secret.txt")).rejects.toThrow(/inside the data\/ folder/);
  });
});
