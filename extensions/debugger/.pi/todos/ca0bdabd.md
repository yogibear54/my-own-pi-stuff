{
  "id": "ca0bdabd",
  "title": "Slash commands /debug, /debug remote, /debug stop (Part 2)",
  "tags": [
    "debugger",
    "part-2",
    "commands"
  ],
  "status": "done",
  "created_at": "2026-06-24T00:53:43.432Z"
}

Done. `/debug`, `/debug remote`, `/debug stop` implemented as a single `debug` command parsing args (local|remote|stop), with argument completions.

Verified in the real pi runtime + integration test:
- `/debug` (local): starts server on 8866 (or PI_DEBUG_PORT), telemetry target http://localhost:PORT, enters debug state, shows widget, activates the 8 debug tools, prefills editor prompt.
- `/debug stop`: runs cleanup_all_snippets (keeps fix), stops ngrok, closes server, clears widget+status, restores tools, retains the log file. Idempotent (soft no-op when inactive).
- baseline session_start + before_agent_start validated via `pi -p`.

Remote (`/debug remote`): implemented defensively (spawns `ngrok http <port>`, scrapes public URL from the ngrok API at :4040; on missing/failed ngrok it closes the server and notifies an error without crashing). NOT exercised here because ngrok isn't installed in this env — needs a real run with ngrok present. Local + remote share port 8866 per the locked decision.
