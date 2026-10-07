import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright-core";

// Drives a real Chrome window over the DevTools protocol. The window uses its own
// profile folder, so logins and cookies persist between runs and your everyday
// Chrome profile is never touched. Tools run on this machine, so this is local-only.
const PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9222);
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const PROFILE = resolve(process.env.CHROME_PROFILE_DIR ?? ".chrome-profile");

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${ENDPOINT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Opens the Chrome window if it is not already running with the debug port.
export async function ensureChrome(): Promise<void> {
  if (await isUp()) return;
  const exe = CHROME_PATHS.find((p): p is string => !!p && existsSync(p));
  if (!exe) throw new Error("Chrome not found. Set CHROME_PATH to chrome.exe in .env.");
  spawn(
    exe,
    [
      `--remote-debugging-port=${PORT}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  ).unref();
  for (let i = 0; i < 30; i++) {
    if (await isUp()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Chrome did not open a debug port on ${PORT}. Close other Chrome windows that use ${PROFILE} and retry.`);
}

// Connects to the open Chrome, runs fn on the active tab, then disconnects (the window stays open).
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  await ensureChrome();
  const browser = await chromium.connectOverCDP(ENDPOINT);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const pages = context.pages();
    const page = pages[pages.length - 1] ?? (await context.newPage());
    await page.bringToFront();
    return await fn(page);
  } finally {
    await browser.close();
  }
}

export const refSelector = (ref: string) => `[data-eve-ref="${ref.replace(/[^a-z0-9]/gi, "")}"]`;

// Lists visible interactive elements with short refs (e1, e2, ...) plus the start of the page text.
const SNAPSHOT_JS = `(() => {
  document.querySelectorAll('[data-eve-ref]').forEach((e) => e.removeAttribute('data-eve-ref'));
  const sel = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=combobox],[contenteditable=true]';
  const elements = [];
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') continue;
    if (el.type === 'hidden') continue;
    const ref = 'e' + (++n);
    el.setAttribute('data-eve-ref', ref);
    const label = ((el.getAttribute('aria-label')) || (el.labels && el.labels[0] && el.labels[0].innerText) || el.placeholder || el.innerText || el.value || el.getAttribute('title') || el.name || '')
      .trim().replace(/\\s+/g, ' ').slice(0, 80);
    const item = { ref, tag: el.tagName.toLowerCase(), label };
    if (el.type) item.type = el.type;
    if (el.type !== 'password' && el.value && el.tagName !== 'BUTTON') item.value = String(el.value).slice(0, 60);
    if (el.required) item.required = true;
    if (el.checked) item.checked = true;
    elements.push(item);
    if (n >= 120) break;
  }
  return {
    url: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 1500),
    elements,
  };
})()`;

export async function snapshot(page: Page) {
  return page.evaluate(SNAPSHOT_JS) as Promise<{
    url: string;
    title: string;
    text: string;
    elements: Array<{ ref: string; tag: string; label: string; type?: string; value?: string; required?: boolean; checked?: boolean }>;
  }>;
}

// Describe an element by ref so tools can decide whether an action is a final submit.
export async function describe(page: Page, ref: string) {
  return page.locator(refSelector(ref)).first().evaluate((el: any) => ({
    tag: String(el.tagName).toLowerCase(),
    type: String(el.type ?? ""),
    label: String(el.getAttribute("aria-label") ?? el.innerText ?? el.value ?? "").trim().slice(0, 80),
  }));
}

// A button that sends the application for real; only chrome_submit (with approval) may click it.
export const looksLikeFinalSubmit = (d: { tag: string; type: string; label: string }) =>
  /^(submit|send)\b|submit application|send application|complete application|finish application|confirm and submit/i.test(d.label) ||
  (d.type === "submit" && /submit|send|apply|finish|complete/i.test(d.label));
