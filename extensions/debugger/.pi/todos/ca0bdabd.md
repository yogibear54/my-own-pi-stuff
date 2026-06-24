{
  "id": "ca0bdabd",
  "title": "Slash commands /debug, /debug remote, /debug stop (Part 2)",
  "tags": [
    "debugger",
    "part-2",
    "commands"
  ],
  "status": "open",
  "created_at": "2026-06-24T00:53:43.432Z"
}

Implement the three lifecycle commands. **Reference: [docs/02-slash-commands.md](docs/02-slash-commands.md).**

Scope:
- `/debug` (local): start server on 8866, telemetry target `http://localhost:8866`, enter debug state, show widget, activate debug tools/skill, prompt for bug context.
- `/debug remote`: start `ngrok http 8866`, scrape public URL (graceful error if `ngrok` missing), instructional mode (no remote edits — copy-paste patches), surface URL in widget.
- `/debug stop`: run snippet cleanup (Part 4), stop ngrok, close server (Part 1), clear widget + footer status, reset + persist state, keep the log file. Idempotent.

Verify Pi's tokenization of `/debug remote` vs `/debug stop` (single `debug` command parsing args vs two commands).

Acceptance criteria: see doc §Acceptance Criteria.
