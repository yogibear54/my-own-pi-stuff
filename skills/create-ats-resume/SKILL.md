---
name: create-ats-resume
description: "Generates per-job-tailored ATS-friendly resumes and cover letters. Produces single-column HTML, PDF (via Chrome CDP), and DOCX (via python-docx). Reads a user-maintained content database for experiences/skills; extracts keywords from a target job description; outputs are named by {date}-{company}-{role}. Use when the user pastes a job description (or URL) and wants a tailored application package. Do NOT use for the dark-sidebar visual resumes (those are the existing chrisli-resume*.html files)."
license: MIT
---

# Create ATS Resume

A skill for producing **Applicant Tracking System (ATS)**-friendly application packages, tailored per job.

## When to use

Use when the user:
- Pastes a job description (or a URL to one) and asks for a tailored resume, cover letter, or both.
- Says things like "tailor this for [role]", "ATS resume for [company]", "make a one-pager for [job]".

Do **not** use for:
- The dark-sidebar visual resumes (`chrisli-resume*.html` / `.pdf`) — those are for human readers, not parsers.

## Outputs (one job application = one folder, three artifacts)

For each application, write to the user's resume folder and produce:

```
<resume-folder>/ats/<YYYY-MM-DD>-<company>-<role>/
├── resume.html       # single-column ATS-safe HTML
├── resume.pdf        # rendered via CDP
├── resume.docx       # rendered via python-docx
├── cover-letter.html
├── cover-letter.pdf
└── cover-letter.docx
```

`<resume-folder>` defaults to `~/Downloads/resume`. The user can override.

## Inputs the user provides

| Input | What it is | Required |
|---|---|---|
| Job description | Pasted text or URL | ✅ |
| Target role title | Job title exactly as posted | ✅ |
| Target company | For filename + cover-letter greeting | ✅ |
| Content database | User's master experiences/skills file | ✅ (uses default) |
| Resume folder | Where to write outputs and read the content DB from | optional (default: current working directory) |

If a URL is provided, fetch it via the `web-browser` skill first.

### Overriding the resume folder

The default is the **current working directory** (whatever `pwd` returns at the time you invoke the skill). To use a different folder, pass it on the command line:

```
/skill:create-ats-resume --resume-folder /path/to/folder <JD>
```

Rules:
- Use an absolute path.
- The folder must already exist (the skill will create the `ats/<date>-<company>-<role>/` subfolder underneath, but not the parent).
- The content DB is read from `<resume-folder>/chrisli-content.md` (or whatever the user has named it).
- Outputs are written to `<resume-folder>/ats/<YYYY-MM-DD>-<company-slug>-<role-slug>/`.
- If `--resume-folder` is omitted, use the current working directory.

If the path contains a tilde (`~`), expand it to the home directory. Resolve symlinks. Normalize to a clean absolute path before creating the ats subfolder.

### Finding the content DB from the CWD

If the user didn't pass `--resume-folder` and the content DB isn't at `<cwd>/chrisli-content.md`, walk up parent directories (e.g., `<cwd>/..`, `<cwd>/../..`) looking for a `chrisli-content.md` at each level. Use the first match. This means the user can invoke the skill from any subdirectory of their resume folder (e.g., from inside `ats/<some-job>/`) and the content DB is still found.

If no `chrisli-content.md` is found within ~5 parent levels, fall back to `~/Downloads/resume/chrisli-content.md` (the legacy default). If that's also missing, tell the user once and ask them to either point you at the right file or run the bootstrap flow from `jobsdb-extracted.md`.

## Master content database

Default location: `<resume-folder>/chrisli-content.md`. The file holds:

- Contact info
- A **base summary variant** plus a short note on how to retune
- A categorized **skills matrix** (Advanced / Intermediate / Tools)
- **Work experience** — every role with **all** bullets in a bullets pool (so you can pick what to surface)
- **Education, Certifications, Languages**
- Optional tailoring notes per role (e.g., "when the JD emphasizes logistics, lead with picker/driver apps")

If the content DB doesn't exist yet, tell the user once and offer to bootstrap it from `jobsdb-extracted.md` (which is also in the resume folder from an earlier session).

## Workflow

1. **Resolve resume folder.**
   - If `--resume-folder` was passed, use that (expand `~`, absolutize, resolve symlinks). Verify the folder exists; if not, tell the user and ask them to create it or pick a different path.
   - Otherwise, start from the current working directory (CWD) and look for `chrisli-content.md` in the CWD, then in each parent directory up to 5 levels. Use the first match. If nothing is found, fall back to `~/Downloads/resume/chrisli-content.md` and continue the search; if still nothing, tell the user and ask them to point you at the right file.
2. **Load content DB** from the resolved folder. If missing entirely, bootstrap it from `jobsdb-extracted.md` (or ask the user).
3. **Get the JD.** If a URL was given, fetch + extract the description text.
4. **Extract keywords** from the JD:
   - Required / preferred skills
   - Job title (use verbatim)
   - Tools, technologies, methodologies mentioned
   - Repeated terms (likely important)
   - Acronyms — capture both forms
5. **Plan the resume:**
   - Choose a **summary angle** (one tight paragraph mirroring the JD's framing, naming the user honestly)
   - Build a **Skills section** that mirrors JD terminology (but only the user's real skills)
   - For each role, **select the 2–4 most relevant bullets** from the pool; **reorder** them so the strongest match leads
   - Decide which roles to surface vs condense to a one-line earlier-role entry
   - Keep titles, dates, employers exactly as in the content DB
6. **Draft the resume HTML** following the structure in `references/html-structure.md`.
7. **Draft the cover letter HTML** as a one-page, 3–4 paragraph note (see "Cover letter" below).
8. **Render** PDF + DOCX using the scripts:
   - PDF: `node <skill>/scripts/render-pdf.mjs <resume-folder>/ats/<dir>/resume.html`
   - DOCX: `python3 <skill>/scripts/render-docx.py <resume-folder>/ats/<dir>/resume.html`
   - Run them in parallel for the resume and cover-letter.
9. **Summarize** what you changed vs the base content (which bullets you surfaced, which keywords you mirrored) so the user can sanity-check.

## Cover letter (always paired)

- Header: user's contact block + date + company name + "Dear Hiring Team,"
- Paragraph 1: hook — name the role, name the company, one sentence on why this role is interesting to the user
- Paragraph 2: the strongest 1–2 experiences that **directly** match the JD's top requirements — paraphrase the resume, don't repeat it verbatim
- Paragraph 3: the user's broader differentiator (CTO/founder experience, business grounding, full-stack depth) in one sentence
- Closing: availability, contact, "Best regards," + name
- Length: ~250–350 words

## ATS-safe render rules (load `references/ats-checklist.md` for full details)

The HTML must:
- Single column, no sidebar, no two-column layouts
- **No tables, no images, no SVG icons, no text boxes**
- **No content in headers or footers** (ATS often can't read them)
- Section headings, in this order:
  1. Name (h1) + contact line
  2. Summary (p)
  3. Skills (h2) → bulleted list of skill tags
  4. Professional Experience (h2) → chronological, most recent first
  5. Education (h2)
  6. Certifications (h2, optional)
  7. Languages (h2, optional)
- Fonts: Calibri (with Arial fallback). Body 11pt, name 16–18pt, headings 12pt bold.
- Margins: ~0.75" / ~19mm.
- Filename safety: no spaces, ASCII only, slugs from `{company}-{role}` (kebab-case, no special chars).

## Render scripts

| Script | Does |
|---|---|
| `scripts/render-pdf.mjs` | CDP-based, opens the HTML in a background tab and prints to PDF (one PDF per HTML). Reuses the existing `web-browser` skill's CDP client pattern. |
| `scripts/render-docx.py` | Parses the HTML with `html.parser` and builds a DOCX with `python-docx`. Headings map to docx heading levels; `<ul>`/`<li>` map to list bullets; `<strong>` becomes bold runs. |

Both scripts accept one or more HTML file paths as args.

## References (load on demand)

- `references/ats-checklist.md` — full ATS rules, sources, and common pitfalls. Read before drafting any HTML.
- `references/html-structure.md` — the exact HTML skeleton to produce, with allowed tags and CSS defaults.

## What this skill does NOT do

- It doesn't auto-apply anywhere. Outputs are local files.
- It doesn't optimize the *existing* visual resumes. Those are intentionally different and live alongside.
- It doesn't write fictional content. If a JD requires a skill the user doesn't list in the content DB, surface the transferable skill instead and tell the user.

## Quick start (from the user's first request)

```
User: "ATS resume for Acme's senior frontend role. JD: <paste JD or URL>"
You:
  1. Read SKILL.md (this file).
  2. Read references/ats-checklist.md.
  3. Read references/html-structure.md.
  4. Resolve <resume-folder>:
     - If `--resume-folder <path>` was passed, expand `~` and use that.
     - Otherwise start from the current working directory and walk up looking for `chrisli-content.md`. Fall back to `~/Downloads/resume`.
  5. Read <resume-folder>/chrisli-content.md.
  6. Extract keywords from JD.
  7. Plan + draft resume HTML.
  8. Draft cover letter HTML.
  9. mkdir + write 2 HTML files.
 10. Run render-pdf.mjs and render-docx.py (in parallel).
 11. Summarize tailoring choices back to the user.
```
