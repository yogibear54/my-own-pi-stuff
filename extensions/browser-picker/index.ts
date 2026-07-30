import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * Browser Picker extension.
 *
 * Starts a WebSocket server on session_start (127.0.0.1:7878). The companion
 * Chrome extension connects to it and forwards element selections made in the
 * browser. Each selection is injected into the conversation as a user message,
 * triggering a turn so Pi can act on it.
 *
 * Contract with the build plugin / Chrome extension:
 *   - Each element may carry `data-pi-file` (project-relative path) and
 *     `data-pi-line` (number), injected at build time.
 *   - On click, the Chrome extension sends:
 *       { type: "element_selected", file, line, tag, outerHTML, text,
 *         parentOuterHTML, ancestorChain: string[], url }
 *     `file`/`line` are present only when a build-plugin tag is found. When
 *     absent, `text` and the class tokens in `outerHTML`/`ancestorChain` let Pi
 *     locate the source via project-wide grep, and `url` (path) maps to the
 *     route/template file.
 */

const PORT = 7878;
const HOST = "127.0.0.1";

export default function (pi: ExtensionAPI) {
  let wss: WebSocketServer | undefined;
  let client: WebSocket | undefined;
  let sessionCtx: ExtensionContext | undefined;

  pi.on("session_start", (_event, ctx) => {
    sessionCtx = ctx;
    if (wss) return; // already listening
    try {
      wss = new WebSocketServer({ host: HOST, port: PORT });
    } catch (err) {
      ctx.ui.notify(`browser-picker: could not bind ${HOST}:${PORT} — ${String(err)}`, "error");
      return;
    }
    ctx.ui.setStatus("pi-browser", `picker ws://${HOST}:${PORT}`);
    wss.on("error", (err) => {
      sessionCtx?.ui.notify(`browser-picker WS error: ${String(err)}`, "error");
    });
    wss.on("connection", (ws) => {
      client = ws;
      sessionCtx?.ui.notify("Browser picker connected.", "info");
      ws.on("message", (raw) => {
        let msg: unknown;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg && typeof msg === "object" && (msg as { type?: string }).type === "element_selected") {
          deliverSelection(msg as Record<string, unknown>);
        }
      });
      ws.on("close", () => {
        if (client === ws) client = undefined;
        sessionCtx?.ui.notify("Browser picker disconnected.", "info");
      });
    });
  });

  pi.on("session_shutdown", () => {
    wss?.close();
    wss = undefined;
    client = undefined;
    sessionCtx = undefined;
  });

  function deliverSelection(msg: Record<string, unknown>) {
    const file = typeof msg.file === "string" ? msg.file : null;
    const line = typeof msg.line === "number" ? msg.line : null;
    const tag = typeof msg.tag === "string" ? msg.tag : "?";
    const outerHTML = typeof msg.outerHTML === "string" ? msg.outerHTML : "";
    const chain = Array.isArray(msg.ancestorChain) ? (msg.ancestorChain as string[]) : [];
    const url = typeof msg.url === "string" ? msg.url : "";
    const text = typeof msg.text === "string" ? msg.text : "";
    const parentOuterHTML = typeof msg.parentOuterHTML === "string" ? msg.parentOuterHTML : "";

    let path = "";
    try {
      if (url) path = new URL(url).pathname;
    } catch {
      /* ignore malformed url */
    }

    // When the build plugin tagged the element, point straight at file:line.
    // Otherwise, hand the LLM the fingerprints it needs to locate the source:
    // the text + class tokens (grep) and the URL path (route → template).
    const sourceLine = file
      ? `${file}${line != null ? ":" + line : ""}`
      : `(source not instrumented — locate it: grep the text/class tokens below` +
        (path ? ` and resolve the URL path "${path}" to its template file` : "") +
        `)`;

    let out =
      `User selected an element in the browser${url ? ` at ${url}` : ""}.\n` +
      `Element: <${tag}>\n` +
      `Source: ${sourceLine}\n`;
    if (text) out += `Text: ${JSON.stringify(text)}\n`;
    if (chain.length) out += `Ancestors: ${chain.join(" > ")}\n`;
    out += "\n" + "```html\n" + outerHTML + "\n```\n";
    if (parentOuterHTML)
      out += "\nParent context (element has no own text):\n```html\n" + parentOuterHTML + "\n```\n";

    // Prefill the input editor so the user can review before sending.
    // sessionCtx?.ui.pasteToEditor(out + "\n");
    // If idle, trigger a turn now. If Pi is busy, queue as a follow-up.
    if (sessionCtx?.isIdle()) {
      void pi.sendUserMessage(out);
    } else {
      void pi.sendUserMessage(out, { deliverAs: "followUp" });
    }
  }
}
