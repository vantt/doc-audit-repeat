// ============================================================
// popup.js — UI controller for the extension popup
// Communicates with background.js via chrome.runtime.sendMessage
// ============================================================

let currentTabId = null;

// --- DOM refs ---
const $ = (id) => document.getElementById(id);

const badge = $("badge");
const tabInfo = $("tab-info");
const tabName = $("tab-name");
const tabIdEl = $("tab-id");
const viewSetup = $("view-setup");
const viewRunning = $("view-running");
const promptEl = $("prompt");
const roundsEl = $("rounds");
const btnStart = $("btn-start");
const btnPause = $("btn-pause");
const btnReset = $("btn-reset");
const btnDownload = $("btn-download");
const btnDebug = $("btn-debug");
const progressEl = $("progress");
const roundInfo = $("round-info");
const versionsEl = $("versions");
const logEl = $("log");
const settingsToggle = $("settings-toggle");
const settingsPanel = $("settings-panel");

// --- Init: detect current Claude.ai tab ---
async function init() {
  // Find the active Claude.ai tab
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (tab && tab.url && tab.url.includes("claude.ai")) {
    currentTabId = tab.id;
    tabInfo.style.display = "flex";
    tabName.textContent = tab.title?.slice(0, 30) || "Claude.ai";
    tabIdEl.textContent = tab.id;
    btnStart.disabled = false;
  } else {
    tabInfo.style.display = "flex";
    tabInfo.style.background = "#fef2f2";
    tabInfo.style.borderColor = "#fecaca";
    tabInfo.style.color = "#991b1b";
    tabInfo.innerHTML = "⚠ Hãy mở tab Claude.ai trước, rồi mở lại extension.";
    btnStart.disabled = true;
  }

  // Load saved prompt
  chrome.storage.local.get(["reviewPrompt", "totalRounds"], (data) => {
    if (data.reviewPrompt) promptEl.value = data.reviewPrompt;
    if (data.totalRounds) roundsEl.value = data.totalRounds;
  });

  // Get current state from background
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (resp) => {
    if (resp && resp.state) renderState(resp.state);
  });
}

// --- Render state ---
function renderState(state) {
  const isIdle = state.status === "idle";
  viewSetup.style.display = isIdle ? "block" : "none";
  viewRunning.style.display = isIdle ? "none" : "block";

  // Badge
  badge.className = "badge";
  switch (state.status) {
    case "idle":
      badge.classList.add("badge-idle");
      badge.textContent = "Idle";
      break;
    case "running":
      badge.classList.add("badge-running");
      badge.textContent = `⏳ ${state.currentRound}/${state.totalRounds}`;
      break;
    case "done":
      badge.classList.add("badge-done");
      badge.textContent = "✓ Xong";
      break;
    case "paused":
      badge.classList.add("badge-paused");
      badge.textContent = "⏸ Paused";
      break;
    case "error":
      badge.classList.add("badge-error");
      badge.textContent = "✕ Error";
      break;
  }

  // Buttons
  btnPause.style.display = state.status === "running" ? "" : "none";
  btnReset.style.display = state.status !== "idle" && state.status !== "running" ? "" : "none";
  btnDownload.style.display = state.versions.length > 0 && state.status !== "running" ? "" : "none";

  // Progress
  if (state.totalRounds > 0 && !isIdle) {
    progressEl.innerHTML = Array.from({ length: state.totalRounds }, (_, i) => {
      const cls =
        i < state.versions.length
          ? "done"
          : i === state.versions.length && state.status === "running"
          ? "active"
          : "";
      return `<div class="progress-bar ${cls}"></div>`;
    }).join("");
  }

  // Round info
  if (state.status === "running") {
    roundInfo.textContent = `Đang xử lý vòng ${state.currentRound} / ${state.totalRounds}`;
  } else if (state.status === "done") {
    roundInfo.textContent = `Hoàn thành ${state.versions.length} phiên bản.`;
  } else if (state.status === "paused") {
    roundInfo.textContent = `Tạm dừng ở vòng ${state.currentRound}.`;
  } else if (state.status === "error") {
    roundInfo.textContent = `Lỗi ở vòng ${state.currentRound}.`;
  } else {
    roundInfo.textContent = "";
  }

  // Versions
  versionsEl.innerHTML = state.versions
    .map(
      (v) =>
        `<div class="version" data-round="${v.round}">
          <div>
            <span class="version-label">V${v.round}</span>
            <span class="version-meta">${v.charCount?.toLocaleString() || "?"} chars · ${v.timestamp}</span>
          </div>
          <span style="font-size:11px; color:#a8a29e;">↓</span>
        </div>`
    )
    .join("");

  // Add click handlers for download
  versionsEl.querySelectorAll(".version").forEach((el) => {
    el.addEventListener("click", () => {
      const round = parseInt(el.dataset.round);
      const v = state.versions.find((x) => x.round === round);
      if (v) downloadVersion(v);
    });
  });

  // Log
  if (state.logs.length > 0 && !isIdle) {
    logEl.style.display = "block";
    logEl.innerHTML = state.logs
      .slice(-30)
      .map(
        (l) =>
          `<div class="${l.level}"><span style="color:#44403c;">${l.ts}</span> ${l.msg}</div>`
      )
      .join("");
    logEl.scrollTop = logEl.scrollHeight;
  } else {
    logEl.style.display = "none";
  }
}

// --- Download helpers ---
function downloadVersion(v) {
  const blob = new Blob([v.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `revision_v${v.round}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadAll(versions) {
  versions.forEach(downloadVersion);
}

// --- Event Listeners ---
btnStart.addEventListener("click", () => {
  const prompt = promptEl.value.trim();
  const rounds = parseInt(roundsEl.value) || 3;

  if (!prompt) {
    alert("Vui lòng nhập prompt review!");
    return;
  }
  if (!currentTabId) {
    alert("Không tìm thấy tab Claude.ai!");
    return;
  }

  const config = {
    DELAY_AFTER_NAV: parseInt($("cfg-nav-delay").value) || 4000,
    POLL_INTERVAL: parseInt($("cfg-poll-interval").value) || 2500,
    POLL_TIMEOUT: parseInt($("cfg-poll-timeout").value) || 600000,
    STABLE_CHECKS: parseInt($("cfg-stable").value) || 3,
  };

  chrome.runtime.sendMessage({
    type: "START_CYCLE",
    reviewPrompt: prompt,
    totalRounds: rounds,
    tabId: currentTabId,
    config,
  });
});

btnPause.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "PAUSE_CYCLE" });
});

btnReset.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RESET_CYCLE" });
});

btnDownload.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (resp) => {
    if (resp?.state?.versions) downloadAll(resp.state.versions);
  });
});

btnDebug.addEventListener("click", () => {
  if (!currentTabId) {
    alert("Không có tab Claude.ai!");
    return;
  }
  chrome.runtime.sendMessage({ type: "DEBUG_TAB", tabId: currentTabId }, (resp) => {
    if (resp?.debug) {
      const msg = Object.entries(resp.debug)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      alert("Debug:\n\n" + msg);
    } else {
      alert("Debug failed: " + (resp?.error || "No response from content script"));
    }
  });
});

settingsToggle.addEventListener("click", () => {
  const panel = settingsPanel;
  panel.style.display = panel.style.display === "none" ? "block" : "none";
});

promptEl.addEventListener("change", () => {
  chrome.storage.local.set({ reviewPrompt: promptEl.value });
});
roundsEl.addEventListener("change", () => {
  chrome.storage.local.set({ totalRounds: parseInt(roundsEl.value) });
});

// --- Listen for state updates from background ---
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATE_UPDATE") {
    renderState(msg.state);
  }
});

// --- Init ---
init();
