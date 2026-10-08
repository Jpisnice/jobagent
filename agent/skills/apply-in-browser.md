---
description: Use when the candidate wants to apply to a job, after or while asking them to approve it with approve_application.
---

# Applying in the browser

A local browser-use agent drives the candidate's own Chrome window. You give it one complete task and it does the clicking, typing and uploading. You never control the browser step by step.

1. Call `approve_application` with the job and the draft. Do nothing in the browser until it is approved.
2. Build ONE explicit task for `browser_task`: the job URL, then one `Field label: value` line per field (from `get_profile` and the approved draft), and the answer to any likely screening question. For dropdowns and Yes/No or multiple-choice questions, write the value as the option would appear in the list: a full country name, `Yes`/`No`, years of experience as a number. Attach the resume by passing its name from `data/` in `files` (for example `resume.pdf`) and say which field it belongs to. Do not ask it to submit.
3. `browser_task` stops before the final Submit button and reports what it filled and what it could not. Check that against the profile; fix gaps by calling `browser_task` again on the current page.
4. **Human handoff:** if it returns `needs_human` (login, account creation, CAPTCHA, verification code), call `ask_question` telling the candidate exactly what to do in the open Chrome window (for example "Sign in to Greenhouse, then reply done"). After they reply, call `browser_task` with a task that continues on the current page. Never try to get past a login or CAPTCHA yourself.
5. When the form is complete, call `browser_submit`. It asks the candidate for approval every time and is the only way to press Submit.
6. Then `record_job` with status `applied`, or `failed` with the reason. Stop after two failed attempts at the same step; do not loop.
7. If a browser tool says the service is not running, tell the candidate to run `npm run browser` and stop.
8. Prefer the company's own ATS page over LinkedIn/Indeed.
