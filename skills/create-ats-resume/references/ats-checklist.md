# ATS Checklist

Source: CEAS — *What Is an ATS? And How to Make Your Resume Stand Out (to Robots and Recruiters)*, plus general ATS best practices.

The single most important fact: **ATS doesn't reject resumes; it stores them and makes them searchable.** If the resume doesn't match the keywords the recruiter searched for, it just doesn't appear. Optimize for **keyword matching**, not "passing".

## Audience

ATS is used by: large companies, staffing agencies, public sector, mid-sized businesses, rapid-growth SMBs, non-profits. Indeed also exposes ATS-like search on top of its own database.

## Critical render rules

These break ATS parsing when violated:

| Rule | Why | Fix |
|---|---|---|
| **No tables** | Most parsers can't correlate cells | Use single column, flat structure |
| **No images, icons, charts, graphics** | Parsers don't read pixels, and OCR is unreliable | Use plain text |
| **No text boxes / shapes** | Same as above | Inline content only |
| **No content in headers or footers** | Many parsers skip them entirely | Put everything in the body |
| **No two-column layouts** | Some parsers read column 2 as a continuation; some flatten them in the wrong order | Single column, top-to-bottom |
| **No SVG / image-based contact icons** | Icons may be ignored; the text label should be its own line | Plain text contact line |
| **No exotic fonts** | Rare fonts may render as boxes; some ATS use font fallback that mangles names | Calibri / Arial / Helvetica / Times New Roman / Georgia |

## Standard structure

Use these section headings, in this order. ATS expects them. Creative headings (e.g., "Where I've Been", "Toolbelt") cost you matches.

1. Contact line (or a header above the body)
2. Summary / Profile
3. Skills
4. Professional Experience / Work Experience
5. Education
6. Certifications (optional)
7. Languages (optional)

## Content rules

### Keywords

- **Mirror the job description's language exactly.** If the posting says "customer service," use "customer service" — not "relationship building."
- **Use the exact job title** in the summary where appropriate.
- **Repeat important keywords** across summary + skills + bullets (an ATS ranks by frequency + matching).
- **Capture acronyms both ways**: "API (Application Programming Interface)", "REST API", "SEO (Search Engine Optimization)".

### Action verbs

Lead bullets with strong action verbs: *managed, developed, led, architected, designed, deployed, integrated, optimized, scaled, automated, delivered, launched*.

Avoid: *responsible for, helped with, worked on, involved in*.

### Skill section

- **Mandatory.** Sparse resumes get filtered out by keyword search.
- Use the user's *real* skills only.
- Group by category (Languages, Frameworks, Databases, Tools, Cloud) for readability; ATS parses both grouped and flat.

### Experience bullets

- One bullet per accomplishment / responsibility — don't merge multiple wins into one sentence.
- Quantify wherever possible (10× growth, 100+ clients, 5–6 facilities, 3-hour sorting window).
- Mention tools and technologies by name (React, Laravel, MySQL, AWS).
- Tailor to JD: lead with the bullets that match the JD's requirements; reorder so the strongest match opens each role.

### Date format

Use one consistent format throughout. `Mon YYYY – Mon YYYY` is the most parser-friendly.

### Honesty

The CEAS article (and common sense) says: **do not fabricate.** Mirror language but don't claim skills you don't have. Transferable skills are fine — exaggerating is not.

## File format

- **PDF** is widely accepted and looks consistent across devices.
- **DOCX** is parsed more reliably by older corporate ATS (Taleo, Workday, SuccessFactors tend to prefer it).
- **Plain text** is sometimes required as a fallback.
- When given a choice, **DOCX > PDF > text** for pure ATS reliability.

When none is specified, submit both DOCX and PDF.

## Common myths (so you don't spend time on the wrong things)

- **"ATS rejects me."** No. It just won't surface your resume if the keywords don't match.
- **"I need a super-plain resume."** Not necessarily — you can keep clean professional formatting with bullets, bold, and standard fonts. Avoid fancy design, but you don't need to strip it bare.
- **"All ATS work the same."** They don't. The above rules are the common baseline.
- **"A human won't see my resume."** Humans still review, but only the resumes that surface in search. The job is to surface.

## Quick self-check before submitting

- [ ] Single column, no tables, no icons, no images, no text boxes
- [ ] Headers/footers are empty (or used only for visual borders, not content)
- [ ] Section headings are standard (Summary, Skills, Professional Experience, Education)
- [ ] Font is Calibri / Arial / Helvetica / Times New Roman / Georgia
- [ ] Skills section is present and contains the JD's key terms
- [ ] Job title from the JD appears in the summary
- [ ] Action verbs lead every bullet
- [ ] Dates are in one consistent format
- [ ] Filename is plain ASCII (e.g. `resume-acme-frontend.pdf`)

If any box is unchecked, fix and rerun.
