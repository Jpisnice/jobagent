import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CHARS = 20_000;
const dataDir = () => resolve(process.env.DATA_DIR ?? "data");

export interface ResumeText {
  file: string;
  kind: "pdf" | "docx" | "text";
  text: string;
  chars: number;
  truncated: boolean;
  warning?: string;
}

// Reads the text of a resume that the user put in the project's data/ folder.
export async function readResume(name: string): Promise<ResumeText> {
  const dir = dataDir();
  const full = resolve(dir, name);
  if (relative(dir, full).startsWith("..") || relative(dir, full) === "") {
    throw new Error("The resume must be a file inside the data/ folder. Ask the user to copy it there.");
  }
  let size: number;
  try {
    size = (await stat(full)).size;
    // A symlink inside data/ must not lead out of it.
    const realRel = relative(await realpath(dir), await realpath(full));
    if (realRel.startsWith("..") || isAbsolute(realRel)) {
      throw new Error("The resume must be a file inside the data/ folder. Ask the user to copy it there.");
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("inside the data/ folder")) throw e;
    throw new Error(`No file named ${name} in data/. Ask the user to copy their resume there and tell you the exact name.`);
  }
  if (size === 0) throw new Error(`${name} is empty.`);
  if (size > MAX_BYTES) throw new Error(`${name} is larger than 10 MB, which is too big for a resume.`);

  const ext = extname(full).toLowerCase();
  const buf = await readFile(full);
  let kind: ResumeText["kind"];
  let text: string;

  if (ext === ".pdf") {
    kind = "pdf";
    const { extractText } = await import("unpdf");
    const out = await extractText(new Uint8Array(buf), { mergePages: true });
    text = Array.isArray(out.text) ? out.text.join("\n") : out.text;
  } else if (ext === ".docx") {
    kind = "docx";
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (ext === ".txt" || ext === ".md") {
    kind = "text";
    text = buf.toString("utf8");
  } else {
    throw new Error(`Unsupported file type ${ext || "(none)"}. Use a PDF, DOCX or TXT file, or ask the user to paste the text.`);
  }

  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = text.length > MAX_CHARS;
  const result: ResumeText = { file: name, kind, text: text.slice(0, MAX_CHARS), chars: text.length, truncated };
  if (text.length < 200) {
    result.warning = "Very little text was found. The file may be a scan or image; ask the user to paste the resume text instead.";
  }
  return result;
}
