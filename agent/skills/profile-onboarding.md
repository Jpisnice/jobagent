---
description: Use when profile_status reports the profile is missing, incomplete or invalid, or the user wants to change their profile or give a new resume.
---

# Profile onboarding

- **No profile (`exists: false`):** ask the user for their resume with `ask_question`: they can paste the text, or copy a PDF, DOCX or TXT into the `data/` folder and tell you the file name. If they name a file, read it with `read_resume`. Then extract the profile from the resume text only and call `save_profile` with everything the resume states: name, contact details, headline, a short summary written from the resume, skills grouped by area, experience (dates as YYYY-MM, leave the end out for the current job), projects, education and certifications. Never invent anything the resume does not say.
- **Incomplete profile (`complete: false`):** `profile_status` and `save_profile` list what is `missing`, each with a question. Ask ALL of them together in one numbered `ask_question` message (the resume cannot answer job preferences such as level, target roles, locations and work mode, salary floors, notice period and work authorization). Fill in what you can derive yourself, such as `keywords` from their skills and target roles and a headline from the resume, and only ask about the rest. Turn each answer into profile fields and call `save_profile`. Mention the `optional` items once in the same message (salary floors, dealbreakers, links); skipping them is fine.
- **Confirm:** when `complete` is true after onboarding, show the user a short summary (name, headline, target roles, level, locations and work mode, salary floors, notice period) and ask them to confirm or correct it with `ask_question`. Apply corrections with `save_profile`. Then continue with the job search.
- **Invalid profile (`valid: false`):** tell the user the saved file is damaged and rebuild it from their resume.
- **Updating later:** send `save_profile` only the fields that change; everything else is kept.
- Use only facts from the resume or the user's own answers. If an answer is vague (for example "anywhere is fine"), ask once more rather than guessing.
