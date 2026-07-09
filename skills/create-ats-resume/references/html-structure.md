# HTML Structure for ATS Resumes

The HTML you generate **must** conform to this structure. The renderers (`render-pdf.mjs`, `render-docx.py`) expect it.

## Output: a single, self-contained `.html` file

- Inline `<style>` only (no external CSS files, no `<link>`).
- One `<!DOCTYPE html>` document. UTF-8.
- Body content only — no `<header>`, no `<footer>` containing content (ATS often can't read those).

## Allowed tags

| Purpose | Tags |
|---|---|
| Top-level name | `<h1>` |
| Section headings | `<h2>` |
| Subheadings (e.g., role title above the company) | `<h3>` |
| Paragraphs | `<p>` |
| Inline emphasis | `<strong>`, `<b>`, `<em>`, `<i>` |
| Lists | `<ul>`, `<li>` |
| Line breaks | `<br>` only inside contact line if needed |
| Date column | A second `<span>` or right-aligned `<div>` — see layout below |

**Disallowed in ATS HTML:** `<table>`, `<img>`, `<svg>`, `<canvas>`, `<iframe>`, `<object>`, `<div>` with absolute positioning, two-column layouts, CSS frameworks, JavaScript.

## Document layout

```
<body>
  <h1 class="name">First Last</h1>
  <p class="contact">
    Phone · Email · LinkedIn · City, Country
  </p>

  <h2>Summary</h2>
  <p>One paragraph, ~3–4 sentences, mirroring the JD's framing.</p>

  <h2>Skills</h2>
  <ul class="skills">
    <li><strong>Languages:</strong> X, Y, Z</li>
    <li><strong>Frameworks:</strong> A, B</li>
    <li><strong>Databases:</strong> D, E</li>
    <li><strong>Tools:</strong> F, G</li>
  </ul>

  <h2>Professional Experience</h2>
  <div class="job">
    <h3>Job Title</h3>
    <p class="job-meta">
      <span class="company">Company</span> &middot; <span class="dates">Mon YYYY &ndash; Mon YYYY &middot; Location</span>
    </p>
    <ul class="bullets">
      <li>Action verb led bullet with quantitative outcome and named tools/tech.</li>
      <li>Next bullet.</li>
    </ul>
  </div>
  <!-- repeat for each role -->

  <h2>Education</h2>
  <div class="edu">
    <p><strong>Degree, Field</strong> — School (Year)</p>
  </div>

  <h2>Certifications</h2>      <!-- optional -->
  <ul class="bullets">
    <li>Cert name — Issuer (Year)</li>
  </ul>

  <h2>Languages</h2>           <!-- optional -->
  <ul class="bullets">
    <li>Language — Proficiency</li>
  </ul>
</body>
```

## Inline CSS (template defaults)

```css
:root {
  --fg: #1a1a1a;
  --muted: #555;
  --rule: #cfcfcf;
}
* { box-sizing: border-box; }
body {
  font-family: Calibri, "Helvetica Neue", Arial, sans-serif;
  color: var(--fg);
  font-size: 11pt;
  line-height: 1.45;
  margin: 19mm;          /* ~0.75" */
  max-width: 100%;
}
h1.name {
  font-size: 20pt;
  font-weight: 700;
  margin: 0 0 4pt;
}
.contact {
  margin: 0 0 14pt;
  font-size: 10.5pt;
  color: var(--muted);
}
h2 {
  font-size: 13pt;
  font-weight: 700;
  margin: 14pt 0 4pt;
  padding-bottom: 2pt;
  border-bottom: 1px solid var(--rule);
  text-transform: uppercase;
  letter-spacing: 0.6pt;
}
h3 {
  font-size: 11.5pt;
  font-weight: 700;
  margin: 10pt 0 0;
}
p { margin: 0 0 6pt; }
ul {
  margin: 4pt 0 8pt;
  padding-left: 18pt;
  list-style: disc;
}
li { margin: 2pt 0; }
.job-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12pt;
  margin: 2pt 0 4pt;
  font-size: 10.5pt;
  color: var(--muted);
}
.job-meta .company {
  color: var(--fg);
  font-weight: 600;
}
ul.skills li { margin: 1pt 0; }
@page { size: A4; margin: 0; }
@media print {
  body { margin: 14mm; }
}
```

## Cover letter structure

A single-page, single-column letter. Same inline CSS conventions. Different layout:

```
<body>
  <p class="sender">[User Name]<br>Phone · Email · LinkedIn · City</p>

  <p class="date">Mon DD, YYYY</p>

  <p class="recipient">Hiring Team<br>[Company]</p>

  <p>Dear Hiring Team,</p>

  <p>Opening: name the role, name the company, one sentence on why it's interesting. No flattery.</p>

  <p>Middle: the strongest 1–2 experiences directly matching the JD top requirements. Paraphrase, don't repeat the resume.</p>

  <p>Differentiator: CTO/founder experience, business grounding, full-stack depth — in one sentence.</p>

  <p>Availability + contact + closing. 250–350 words total.</p>

  <p>Best regards,<br>[User Name]</p>
</body>
```

No `<h1>`, no `<h2>`. Just paragraphs. Headings in cover letters often get parsed oddly.

## Common mistakes to avoid

- Two-column layout even with `<div>`-based CSS — ATS flatteners can reorder columns.
- Skill tags as colored boxes / pill backgrounds — those need CSS the parser doesn't carry over. Use comma-separated bullets.
- Dates like "Oct 2021 — Present" mixed with "2021 – 2025" in the same doc — pick one format and stay consistent.
- Decorative `hr` or colored lines between sections — harmless but conveys nothing; a border-bottom on the h2 is enough.
- Page-break-inside tricks — fine for print but irrelevant for ATS, and they sometimes confuse the parser.
