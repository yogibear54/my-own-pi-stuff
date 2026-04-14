{
  "id": "bfeab06d",
  "title": "Implement TUI symbol browser component",
  "tags": [
    "code-nav",
    "feature",
    "enhancement"
  ],
  "status": "open",
  "created_at": "2026-04-13T17:37:03.817Z"
}

Implement the interactive symbol browser using ctx.ui.custom() for human-facing navigation.

**Implementation plan:**
1. Create tui.ts module with:
   - Fuzzy search input
   - Split view: definitions + references
   - Keyboard navigation (arrows, enter, tab, esc)
2. Register `/code-nav` command in index.ts
3. Add `/go-def`, `/refs`, `/symbols` shortcuts

**Success criteria:**
- Fuzzy search filters symbols in real-time
- Arrow keys navigate results
- Enter opens file location
- Tab toggles definitions/references
