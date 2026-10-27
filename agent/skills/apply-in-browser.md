---
description: Use when the candidate wants to apply to a job, including when they paste a job or application link, before calling approve_application.
---

# Applying in the browser

A local browser-use agent drives the candidate's own Chrome window. You give it one complete task and it does the clicking, typing and uploading. You never control the browser step by step.

1. **Read the form first.** Call `inspect_application` with the link. It opens the form without filling anything and returns every field, the candidate profile and the files in `data/` that can be uploaded. If it returns `needs_human`, handle it as in step 7, then call it again.
2. **Work out the answers.** For each field, take the answer from the profile: contact details, links, current title and company, years of experience (count from the experience dates), education, skills, and the standard `answers` (notice period, work authorization, and anything saved from earlier applications). Use the profile's facts only; never invent experience, skills or credentials.
3. **Ask for the rest, once.** Put every required field you cannot answer, and every question where a guess could hurt the candidate (expected salary, earliest start date, visa sponsorship, relocation, willingness to work on-site, "why this company", demographic, veteran or disability questions, which they may decline), into ONE numbered `ask_question`. Give the options as the form lists them. Do not ask about anything the profile already answers. If nothing is missing, skip this step.
4. **Remember recurring answers.** Save answers likely to come up again (salary expectation, start date, sponsorship, relocation, demographic choices) with `save_profile` `answers`, using short camelCase keys, so the next application does not ask again.
5. **Approve.** Write any cover letter or free-text answers the form needs from the profile facts (as `draft_application` would), then call `approve_application` with the job title, company, link and a draft listing every answer that will be entered. Do nothing in the browser until it is approved.
6. **Fill.** Build ONE explicit task for `browser_task`: the form link, then one `Field label: value` line per field, using the labels as `inspect_application` reported them. For dropdowns and Yes/No or multiple-choice questions, write the value exactly as the option reads. Attach the resume by passing its file name from `files` in `files` and say which field it belongs to. Do not ask it to submit.
7. **Check.** `browser_task` stops before the final Submit button and reports what it filled and what it could not. Check that against your answers; fix gaps by calling `browser_task` again on the current page. If the form had `moreSteps`, the next page may have new questions: answer them from the profile, ask the user about the rest as in step 3, then continue with another `browser_task`.
8. **Human handoff:** if a browser tool returns `needs_human` (login, account creation, CAPTCHA, verification code), call `ask_question` telling the candidate exactly what to do in the open Chrome window (for example "Sign in to Greenhouse, then reply done"). After they reply, call the tool again to continue on the current page. Never try to get past a login or CAPTCHA yourself.
9. **Submit.** When the form is complete, call `browser_submit`. It asks the candidate for approval every time and is the only way to press Submit.
10. Then `record_job` with status `applied`, or `failed` with the reason. Stop after two failed attempts at the same step; do not loop.
11. If a browser tool says the service is not running, tell the candidate to run `npm run browser` and stop.
12. Prefer the company's own ATS page over LinkedIn/Indeed.
