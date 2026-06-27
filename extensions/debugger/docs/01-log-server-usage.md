# HTTP Log Server — Usage

> Usage guide for the Part 1 module. Design/spec: [`01-log-server.md`](./01-log-server.md). Sources: [`../server.ts`](../server.ts) (module), [`../cli.mjs`](../cli.mjs) (CLI).

The HTTP log server receives structured telemetry POSTed by injected logging
snippets, validates each packet, appends accepted packets as JSONL to a
per-session log file, and keeps an in-memory ring buffer for the widget.

It is **standalone** — no pi context required. Built on `node:http` (no external
deps). Use it one of two ways:

- **Programmatic API** ([`../server.ts`](../server.ts)) — `startLogServer(opts)`
  returns a handle. See [Programmatic API](#programmatic-api).
- **CLI** ([`../cli.mjs`](../cli.mjs)) — `start` / `stop` / `status` from the
  command line (daemon-style). See [CLI](#cli).

Settings (port configuration), log file location, endpoint behavior, and the
packet schema are identical for both — those sections apply regardless of how
you launched the server.

## Programmatic API

`startLogServer` is async and resolves to a handle:

```ts
import { startLogServer } from "../server.ts";

const srv = await startLogServer({ cwd: process.cwd() });

console.log(srv.port);             // bound port (e.g. 8866, or higher if auto-incremented)
console.log(srv.logFile);          // absolute path to the session JSONL file
console.log(srv.telemetryTarget);  // "http://localhost:<port>" — give this to injected snippets

// Receive each validated packet (single subscriber; invoked synchronously):
srv.onPacket((packet, seq) => {
  console.log(seq, packet);
});

// Stop (idempotent — safe to call multiple times):
srv.close();
```

### Handle

| Member | Description |
|---|---|
| `port` | Actually-bound port (may exceed the configured port after auto-increment). |
| `logFile` | Absolute path of the per-session JSONL log file. |
| `telemetryTarget` | `http://localhost:<port>` — where injected snippets POST telemetry. |
| `close()` | Stop the listener and drop the ring buffer. Idempotent. |
| `onPacket(cb)` | Set the single subscriber invoked per accepted packet as `(packet, seq)`. |

### Options (`LogServerOptions`, all optional)

| Option | Default | Description |
|---|---|---|
| `port` | — (falls through to precedence below) | Explicit port; highest precedence. |
| `cwd` | `process.cwd()` | Working directory under which `.pi/logs/` is created. |
| `bufferSize` | `500` | How many recent packets the in-memory ring buffer keeps. |

## CLI

Daemon-style: `start` launches the server **detached in the background**
(survives terminal close); `stop` and `status` operate on the running instance.

```sh
node cli.mjs start  [--port N] [--cwd DIR]   # launch in the background
node cli.mjs stop   [--cwd DIR]              # stop (SIGTERM → SIGKILL after 5s)
node cli.mjs status [--cwd DIR]              # show pid / port / log file / uptime
node cli.mjs --help                          # usage
```

- **`start`** spawns a detached child (`__serve` subcommand) in its own process
  group and waits for it to bind, then prints the *actual* port, the telemetry
  log file, and the state file path. Refuses if already running; clears stale
  state from a crashed prior run.
- **`stop`** sends `SIGTERM`; falls back to `SIGKILL` after 5s; removes the
  state file. No-op (with cleanup) if the state is stale.
- **`status`** reports running/port/target/log-file/uptime, or `Not running`
  (including the stale-state case).
- **Options** — `--port N` (bind port; overrides env/settings/default) and
  `--cwd DIR` (defaults to the current directory; this is where `.pi/logs/`
  and the state file live). Port precedence and auto-increment match the
  programmatic API (see [Settings](#settings-port-configuration)).

### State & daemon log files (CLI only)

The CLI tracks the running daemon in `<cwd>/<CONFIG_DIR_NAME>/debug-server.json`
(typically `<cwd>/.pi/debug-server.json`). Its shape:

```json
{
  "pid": 12345,
  "port": 8866,
  "logFile": "/abs/path/.pi/logs/<8-char>.log",
  "telemetryTarget": "http://localhost:8866",
  "startedAt": 1782454979377,
  "node": "/abs/path/bin/node"
}
```

The daemon's own stdout/stderr (e.g. the `serving on …` line, bind errors) go to
`<cwd>/<CONFIG_DIR_NAME>/logs/debug-server.daemon.log`. If `start` ever reports
a failure, check that file.

> **SDK resolution:** the CLI runs `server.ts` outside pi's loader, so on first
> run it ensures a local `node_modules/@earendil-works/pi-coding-agent` symlink
> to the global install (the repo's root `.gitignore` already covers
> `node_modules/`).

## Settings (port configuration)

The effective port is resolved **first-defined-wins**, in this order:

1. **`opts.port`** passed to `startLogServer`
2. **`PI_DEBUGGER_PORT`** env var (e.g. `PI_DEBUGGER_PORT=9000`)
3. **Project-local settings** — `debugger.port` in `<cwd>/.pi/settings.json`
4. **Global settings** — `debugger.port` in `~/.pi/agent/settings.json`
5. **`DEFAULT_PORT`** = `8866`

`.pi` here is the SDK's `CONFIG_DIR_NAME` (resolves to `.pi` for standard pi
installs). **Project-local overrides global.**

Settings file shape:

```json
{
  "debugger": {
    "port": 9000
  }
}
```

### Port conflicts

If the resolved port is in use (`EADDRINUSE`), the server auto-increments until
it finds a free port (up to `65535`). The actually-bound port is reported in
`srv.port` / `srv.telemetryTarget`, which may therefore be higher than what you
configured.

> **SDK note:** `getSettingsPath` is not exported from the SDK package root.
> `server.ts` imports `CONFIG_DIR_NAME` and `getAgentDir` and computes the
> global settings path as `<getAgentDir()>/settings.json` (equivalent to
> `getSettingsPath()`).

## Log file location

- **Path:** `<cwd>/<CONFIG_DIR_NAME>/logs/<8-char>.log` → typically
  `<cwd>/.pi/logs/<8-char>.log`
- **`cwd`** comes from `opts.cwd` (default `process.cwd()`).
- **Filename:** 8 lowercase-alphanumeric chars + `.log` (e.g. `ab3k91xz.log`),
  generated via `crypto.randomBytes` (base36, length 8). One file **per
  `startLogServer()` call** (i.e. per session).
- **Created at start** (empty) before any packet arrives; the `logs/` directory
  is auto-created with `mkdir -p` if missing.
- **Format:** JSONL — one `JSON.stringify(packet) + "\n"` per **validated**
  packet, appended in arrival order to the same file for the life of the handle.

## Endpoint behavior

Injected snippets POST JSON to `srv.telemetryTarget`. The server responds:

| Case | Response |
|---|---|
| Valid JSON matching schema | `200 {"status":"success"}` |
| Malformed (unparseable) JSON | `400` |
| Valid JSON not matching schema | `400` |
| Any non-POST method (e.g. GET) | `405` with `Allow: POST` |

### Packet schema

Required fields (reject with `400` if missing or wrong-typed):

| Field | Type | Notes |
|---|---|---|
| `log_id` | `string` | e.g. `"1698844392123-4"` |
| `event_timestamp` | `string` | ISO 8601 |
| `level` | `string` | **Non-empty; no enum** — any string is accepted. |
| `source.file` | `string` | |
| `source.line` | `number` | |
| `source.function` | `string` | |
| `message` | `string` | |

Optional fields:

| Field | Type |
|---|---|
| `variables` | `object` |
| `stack_trace` | `string` |

Example packet (also in [`requirements.md`](./requirements.md) → "JSON Format"):

```json
{
  "log_id": "1698844392123-4",
  "event_timestamp": "2023-11-01T14:53:12.123Z",
  "level": "ERROR",
  "source": { "file": "auth_controller.py", "line": 145, "function": "validate_user_token" },
  "message": "Failed to decrypt user token.",
  "variables": { "token_length": 12 },
  "stack_trace": "Traceback (...)"
}
```

## Verifying with curl

```sh
# valid → 200 {"status":"success"}
curl -X POST localhost:8866 -d '{"log_id":"1","event_timestamp":"2023-11-01T14:53:12.123Z","level":"ERROR","source":{"file":"a.py","line":1,"function":"f"},"message":"hi"}'

# malformed JSON → 400
curl -X POST localhost:8866 -d 'not json'

# missing required fields → 400
curl -X POST localhost:8866 -d '{}'

# non-POST → 405 with Allow: POST
curl localhost:8866
```

For the automated equivalent, see [`../server.test.mjs`](../server.test.mjs)
(run: `node server.test.mjs`).
