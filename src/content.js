// ============================================================
// content.js — DOM interaction layer ("hands")
// Only responds to commands from background.js
// No state management, no cycle logic.
// ============================================================

(function () {
  "use strict";

  // --- Selectors (update here if Claude.ai DOM changes) ---
  const SEL = {
    editor: [
      'div.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"]',
    ],
    sendButton: [
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
      'button[data-testid="send-button"]',
    ],
    stopButton: [
      'button[aria-label="Stop Response"]',
      'button[aria-label="Stop response"]',
      'button[aria-label="Stop"]',
    ],
    messageGroups: [
      '[data-testid="conversation-turn"]',
      'div[data-is-streaming]',
      '.font-claude-message',
    ],
  };

  function findEl(selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function findAllEls(selectors) {
    for (const s of selectors) {
      const els = document.querySelectorAll(s);
      if (els.length > 0) return Array.from(els);
    }
    return [];
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // --- Extract last assistant response ---
  function extractLastResponse() {
    // Strategy 1: conversation turns
    const turns = findAllEls(SEL.messageGroups);
    if (turns.length > 0) {
      const last = turns[turns.length - 1];
      const text = last.innerText?.trim();
      if (text) return text;
    }

    // Strategy 2: prose/markdown containers
    const proseEls = document.querySelectorAll(
      ".prose, .whitespace-pre-wrap, .markdown"
    );
    if (proseEls.length > 0) {
      const last = proseEls[proseEls.length - 1];
      return last.innerText?.trim() || "";
    }

    // Strategy 3: any message-like container
    const msgs = document.querySelectorAll(
      '[data-testid*="message"], [class*="message"]'
    );
    if (msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      return last.innerText?.trim() || "";
    }

    return "";
  }

  // --- Check if generating ---
  function isGenerating() {
    const stop = findEl(SEL.stopButton);
    if (stop && stop.offsetParent !== null) return true;
    const streaming = document.querySelector('[data-is-streaming="true"]');
    return !!streaming;
  }

  // --- Type text into editor ---
  async function typeText(text) {
    const editor = findEl(SEL.editor);
    if (!editor) return false;

    editor.focus();
    await sleep(400);

    // Clear
    editor.innerHTML = "";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(200);

    // Method 1: execCommand
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(300);
      if (editor.innerText.trim().length > 0) return true;
    } catch (_) {}

    // Method 2: innerHTML with ProseMirror paragraphs
    try {
      const paras = text.split("\n").map((line) => {
        if (line.trim() === "") return "<p><br></p>";
        const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<p>${escaped}</p>`;
      });
      editor.innerHTML = paras.join("");
      ["input", "change", "keyup"].forEach((ev) =>
        editor.dispatchEvent(new Event(ev, { bubbles: true }))
      );
      await sleep(300);
      if (editor.innerText.trim().length > 0) return true;
    } catch (_) {}

    // Method 3: clipboard
    try {
      editor.focus();
      await navigator.clipboard.writeText(text);
      document.execCommand("selectAll");
      document.execCommand("paste");
      await sleep(400);
      if (editor.innerText.trim().length > 0) return true;
    } catch (_) {}

    return false;
  }

  // --- Click send ---
  async function clickSend() {
    let btn = findEl(SEL.sendButton);

    // Fallback: find by structural heuristic
    if (!btn) {
      for (const b of document.querySelectorAll("button")) {
        const label = (b.getAttribute("aria-label") || "").toLowerCase();
        if (label.includes("send")) {
          btn = b;
          break;
        }
      }
    }
    // Fallback: last button in fieldset (common pattern)
    if (!btn) {
      const fieldset = document.querySelector("fieldset");
      if (fieldset) {
        const buttons = fieldset.querySelectorAll("button");
        if (buttons.length > 0) btn = buttons[buttons.length - 1];
      }
    }

    if (!btn) return false;

    // Wait for enabled
    for (let i = 0; i < 20; i++) {
      if (!btn.disabled) break;
      await sleep(300);
    }
    if (btn.disabled) return false;

    btn.click();
    return true;
  }

  // --- Debug info ---
  function debugInfo() {
    const results = {};
    for (const [name, selectors] of Object.entries(SEL)) {
      const el = findEl(selectors);
      results[name] = el
        ? `✓ (${el.tagName}.${(el.className || "").split(" ")[0]})`
        : `✕ tried: ${selectors.join(", ")}`;
    }
    const resp = extractLastResponse();
    results.lastResponse = resp
      ? `✓ ${resp.length} chars`
      : "✕ empty";
    results.isGenerating = isGenerating();
    results.url = window.location.href;
    return results;
  }

  // ============================================================
  // MESSAGE HANDLER — respond to commands from background.js
  // ============================================================
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.action) {
      case "EXTRACT_RESPONSE": {
        const text = extractLastResponse();
        sendResponse({ ok: !!text, text });
        break;
      }

      case "TYPE_TEXT": {
        typeText(msg.text).then((ok) => sendResponse({ ok }));
        return true; // async
      }

      case "CLICK_SEND": {
        clickSend().then((ok) => sendResponse({ ok }));
        return true; // async
      }

      case "CHECK_STATUS": {
        sendResponse({
          ok: true,
          isGenerating: isGenerating(),
          lastResponseText: extractLastResponse(),
        });
        break;
      }

      case "DEBUG": {
        sendResponse({ ok: true, debug: debugInfo() });
        break;
      }

      default:
        sendResponse({ ok: false, error: "Unknown action" });
    }
  });

  // Signal that content script is loaded
  console.log("[CRC] Content script loaded:", window.location.href);
})();
