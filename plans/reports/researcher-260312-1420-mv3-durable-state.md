# Chrome Extension MV3: Durable State Management & Service Worker Patterns

**Date:** 2026-03-12
**Status:** Complete
**Focus:** Practical patterns for MV3 service worker persistence, message passing, and long-running operations

---

## 1. Durable State Management

### Core Challenge
Service workers terminate after 30 seconds of inactivity or 5 minutes of continuous execution. Global variables are lost on termination—state must be explicitly persisted.

### Storage Solutions

**chrome.storage.local**
- Default quota: 10 MB (5 MB in Chrome 113 and earlier)
- Synchronous API with async operations
- Stores JavaScript objects (JSON serializable)
- Simple key-value interface
- Good for: configuration, small artifacts, flags
- Best for extensions under 1-2 MB storage needs

**IndexedDB API**
- Capacity: 500 MB+ (typically no hard limit with `unlimitedStorage`)
- Asynchronous, non-blocking
- Structured data with indexes and transactions
- Better performance with large datasets
- Good for: large blobs, complex schemas, long artifact lists
- **Recommended for artifacts > 100 KB**

**unlimitedStorage Permission**
- Exempts extension from all quota restrictions when declared in manifest
- Applies to `chrome.storage.local`, IndexedDB, and Cache Storage
- No special API needed—just use normally
- Removed quota errors that would otherwise occur

### Practical Pattern: Lazy Load on Startup

```javascript
// background.js / service-worker.js
let appState = null;

chrome.runtime.onStartup.addListener(async () => {
  appState = await restoreState();
});

// For operations fired during idle period:
async function getState() {
  if (!appState) {
    appState = await restoreState();
  }
  return appState;
}

async function restoreState() {
  const stored = await chrome.storage.local.get(['appState']);
  return stored.appState || createDefaultState();
}

async function saveState(newState) {
  appState = newState;
  await chrome.storage.local.set({ appState });
}
```

### Checkpoint Pattern for Long Operations

```javascript
// Save progress every N iterations
async function processLargeDataset(items) {
  const checkpoint = await chrome.storage.local.get(['processIndex']);
  let startIdx = checkpoint.processIndex || 0;

  for (let i = startIdx; i < items.length; i++) {
    // Process item
    await processItem(items[i]);

    // Save checkpoint every 100 items
    if ((i + 1) % 100 === 0) {
      await chrome.storage.local.set({ processIndex: i + 1 });
    }

    // Guard: if approaching 5-min limit, save and allow termination
    if (isNearTimeout()) {
      await chrome.storage.local.set({ processIndex: i + 1 });
      return { status: 'paused', resumeAt: i + 1 };
    }
  }

  // Cleanup on completion
  await chrome.storage.local.remove(['processIndex']);
  return { status: 'complete' };
}
```

---

## 2. Service Worker Lifecycle & Termination

### Termination Triggers

| Trigger | Duration |
|---------|----------|
| Inactivity | 30 seconds |
| Single event processing | 5 minutes max |
| Fetch response time | 30 seconds max |
| Unresponsive to ping | 30 seconds (continuous sync JS) |

### Recovery Patterns

**Heartbeat via Alarms** (Recommended)
- `chrome.alarms` persist across terminations
- Minimum interval: 30 seconds (Chrome 120+)
- Does NOT prevent termination but enables scheduled wakeups
- Survives extension updates (usually) but not browser restart

```javascript
// background.js
chrome.runtime.onInstalled.addListener(() => {
  // Create alarm that fires every 30 seconds
  chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'heartbeat') {
    // Perform periodic maintenance
    const now = Date.now();
    await chrome.storage.local.set({ lastWakeup: now });

    // Check for pending work
    const { pendingWork } = await chrome.storage.local.get(['pendingWork']);
    if (pendingWork) {
      resumeWork();
    }
  }
});
```

**Event Listener Registration (CRITICAL)**
All listeners MUST be registered at top-level scope, not inside async blocks. Chrome needs them registered before service worker startup.

```javascript
// GOOD: Top-level listener
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // handle tab update
});

// BAD: Nested in async function
async function init() {
  const config = await loadConfig();
  chrome.tabs.onUpdated.addListener(...); // Won't fire!
}
```

**Timeout Guard Pattern**
```javascript
// Detect approaching 5-minute limit
let operationStart = Date.now();
const TIMEOUT_GUARD = 4.5 * 60 * 1000; // 4.5 min

async function guardedLongOp() {
  while (true) {
    const elapsed = Date.now() - operationStart;
    if (elapsed > TIMEOUT_GUARD) {
      // Save state and bail
      await chrome.storage.local.set({
        resumeAt: currentStep
      });
      return;
    }

    // Do work...
  }
}
```

---

## 3. Content Script Re-Injection After Navigation

### Challenge
Within a single tab, navigations should preserve content script connection but timing is unreliable. Declarative content scripts aren't re-injected on same-tab navigation by default.

### Pattern: Declarative + Programmatic Hybrid

```json
// manifest.json
{
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_start"
    }
  ]
}
```

```javascript
// background.js
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) { // Main frame only
    // Re-inject after navigation
    chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ['content.js']
    });
  }
});
```

### Main World Injection Pattern
For code that needs access to `window` scope:

```javascript
// background.js - inject a script that runs in main world
chrome.scripting.executeScript({
  target: { tabId: tabId },
  files: ['injected.js'],
  world: 'MAIN'  // Chrome 102+
});
```

```javascript
// injected.js (runs in main world)
window.extensionAPI = {
  doThing: () => console.log('from main world')
};
```

### Content Script Recovery

```javascript
// content.js
let connected = true;

try {
  const port = chrome.runtime.connect({ name: 'content' });

  port.onDisconnect.addListener(() => {
    connected = false;
    // Attempt reconnection after delay
    setTimeout(() => {
      window.location.reload(); // Force re-injection
    }, 2000);
  });
} catch (e) {
  // Extension not loaded yet
  console.warn('Extension not available');
}
```

---

## 4. Reliable Message Passing

### One-Time Request Pattern (Simple)

```javascript
// Sender (popup/content/background)
chrome.runtime.sendMessage({ action: 'getConfig' }).then(response => {
  console.log('Config:', response);
}).catch(error => {
  console.error('Message failed:', error.message);
});

// Receiver (background.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getConfig') {
    (async () => {
      const config = await loadConfig();
      sendResponse(config); // Auto-closes port after this
    })();
    return true; // Keep channel open for async response
  }
});
```

### Long-Lived Connection Pattern (Recommended for Repeated Traffic)

```javascript
// Sender (content.js)
const port = chrome.runtime.connect({ name: 'contentScript' });

port.onMessage.addListener((msg) => {
  console.log('From background:', msg);
});

port.onDisconnect.addListener(() => {
  console.warn('Background disconnected');
  reconnectAfterDelay();
});

// Send messages
port.postMessage({ action: 'getData', id: 123 });

// Receiver (background.js)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'contentScript') {
    port.onMessage.addListener(async (msg) => {
      if (msg.action === 'getData') {
        const data = await fetchData(msg.id);
        port.postMessage({ id: msg.id, data });
      }
    });
  }
});
```

### Error Handling with lastError

```javascript
// Sender
chrome.tabs.sendMessage(tabId, { action: 'test' }, (response) => {
  if (chrome.runtime.lastError) {
    console.error('Tab not ready:', chrome.runtime.lastError.message);
    // Tab may not have content script yet
    return;
  }
  console.log('Response:', response);
});
```

### Port Disconnection Guard

```javascript
// Both sender & receiver should handle:
port.onDisconnect.addListener(() => {
  if (chrome.runtime.lastError) {
    console.log('Disconnect reason:', chrome.runtime.lastError.message);
  }
  // Reconnect or cleanup
});
```

### Chrome 146+ Error Rejection (Modern)

Starting in Chrome 146, listeners can reject promises to signal errors:

```javascript
// Receiver
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const result = await doWork(msg);
      sendResponse(result);
    } catch (error) {
      throw new Error(`Processing failed: ${error.message}`);
      // Sender's promise will reject with this message
    }
  })();
  return true;
});
```

---

## 5. Storage Limits & Performance

### Quota Reference

| Storage API | Default Quota | With unlimitedStorage |
|-------------|---------------|----------------------|
| chrome.storage.local | 10 MB | Unlimited |
| chrome.storage.sync | 100 KB | 100 KB (unchanged) |
| IndexedDB | 500 MB+ | Unlimited |
| Cache Storage | Part of IndexedDB quota | Unlimited |
| LocalStorage / SessionStorage | Not available in service workers | N/A |

### Performance Characteristics

**chrome.storage.local**
- Small overhead per call (serialization)
- Best for: < 1 MB total data
- Batching recommended: group writes in single `set()` call
- Overhead becomes noticeable at > 5 MB

**IndexedDB**
- Higher startup cost (transaction overhead)
- Better for: large datasets, structured queries
- Minimal impact during iteration
- Recommended for artifacts or lists > 100 KB

### Optimization Pattern

```javascript
// Minimize storage calls by batching
async function updateMultipleSettings(updates) {
  // Instead of: await chrome.storage.local.set({key1: val1});
  //            await chrome.storage.local.set({key2: val2});

  // Do: single call
  await chrome.storage.local.set(updates);
}

// Cache in-memory during service worker lifetime
let configCache = null;

async function getConfig() {
  if (!configCache) {
    const stored = await chrome.storage.local.get(['config']);
    configCache = stored.config;
  }
  return configCache;
}

async function invalidateCache() {
  configCache = null;
}
```

---

## Key Takeaways

1. **Always persist state** to storage, never rely on globals
2. **Register all listeners at top level**—nested listeners won't fire after termination
3. **Use alarms for keepalive**, not setInterval
4. **IndexedDB for large artifacts** (> 100 KB)
5. **Long-lived ports** for repeated content↔background communication
6. **Checkpoint frequently** for operations approaching 5-min limit
7. **Check chrome.runtime.lastError** for message failures
8. **Request unlimitedStorage** if exceeding 10 MB quota

---

## Sources

- [Chrome Extension Service Worker Lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome Message Passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Chrome Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Microsoft Accessibility Insights MV3 Migration Guide](https://devblogs.microsoft.com/engineering-at-microsoft/learnings-from-migrating-accessibility-insights-for-web-to-chromes-manifest-v3/)
- [IndexedDB Storage Improvements](https://developer.chrome.com/docs/chromium/indexeddb-storage-improvements)

---

## Unresolved Questions

1. **Native messaging keepalive**: Does `chrome.runtime.connectNative()` indefinitely prevent termination, or only while actively communicating? Chrome docs suggest port closure triggers reconnection attempt.
2. **IndexedDB transaction semantics**: Under service worker termination during transaction, are partial writes rolled back? Testing needed.
3. **Storage.sync + MV3**: Does storage.sync quota remain 100 KB hard limit even with unlimitedStorage? Official docs silent on this interaction.
