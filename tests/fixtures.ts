import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { vi } from "vitest";

// A complete, valid profile for a made-up person. Values are distinctive so tests can spot leaks.
export const sampleProfile = (over: Record<string, unknown> = {}) => ({
  name: "Test Candidate",
  headline: "Backend Engineer",
  contact: { email: "test.candidate@example.com", phone: "+1 555 010 0199", location: "Lisbon, Portugal", github: "https://github.com/tc" },
  summary: "Builds APIs and data pipelines.",
  strengths: ["Ships small, tested services"],
  skills: { languages: ["Go", "Python"], backend: ["PostgreSQL", "gRPC"] },
  experience: [
    { title: "Backend Engineer", company: "Initech", start: "2023-02", end: null, current: true, highlights: ["Cut p99 latency by 40%"] },
    { title: "Junior Developer", company: "Hooli", start: "2021-06", end: "2023-01", current: false, highlights: [] },
  ],
  projects: [{ name: "pipeline-kit", tech: ["Go", "Kafka"], highlights: ["Open-source ETL helper"] }],
  education: [{ degree: "BSc Computer Science", institution: "Uni of Example", start: 2017, end: 2021 }],
  certifications: [],
  preferences: {
    seniority: "mid",
    targetRoles: ["Backend Engineer", "Platform Engineer"],
    keywords: ["Go", "PostgreSQL", "Kafka"],
    locations: {
      Portugal: { workMode: ["hybrid", "remote"], preferred: "hybrid", minSalaryINR: 2_000_000 },
      EU: { regions: ["Germany", "Spain"], workMode: ["remote"], required: true },
    },
    remoteOk: true,
    dealbreakers: ["gambling"],
    minScore: 75,
  },
  answers: { noticePeriod: "60 days", workAuthorization: "EU citizen" },
  ...over,
});

// Points the profile and data folder at a fresh temp directory for one test.
// Pass null for "no profile yet".
export function useProfile(profile: unknown | null = sampleProfile()) {
  const dir = mkdtempSync(join(tmpdir(), "jobagent-profile-"));
  const profilePath = join(dir, "profile.json");
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  if (profile !== null) writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  vi.stubEnv("PROFILE_PATH", profilePath);
  vi.stubEnv("DATA_DIR", dataDir);
  vi.stubEnv("ALERT_TO_EMAIL", "");
  delete process.env.ALERT_TO_EMAIL;
  return { dir, profilePath, dataDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const sampleResumeLines = [
  "TEST CANDIDATE",
  "Backend Engineer",
  "test.candidate@example.com | +1 555 010 0199 | Lisbon, Portugal",
  "EXPERIENCE",
  "Backend Engineer, Initech, Feb 2023 - Present",
  "Cut p99 latency by 40% on the orders API",
  "Junior Developer, Hooli, Jun 2021 - Jan 2023",
  "SKILLS",
  "Go, Python, PostgreSQL, gRPC, Kafka",
  "EDUCATION",
  "BSc Computer Science, Uni of Example, 2017 - 2021",
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A real, minimal .docx: a zip with the three parts Word needs, one paragraph per line.
export async function makeDocx(lines: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const paras = lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

// A real, minimal one-page text PDF.
export function makePdf(lines: string[]): Buffer {
  const pdfEsc = (s: string) => s.replace(/[\\()]/g, "\\$&");
  const content = "BT /F1 11 Tf 50 750 Td 14 TL " + lines.map((l) => `(${pdfEsc(l)}) Tj T*`).join(" ") + " ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
