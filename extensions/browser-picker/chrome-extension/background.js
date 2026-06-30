// Background service worker: owns the WebSocket connection to the Pi extension
// and relays element selections from content scripts.

const PI_URL = "ws://127.0.0.1:7878";
let ws = null;
let connected = false;
const pending = []; // messages buffered while disconnected

function setBadge() {
  chrome.action.setBadgeText({ text: connected ? "PI" : "" });
  chrome.action.setBadgeBackgroundColor({ color: connected ? "#2ea043" : "#9333ea" });
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(PI_URL);
  } catch (e) {
    setTimeout(connect, 2000);
    return;
  }
  ws.onopen = () => {
    connected = true;
    setBadge();
    while (pending.length) {
      try {
        ws.send(pending.shift());
      } catch (e) {
        /* drop */
      }
    }
  };
  ws.onclose = () => {
    connected = false;
    setBadge();
    ws = null;
    setTimeout(connect, 1500); // Pi not running yet, or restarted
  };
  ws.onerror = () => {
    /* onclose will handle reconnect */
  };
  ws.onmessage = () => {
    /* Pi -> browser commands: not used yet */
  };
}

connect();

chrome.runtime.onStartup?.addListener(connect);

chrome.action.onClicked.addListener(async (tab) => {
  // Toggle the picker in the active tab.
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle_picker" });
  } catch (e) {
    // Content script not present (e.g. page was open before install). Try to inject.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tab.id, { type: "toggle_picker" });
    } catch (e2) {
      console.warn("Pi picker could not attach to this page (chrome:// URLs are not supported):", e2);
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "element_selected") {
    const payload = JSON.stringify(msg);
    if (connected && ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
      } catch (e) {
        pending.push(payload);
      }
    } else {
      pending.push(payload); // delivered once Pi reconnects
    }
  }
  return false;
});
