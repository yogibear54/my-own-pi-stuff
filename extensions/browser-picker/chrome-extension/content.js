// Content script: implements hover-to-highlight, [ / ] to grow/shrink the
// selection up/down the DOM, click to capture, Esc to exit. Sends captures to
// the background service worker, which forwards them to Pi over WebSocket.

(() => {
  let active = false;
  let current = null;
  const stack = []; // remember children when growing up, so ] goes back down
  let box = null;
  let label = null;
  let banner = null;

  function ensureOverlay() {
    if (box) return;
    box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed", margin: "0", padding: "0",
      border: "2px solid #ff3366", background: "rgba(255,51,102,0.10)",
      pointerEvents: "none", zIndex: "2147483647", display: "none",
      boxSizing: "border-box", borderRadius: "2px",
    });
    label = document.createElement("div");
    Object.assign(label.style, {
      position: "fixed", margin: "0", padding: "2px 6px",
      background: "#11171f", color: "#e6edf3",
      font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
      border: "1px solid #ff3366", borderRadius: "3px",
      pointerEvents: "none", zIndex: "2147483647", display: "none",
      maxWidth: "92vw", whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis",
    });
    (document.body || document.documentElement).appendChild(box);
    (document.body || document.documentElement).appendChild(label);
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls =
      typeof el.className === "string" && el.className.trim()
        ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".")
        : "";
    if (cls) s += "." + cls;
    return s;
  }

  // Walk up to find the nearest source attribute (selection may land on a
  // child that doesn't itself carry it, but an ancestor does). Supports:
  //   - data-pi-file / data-pi-line   (the build plugin, any framework)
  //   - data-astro-source-file/-location (Astro dev server — no plugin needed)
  function sourceInfo(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const get = node.getAttribute && node.getAttribute.bind(node);
      if (get) {
        const pf = get("data-pi-file");
        if (pf) {
          const l = get("data-pi-line");
 return { file: pf, line: l ? parseInt(l, 10) : null };
        }
        const astroFile = get("data-astro-source-file");
        if (astroFile) {
          // data-astro-source-location is "<file>:<line>:<col>"; grab trailing line.
          const m = (get("data-astro-source-location") || "").match(/:(\d+):(\d+)\s*$/);
          return { file: astroFile, line: m ? parseInt(m[1], 10) : null };
        }
      }
      node = node.parentElement;
    }
    return { file: null, line: null };
  }

  function ancestorChain(el) {
    const chain = [];
    let node = el;
    while (node && node.nodeType === 1 && node.tagName !== "HTML") {
      chain.unshift(describe(node));
      node = node.parentElement;
    }
    return chain;
  }

  function positionOverlay() {
    if (!current || !box) return;
    const r = current.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    const src = sourceInfo(current);
    const srcStr = src.file
      ? `  \u{1F4C1} ${src.file}${src.line != null ? ":" + src.line : ""}`
      : "  (no data-pi-file)";
    label.style.display = "block";
    label.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 320)) + "px";
    label.style.top = Math.max(8, r.top - 22) + "px";
    label.textContent = describe(current) + srcStr;
  }

  function setTarget(el) {
    current = el;
    positionOverlay();
  }

  function onMouseOver(e) {
    if (!active) return;
    if (e.target === box || e.target === label || e.target === banner) return;
    stack.length = 0; // fresh hover resets the downward history
    setTarget(e.target);
  }

  function onReposition() {
    if (active) positionOverlay();
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === "[" || e.key === "ArrowUp") {
      e.preventDefault();
      const parent = current && current.parentElement;
      if (parent && parent.nodeType === 1 && parent.tagName !== "HTML") {
        if (current) stack.push(current);
        setTarget(parent);
      }
    } else if (e.key === "]" || e.key === "ArrowDown") {
      e.preventDefault();
      const prev = stack.pop();
      if (prev) setTarget(prev);
    } else if (e.key === "Escape") {
      e.preventDefault();
      exit();
    }
  }

  function onClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!current) return;
    const src = sourceInfo(current);
    const html = current.outerHTML || "";
    const MAX = 20000;
    const outerHTML = html.length > MAX ? html.slice(0, MAX) + "\n<!-- truncated -->" : html;
    chrome.runtime.sendMessage({
      type: "element_selected",
      tag: current.tagName.toLowerCase(),
      file: src.file,
      line: src.line,
      outerHTML,
      ancestorChain: ancestorChain(current),
      url: location.href,
    });
    flash();
  }

  function flash() {
    if (!box) return;
    box.style.background = "rgba(51,255,102,0.30)";
    setTimeout(() => {
      if (box) box.style.background = "rgba(255,51,102,0.10)";
    }, 200);
  }

  function showBanner(on) {
    if (on) {
      if (!banner) {
        banner = document.createElement("div");
        Object.assign(banner.style, {
          position: "fixed", right: "12px", bottom: "12px", zIndex: "2147483647",
          background: "#11171f", color: "#9fffe8", border: "1px solid #2aa",
          borderRadius: "6px", padding: "8px 10px", pointerEvents: "none",
          font: "12px/1.4 ui-monospace, monospace",
          boxShadow: "0 2px 12px rgba(0,0,0,.4)",
        });
      }
      banner.textContent = "Pi picker ON — hover, [ / ] to resize, click to send, Esc to exit";
      (document.body || document.documentElement).appendChild(banner);
    } else if (banner && banner.parentNode) {
      banner.parentNode.removeChild(banner);
    }
  }

  function enter() {
    active = true;
    ensureOverlay();
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    document.addEventListener("keydown", onKey, true);
    showBanner(true);
  }

  function exit() {
    active = false;
    current = null;
    stack.length = 0;
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("scroll", onReposition, true);
    window.removeEventListener("resize", onReposition);
    document.removeEventListener("keydown", onKey, true);
    if (box) box.style.display = "none";
    if (label) label.style.display = "none";
    showBanner(false);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "toggle_picker") {
      active ? exit() : enter();
    }
    return false;
  });
})();
