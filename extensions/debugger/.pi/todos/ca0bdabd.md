{
  "id": "ca0bdabd",
  "title": "Slash commands /debugger, /debugger remote, /debugger stop (Part 2)",
  "tags": [
    "debugger",
    "part-2",
    "commands"
  ],
  "status": "open",
  "created_at": "2026-06-24T00:53:43.432Z"
}

Implement the three lifecycle commands. **Reference: [docs/02-slash-commands.md](docs/02-slash-commands.md).**

> **Command name is `/debugger`, not `/debug`.** pi reserves a built-in `/debug` command (screen-capture debug log); the TUI intercepts it (`if (text === "/debug")`) before extension commands run, so an extension registering `debug` can never receive it. Confirmed in pi 0.80.2. The extension registers `debugger` and parses trailing args in one handler.

Scope:
- `/debugger` (local): start server on 8866, telemetry target `http://localhost:8866`, enter debug state, show widget, activate debug tools/skill, prompt for bug context.
- `/debugger remote`: start `ngrok http 8866`, scrape public URL (graceful error if `ngrok` missing), instructional mode (no remote edits — copy-paste patches), surface URL in widget.
- `/debugger stop`: run snippet cleanup (Part 4), stop ngrok, close server (Part 1), clear widget + footer status, reset + persist state, keep the log file. Idempotent.

Verified: pi routes trailing words after a slash command as the `args` string, so `/debugger remote` and `/debugger stop` both reach the single `debugger` handler.

Acceptance criteria: see doc §Acceptance Criteria.
