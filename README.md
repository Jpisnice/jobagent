# jobagent

An [eve](https://eve.dev) agent that finds jobs matching your profile, checks each one for fit, drafts your application, asks you before anything is sent, and emails you the results. It fills in application forms in your own Chrome window, so you can sign in or solve a CAPTCHA yourself and let the agent carry on.

## What it does

1. **Onboarding.** If there is no profile yet, it asks for your resume (pasted, or a PDF/DOCX/TXT in `data/`), builds your profile from it, and asks about what a resume can't tell it: level, target roles, locations and work mode, salary floors, notice period, work authorization.
2. **Search.** A daily schedule searches 13 public sources (below), drops senior and management titles, and skips jobs it has already seen.
3. **Fit check.** A small `matcher` subagent gives each job a short verdict against your profile. Only jobs it marks relevant go any further.
4. **Alert.** You get one email digest of the good matches, each with a drafted application.
5. **Apply.** In a chat, you approve a job and the agent fills in the form in your Chrome window. It stops before the final Submit button, and pressing it needs a second approval from you.

The agent never submits without your approval, never types passwords, and never tries to get past a login or CAPTCHA. When it hits one it stops and asks you to deal with it in the open Chrome window.

## How it fits together

```
 eve agent (TypeScript, Gemini)
   |-- tools: profile, job search, alerts, approvals
   |-- matcher subagent (cheap, tightly capped fit checks)
   |-- schedule: daily search + email digest
   |
   |  HTTP, 127.0.0.1 only, token protected
   v
 browser service (Python, browser-use + Gemini)      npm run browser
   |  Chrome DevTools protocol
   v
 your Chrome window (its own profile, so logins persist)
```

Everything runs on your machine. The only things that leave it are Gemini API calls, job-board requests, and the emails you send through Resend.

**Job sources** (no keys needed): RemoteOK, Remotive, Himalayas, Arbeitnow, Jobicy, We Work Remotely, Hacker News "Who is hiring", plus Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee for the companies listed in `data/companies.json`.

## Requirements

- Node 24 and npm
- [uv](https://docs.astral.sh/uv/) (it fetches Python 3.12 for the browser service)
- Google Chrome
- A [Gemini API key](https://aistudio.google.com/apikey) on a project with billing set up
- A [Resend](https://resend.com) API key for email alerts

The browser script (`npm run browser`) is PowerShell, so applying from the browser is Windows-only for now. Everything else is cross-platform.

## Setup

```bash
npm install
cp .env.example .env        # then fill in the values below
```

Set at least these in `.env`:

| Variable | What it is |
| --- | --- |
| `GEMINI_API_KEY` | Your Gemini key. Used by the agent and by the browser service. |
| `RESEND_API_KEY`, `ALERT_FROM_EMAIL` | Sending alerts. With `onboarding@resend.dev` as the sender, Resend only delivers to the address you signed up with; verify a domain to send elsewhere. |
| `BROWSER_SERVICE_TOKEN` | Any long random string. Stops other pages on your machine from calling the browser service. |

Optional settings (defaults in brackets):

| Variable | What it does |
| --- | --- |
| `ALERT_TO_EMAIL` | Where alerts go [the email on your profile] |
| `GEMINI_MODEL` | Main agent model [`gemini-3-flash-preview`] |
| `GEMINI_MATCHER_MODEL` | Fit-check model [`gemini-3.1-flash-lite`] |
| `BROWSER_USE_MODEL`, `BROWSER_USE_FALLBACK_MODEL` | Models the browser service uses [`gemini-3-flash-preview`, `gemini-2.5-flash`] |
| `BROWSER_SERVICE_URL`, `BROWSER_CDP_URL` | Service and Chrome addresses [`http://127.0.0.1:8765`, `http://127.0.0.1:9222`] |
| `CHROME_PATH`, `CHROME_DEBUG_PORT`, `CHROME_PROFILE_DIR` | Chrome location, debug port, and profile folder [auto-detected, `9222`, `.chrome-profile`] |
| `PROFILE_PATH`, `JOB_STORE_PATH`, `DATA_DIR` | Where the profile, seen-jobs list and resume folder live [`data/profile.json`, `.data/jobs.json`, `data/`] |

The Gemini model names are `-preview` releases, which Google can change or retire. If one stops working, set the matching variable above.

## Using it

**First run: build your profile.** Start the agent and say hello:

```bash
npm run dev
```

It will notice there is no profile and walk you through onboarding. To give it your resume as a file, copy it into `data/` (for example `data/resume.pdf`) and tell it the file name. The profile is saved to `data/profile.json`, which is git-ignored. `data/profile.example.json` shows the shape.

**Daily search.** The schedule `agent/schedules/job-search.ts` runs at 08:00 UTC. It checks the profile, searches, runs the fit check, and emails you a digest. `eve dev` never fires schedules, so to try one now:

```bash
curl -X POST http://localhost:2000/eve/v1/dev/schedules/job-search
```

**Applying.** In a chat, tell the agent which job to apply to. Before it can open a form, start the browser side in a second terminal and leave it running:

```bash
npm run browser
```

This opens Chrome with its own profile and starts the browser service. Sign in to the job sites you use in that window once; it remembers. The agent then:

1. asks you to approve the application (`approve_application`),
2. fills in the form, uploading your resume from `data/`,
3. stops on the review step and reports what it filled and what it couldn't,
4. asks you to approve the final Submit (`browser_submit`).

If it hits a login, account creation, CAPTCHA or verification code, it stops and asks you to handle it in the Chrome window, then continues from the same page when you say you are done. Applying never happens from the schedule, because a schedule can't ask you anything.

## Safety rules built in

- Submitting needs your approval every time, enforced in code: the service blocks clicks on final-submit buttons unless the approved `browser_submit` tool started the run.
- Passwords are never typed by the agent, and CAPTCHAs are never attempted.
- Resume uploads only work for files inside `data/`; links that lead outside it are refused.
- The browser service listens on `127.0.0.1` only and needs the token.
- The agent uses only facts from your resume and your own answers, and is told never to invent experience.
- Token caps limit each session, and the fit-check subagent has a very small budget, so a runaway loop can't run up a large bill.

## Project layout

```
agent/
  instructions.md        the agent's behaviour: onboarding, workflow, rules
  agent.ts               model, context window, compaction, usage caps
  tools/                 profile_status, read_resume, save_profile, fetch_jobs,
                         send_alert, record_job, draft_application,
                         approve_application, browser_task, browser_submit, ...
  subagents/matcher/     the fit checker
  schedules/             daily job search
  lib/                   profile, resume reader, job store, browser client,
                         sources/ (one module per job source)
browser-service/         Python service wrapping browser-use (server.py, tests/)
scripts/browser.ps1      starts Chrome and the browser service
data/                    companies.json, profile.example.json, your profile and resume
tests/                   Vitest tests for the agent
```

## Tests

```bash
npm test               # agent tests (Vitest)
npm run test:browser   # browser service tests (pytest)
npm run test:all       # both
npm run typecheck      # tsc, which also covers the tests
```

The tests use fake data and never call Gemini, open Chrome, or touch your real profile. They don't cover real model behaviour or real job sites, so try a real run after changing the instructions or the browser service.

## Limitations

- **Local only.** The profile and seen-jobs list are plain files, and the browser runs on your machine. A Vercel deployment would need those moved to a database or blob store, and the browser part would not work there.
- **Forms vary.** Standard forms and typeahead fields work in tests, but sites with unusual dropdowns, date pickers or multi-step wizards (Workday, for example) may need your help.
- **LinkedIn and Indeed** prohibit automated access. The agent doesn't scrape them by default; if you point it there, keep the volume low and expect to risk your account.
- **Cost.** Every application runs a browser-use loop on Gemini (typically a few to a dozen steps for a simple form, more for long ones). Set a spending cap in Google AI Studio.
- **Channel auth.** `agent/channels/eve.ts` still uses eve's placeholder auth, which blocks browser requests in production. Replace it before you deploy.

## Learn more

- [eve documentation](https://eve.dev/docs) and the [eve repository](https://github.com/vercel/eve)
- [browser-use](https://github.com/browser-use/browser-use), which drives the browser
- To deploy the agent part: `eve deploy` (see the [deployment guide](https://eve.dev/docs/guides/deployment/vercel) and the limitations above)
