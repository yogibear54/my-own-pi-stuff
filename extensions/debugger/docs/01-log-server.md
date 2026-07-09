# Part 1 — HTTP Log Server

> Part of the [Pi AI Debugger](./ARCHITECTURE.md). Source requirements: `requirements.md` → "Basic Requirements > Server" and "JSON Format".

## Purpose

A local HTTP server that receives structured telemetry POSTed by injected logging snippets,
validates the payload, and appends it as JSONL to a per-session log file. It also keeps an
in-memory ring buffer of recent packets to feed the instrumentation widget.

## API / Module

`server.ts` — exports `startLogServer(opts)` returning a handle with `.port`, `.logFile`,
`.close()`, and `.onPacket(cb)`. Built on `node:http` (no external deps).

## Spec

### Endpoint behavior

| Case | Response |
|---|---|
| `POST` with valid JSON matching schema | `200` `{"status":"success"}` |
| `POST` with malformed (unparseable) JSON | `400` Bad Request |
| `POST` with valid JSON **not** matching schema | `400` Bad Request |
| Any non-`POST` method (e.g. `GET`) | `405` Method Not Allowed (set `Allow: POST`) |

### Listening

- Default port **8866**. Configurable (constructor option; e.g. wired from settings/env).
- `session_start` is the safe place to start a background socket (do **not** start it from the
  extension factory — see Pi docs on long-lived resources). For this extension, start it from
  the `/debugger` command instead (lazy start), and tear down on `/debugger stop` / `session_shutdown`.

### Log file

- Created **once per `/debugger` session** under `<cwd>/.pi/logs/`.
  - Use `CONFIG_DIR_NAME` (rebrands may not use `.pi`) instead of hardcoding.
  - `mkdir -p` the directory if missing.
- Filename: 8 alphanumeric chars + `.log`, e.g. `ab3k91xz.log`. Generate with
  `crypto.randomBytes`, base36-encoded, length 8.
- Each validated packet is appended as **one raw-JSON line** (JSONL). No trailing newline issues;
  one `JSON.stringify(packet)` + `"\n"` per append.

### Packet validation

Validate against this schema before accepting (reject with 400 if any required field is
missing/wrong-typed):

```ts
{
  log_id: string,            // required, e.g. "1698844392123-4"
  event_timestamp: string,   // required, ISO 8601
  level: string,             // required, e.g. TRACE|DEBUG|INFO|WARN|ERROR|FATAL
  source: {                  // required
    file: string,            // required
    line: number,            // required
    function: string,        // required
  },
  message: string,           // required
  variables?: object,        // optional
  stack_trace?: string,      // optional
}
```

> Design note: `variables` and `stack_trace` are optional in the schema (they are payloads).
> If stricter validation is desired later, this is the single place to change it.

### In-memory buffer

- Keep the last N packets (e.g. 500) in a ring buffer for the widget + a monotonic sequence
  counter. Emit to widget subscribers via an `onPacket` callback.

## Lifecycle

| Event | Action |
|---|---|
| `/debugger` (or `/debugger remote`) | `mkdir` logs dir, create session log file, `server.listen(8866)` |
| `/debugger remote` | additionally start ngrok tunnel to 8866 |
| `/debugger stop` | flush, `server.close()`, drop buffer, delete session log file |
| `session_shutdown` | ensure server closed (idempotent) |

## Acceptance Criteria

1. `curl -X POST localhost:8866 -d '<valid JSON>'` → `200 {"status":"success"}`; a line is
   appended to `.pi/logs/<id>.log`.
2. `curl -X POST localhost:8866 -d 'not json'` → `400`.
3. `curl -X POST localhost:8866 -d '{}'` (missing required fields) → `400`.
4. `curl localhost:8866` (GET) → `405` with `Allow: POST`.
5. A second valid POST in the same session appends to the **same** file as a new line.
6. `/debugger stop` closes the listener (subsequent POSTs fail to connect).
7. Directory `/.pi/logs/` is auto-created when absent.

## Dependencies / Open Items

- None external. `ngrok` is a Part 2 concern.
- Config source for the port (settings.json key vs. env var) — default to a constant for now,
  make it an option on `startLogServer`.
