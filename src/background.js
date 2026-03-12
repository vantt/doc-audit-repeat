// ============================================================
// background.js — Orchestration brain
// Manages state, tab tracking, and cycle logic.
// Content script is just "hands" for DOM interaction.
// ============================================================

const DEFAULT_CONFIG = {
  DELAY_AFTER_NAV: 4000,
  DELAY_BEFORE_SEND: 800,
  DELAY_AFTER_SEND: 3000,
  POLL_INTERVAL: 2500,
  POLL_TIMEOUT: 600000, // 10 min
  STABLE_CHECKS: 3,
};

// --- Persistent state (survives tab navigation) ---
let state = {
  status: "idle", // idle | running | paused | done | error
  tabId: null,
  reviewPrompt: "",
  totalRounds: 3,
  currentRound: 0,
  versions: [],
  projectUrl: "",
  logs: [],
  config: { ...DEFAULT_CONFIG },
};

// ============================================================
// LOGGING
// ============================================================
function log(msg, level = "info") {
  const ts = new Date().toLocaleTimeString("vi-VN");
  state.logs.push({ ts, msg, level });
  if (state.logs.length > 200) state.logs = state.logs.slice(-100);
  console[level === "error" ? "error" : "log"](`[BG] ${msg}`);
  broadcastState();
}

// ============================================================
// STATE BROADCASTING — keeps popup in sync
// ============================================================
function broadcastState() {
  chrome.runtime.sendMessage({ type: "STATE_UPDATE", state }).catch(() => {});
}

// ============================================================
// MESSAGING TO CONTENT SCRIPT
// ============================================================
function sendToContent(tabId, action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// Retry wrapper — content script may not be ready right after navigation
async function sendToContentRetry(tabId, action, data = {}, retries = 8, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await sendToContent(tabId, action, data);
      return resp;
    } catch (e) {
      if (i < retries - 1) {
        log(`Content script chưa sẵn sàng, thử lại... (${i + 1}/${retries})`);
        await sleep(delay);
        // Try re-injecting content script
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"],
          });
        } catch (_) {}
        await sleep(500);
      } else {
        throw e;
      }
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// TAB MANAGEMENT
// ============================================================

// Navigate the tracked tab to a new URL and wait for it to load
function navigateTab(tabId, url) {
  return new Promise((resolve, reject) => {
    const onUpdated = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timeout);
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Tab navigation timeout"));
    }, 30000);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url });
  });
}

// Detect project URL from current tab URL
function detectNewChatUrl(currentUrl) {
  // Project: https://claude.ai/project/xxx -> https://claude.ai/project/xxx
  const projectMatch = currentUrl.match(/(https:\/\/claude\.ai\/project\/[^/?#]+)/);
  if (projectMatch) return projectMatch[1];
  return "https://claude.ai/new";
}

// ============================================================
// CORE CYCLE LOGIC
// ============================================================
async function runCycle() {
  state.status = "running";
  state.versions = [];
  state.currentRound = 0;
  state.logs = [];
  broadcastState();

  const tabId = state.tabId;
  if (!tabId) {
    log("Không có tab ID!", "error");
    state.status = "error";
    broadcastState();
    return;
  }

  // Verify tab exists
  try {
    const tab = await chrome.tabs.get(tabId);
    state.projectUrl = detectNewChatUrl(tab.url);
    log(`Tab ID: ${tabId}`);
    log(`Project URL: ${state.projectUrl}`);
  } catch (e) {
    log("Tab không tồn tại! Mở Claude.ai trước.", "error");
    state.status = "error";
    broadcastState();
    return;
  }

  // --- Round 1: Extract current response ---
  state.currentRound = 1;
  broadcastState();
  log("Vòng 1: Trích xuất response hiện tại...");

  try {
    const resp = await sendToContentRetry(tabId, "EXTRACT_RESPONSE");
    if (!resp || !resp.ok || !resp.text) {
      log("Không tìm thấy response! Hãy chạy query đầu tiên trước.", "error");
      state.status = "error";
      broadcastState();
      return;
    }

    state.versions.push({
      round: 1,
      content: resp.text,
      charCount: resp.text.length,
      timestamp: new Date().toLocaleTimeString("vi-VN"),
    });
    log(`V1: ${resp.text.length} ký tự.`);
    broadcastState();
  } catch (e) {
    log("Lỗi trích xuất V1: " + e.message, "error");
    state.status = "error";
    broadcastState();
    return;
  }

  // --- Rounds 2..N ---
  for (let round = 2; round <= state.totalRounds; round++) {
    if (state.status !== "running") {
      log("Chu trình đã dừng.");
      broadcastState();
      return;
    }

    state.currentRound = round;
    broadcastState();
    log(`--- Vòng ${round}/${state.totalRounds} ---`);

    // 1. Navigate to new chat
    log("Mở chat mới...");
    try {
      await navigateTab(tabId, state.projectUrl);
      await sleep(state.config.DELAY_AFTER_NAV);
    } catch (e) {
      log("Lỗi navigate: " + e.message, "error");
      state.status = "error";
      broadcastState();
      return;
    }

    // 2. Compose and type message
    const lastContent = state.versions[state.versions.length - 1].content;
    const message = `${state.reviewPrompt}\n\n---\n\n[Vòng ${round}/${state.totalRounds}] Đây là tài liệu cần review và revise. Hãy trả về bản đã cải thiện:\n\n${lastContent}`;

    log("Nhập prompt vào editor...");
    try {
      const typeResp = await sendToContentRetry(tabId, "TYPE_TEXT", { text: message });
      if (!typeResp || !typeResp.ok) {
        log("Không thể nhập text vào editor!", "error");
        state.status = "error";
        broadcastState();
        return;
      }
    } catch (e) {
      log("Lỗi nhập text: " + e.message, "error");
      state.status = "error";
      broadcastState();
      return;
    }

    // 3. Click send
    await sleep(state.config.DELAY_BEFORE_SEND);
    log("Gửi message...");
    try {
      const sendResp = await sendToContentRetry(tabId, "CLICK_SEND");
      if (!sendResp || !sendResp.ok) {
        log("Không thể click Send!", "error");
        state.status = "error";
        broadcastState();
        return;
      }
    } catch (e) {
      log("Lỗi click send: " + e.message, "error");
      state.status = "error";
      broadcastState();
      return;
    }

    // 4. Wait for response
    log("Đợi Claude trả lời...");
    await sleep(state.config.DELAY_AFTER_SEND);

    const responseText = await pollForResponse(tabId);
    if (responseText === null) {
      if (state.status === "paused") {
        log("Đã tạm dừng.");
      } else {
        log(`Không nhận được response ở vòng ${round}!`, "error");
        state.status = "error";
      }
      broadcastState();
      return;
    }

    // 5. Save version
    state.versions.push({
      round,
      content: responseText,
      charCount: responseText.length,
      timestamp: new Date().toLocaleTimeString("vi-VN"),
    });
    log(`V${round}: ${responseText.length} ký tự.`);
    broadcastState();
  }

  state.status = "done";
  log("Hoàn thành tất cả các vòng!");
  broadcastState();
}

// Poll content script until response is stable
async function pollForResponse(tabId) {
  const startTime = Date.now();
  let lastText = "";
  let stableCount = 0;

  while (Date.now() - startTime < state.config.POLL_TIMEOUT) {
    if (state.status !== "running") return null;

    try {
      const resp = await sendToContentRetry(tabId, "CHECK_STATUS", {}, 3, 1000);

      if (resp && resp.ok) {
        const { isGenerating, lastResponseText } = resp;

        if (!isGenerating && lastResponseText && lastResponseText.length > 0) {
          if (lastResponseText === lastText) {
            stableCount++;
            if (stableCount >= state.config.STABLE_CHECKS) {
              log(`Response ổn định (${stableCount} checks).`);
              return lastResponseText;
            }
          } else {
            stableCount = 0;
          }
          lastText = lastResponseText;
        } else {
          stableCount = 0;
          if (isGenerating) lastText = lastResponseText || "";
        }
      }
    } catch (e) {
      // Content script might be temporarily unavailable
      log("Poll lỗi: " + e.message);
    }

    await sleep(state.config.POLL_INTERVAL);
  }

  log("Timeout đợi response!", "error");
  return null;
}

// ============================================================
// MESSAGE HANDLER — from popup and content script
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "GET_STATE":
      sendResponse({ state });
      break;

    case "START_CYCLE":
      state.reviewPrompt = msg.reviewPrompt;
      state.totalRounds = msg.totalRounds;
      state.tabId = msg.tabId;
      if (msg.config) state.config = { ...state.config, ...msg.config };
      // Save to storage
      chrome.storage.local.set({
        reviewPrompt: state.reviewPrompt,
        totalRounds: state.totalRounds,
      });
      runCycle();
      sendResponse({ ok: true });
      break;

    case "PAUSE_CYCLE":
      state.status = "paused";
      broadcastState();
      sendResponse({ ok: true });
      break;

    case "RESET_CYCLE":
      state.status = "idle";
      state.currentRound = 0;
      state.versions = [];
      state.logs = [];
      broadcastState();
      sendResponse({ ok: true });
      break;

    case "DEBUG_TAB":
      // Forward debug request to content script
      if (msg.tabId) {
        sendToContent(msg.tabId, "DEBUG")
          .then((r) => sendResponse(r))
          .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true; // async
      }
      break;
  }

  return false;
});

// Keep service worker alive during long operations
chrome.runtime.onInstalled.addListener(() => {
  console.log("[BG] Claude Review Cycle installed.");
});
