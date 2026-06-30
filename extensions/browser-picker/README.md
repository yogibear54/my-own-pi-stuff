# Pi Browser Picker

Hover/click elements in Chrome and send them to your live Pi session. Pi
receives the element's source file, line, and outerHTML and can act on it.

Three pieces:

1. **Pi extension** (`index.ts`) — starts a WebSocket server on `127.0.0.1:7878`
   when a session starts. Forwards browser selections into the conversation.
2. **Chrome extension** (`chrome-extension/`) — hover highlight, `[` / `]` to
   grow/shrink the selection, click to capture, `Esc` to exit.
3. **Tagging dev server** (`serve-tagged.mjs`) — serves a directory of static
   HTML with every element tagged `data-pi-file` / `data-pi-line` so Pi knows
   the source location of whatever you click. (For React/Vue/Svelte, this
   would instead be a framework build plugin — ask Pi.)

## Setup

### 1. Install the WebSocket dependency for the Pi extension

```bash
cd ~/.pi/agent/extensions/browser-picker
npm install
```

Pi auto-discovers the extension. Restart Pi (or `/reload`) and you'll see a
footer status `picker ws://127.0.0.1:7878`.

### 2. Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select
   `~/.pi/agent/extensions/browser-picker/chrome-extension`.
4. The toolbar icon badge shows `PI` (green) when connected to Pi, or empty
   (purple) when Pi isn't running.

### 3. Serve your HTML through the tagger (static HTML)

`serve-tagged.mjs` is a zero-dependency dev server. Point it at your HTML
root and open the tagged URL in Chrome instead of your usual server:

```bash
node ~/.pi/agent/extensions/browser-picker/serve-tagged.mjs \
  --root ./public      \
  --project-root .     \
  --port 4040
```

- `--root` — directory to serve (your HTML/web root).
- `--project-root` — base for the project-relative paths Pi sees in
  `data-pi-file` (defaults to `--root`).
- `--port` — defaults to `4040`. `--host` defaults to `127.0.0.1`.

Now click an element in Chrome → Pi receives `{file, line, outerHTML, ...}`
with the exact source file and line.

> **Dynamic templates?** This server tags *static* HTML files only. If your
> pages are server-rendered (PHP/Jinja/EJS/Blade), tell Pi the engine and it
> will build an engine-specific instrumenter instead.

## Usage

1. Start your app's dev server.
2. Start Pi in this project.
3. Click the Pi icon in Chrome's toolbar → the picker turns on for the active
   tab (a banner appears bottom-right).
4. Hover to highlight. Press `[` (or ↑) to widen to the parent element, `]`
   (or ↓) to shrink back.
5. Click to send the element to Pi. The selection appears in your Pi
   conversation with its source file:line and outerHTML.
6. `Esc` turns the picker off.
