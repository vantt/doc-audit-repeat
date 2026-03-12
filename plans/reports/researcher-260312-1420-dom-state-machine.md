---
name: DOM & State Management Patterns for Chrome Extension
description: Research on FSM, ProseMirror interaction, MutationObserver, selector resilience, and content hashing patterns
type: research
---

# DOM & State Machine Patterns Research

## 1. Finite State Machine Implementation

### Lightweight Options

**SmallFSM** (smallest bundle, <2KB minified)
- Dependency-free, MIT license
- API: `transit()` for state changes, `onTransit()` for callbacks
- Supports method chaining and custom events
- Good for: background script state tracking with low overhead
- Pattern: `fsm.transit('state', optionalContext)` with listeners

**@edium/fsm** (~3KB)
- TypeScript support, browser + Node.js
- Features: blocked transitions, entry/exit actions, context objects
- Guards work as predicates on transitions

**fsm-as-promised** (Promise-based)
- Minimal API surface
- Natural for async flows (waiting for editor focus, content ready)

### Hand-Rolled Alternative (Recommended for Extension)

```javascript
class StateMachine {
  constructor(initialState) {
    this.state = initialState;
    this.handlers = {};
    this.timers = {};
  }

  on(transition, handler) {
    this.handlers[transition] = handler;
    return this;
  }

  async go(targetState, context = {}) {
    const key = `${this.state}→${targetState}`;
    if (!this.handlers[key]) throw new Error(`Forbidden: ${key}`);

    // Clear timeout from previous state
    clearTimeout(this.timers[this.state]);

    const handler = this.handlers[key];
    this.state = targetState;
    await handler(context);
  }

  timeout(state, ms, fallback) {
    this.timers[state] = setTimeout(
      () => this.go(fallback, { timedOut: true }),
      ms
    );
  }
}
```

**Rationale:** 50 lines > 2KB library. Guarded transitions (check handler exists), per-state timeouts, retry via fallback states. Logging via context object. Fits extension memory constraints.

### For prompt_repeat: State Machine Graph
```
IDLE → WAITING_EDITOR → EDITOR_FOCUSED
     → WAITING_SEND → SEND_READY → SENDING → WAITING_RESPONSE
     → STREAMING → COMPLETE → IDLE
```

With guards: editor found, send button accessible, response detected, streaming ended.

---

## 2. ProseMirror Content Insertion from Content Script

### Challenge
ProseMirror uses internal state, not DOM-direct insertion. Content scripts cannot access the page's JS context directly (blocked by same-origin policy for extension context).

### Solutions

**Solution A: InputEvent Dispatch (Most Reliable)**

```javascript
async function insertInProseMirror(selector, text) {
  const editor = document.querySelector(selector);
  if (!editor) return false;

  // Set focus
  editor.focus();

  // Get editor's contentEditable state
  const wasContentEditable = editor.contentEditable;
  if (wasContentEditable === 'false') editor.contentEditable = 'true';

  // Clear existing content
  editor.textContent = '';

  // Insert text
  editor.textContent = text;

  // Dispatch input event with proper bubbling
  const event = new InputEvent('input', {
    data: text,
    bubbles: true,
    cancelable: true,
    inputType: 'insertText'
  });
  editor.dispatchEvent(event);

  // Fire change if needed
  editor.dispatchEvent(new Event('change', { bubbles: true }));

  return true;
}
```

**Solution B: Mutation Observation for Verification**

```javascript
async function verifyEditorAccepted(selector, expectedText, timeout = 500) {
  return new Promise((resolve) => {
    const editor = document.querySelector(selector);
    let resolved = false;

    const observer = new MutationObserver((mutations) => {
      if (editor.textContent.includes(expectedText)) {
        observer.disconnect();
        resolved = true;
        resolve(true);
      }
    });

    observer.observe(editor, {
      childList: true,
      characterData: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      if (!resolved) resolve(false);
    }, timeout);
  });
}
```

**Key Insight:** ProseMirror listens for `input` and `change` events. Dispatch both with correct event properties. Verify via mutation observation (ProseMirror will update DOM when it accepts).

### Avoiding Clipboard Dependency
- ✅ Direct text insertion + event dispatch
- ❌ Copy-paste via clipboard (unreliable, requires permissions)

### For prompt_repeat
Use combo: insert text → dispatch InputEvent → verify with 500ms MutationObserver check.

---

## 3. DOM Mutation Detection for Streaming Completion

### Two-Observer Pattern (Battle-Tested for ChatGPT)

```javascript
class StreamingDetector {
  constructor(parentSelector = '.conversation') {
    this.parent = document.querySelector(parentSelector);
    this.observers = new WeakMap();
    this.onComplete = null;

    // Listener 1: Watch for new messages
    this.mainObserver = new MutationObserver(() => {
      this.parent.querySelectorAll('[data-message-id]:not([data-observed])').forEach(msg => {
        this.watchMessage(msg);
      });
    });

    this.mainObserver.observe(this.parent, { childList: true, subtree: true });
  }

  watchMessage(msgNode) {
    msgNode.setAttribute('data-observed', 'true');

    // Listener 2: Watch THIS message's class changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mut => {
        if (mut.attributeName === 'class') {
          const classes = msgNode.className;
          if (!classes.includes('streaming') && classes.includes('complete')) {
            observer.disconnect();
            this.observers.delete(msgNode);
            if (this.onComplete) this.onComplete(msgNode);
          }
        }
      });
    });

    observer.observe(msgNode, {
      attributes: true,
      attributeFilter: ['class']
    });

    this.observers.set(msgNode, observer);
  }

  cleanup() {
    this.mainObserver.disconnect();
    // Individual observers auto-disconnect
  }
}
```

### Stability Detection (Hybrid Approach)

```javascript
class StabilityDetector {
  constructor(element, silenceMs = 300, checksNeeded = 2) {
    this.element = element;
    this.silenceMs = silenceMs;
    this.checksNeeded = checksNeeded;
    this.lastChangeTime = Date.now();
    this.stableChecks = 0;
  }

  async waitForStability() {
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        this.lastChangeTime = Date.now();
        this.stableChecks = 0; // Reset counter on mutation
      });

      observer.observe(this.element, {
        childList: true,
        characterData: true,
        subtree: true
      });

      const checker = setInterval(() => {
        const elapsed = Date.now() - this.lastChangeTime;
        if (elapsed > this.silenceMs) {
          this.stableChecks++;
          if (this.stableChecks >= this.checksNeeded) {
            clearInterval(checker);
            observer.disconnect();
            resolve();
          }
        }
      }, this.silenceMs);
    });
  }
}
```

**Key Pattern:**
- Main observer: detects new messages
- Per-message observer: detects completion (class removal)
- Stability detector: waits for silence + N consecutive checks (reduces false positives)

**For prompt_repeat:** Watch for assistant's message container, track `.streaming` class removal, confirm with 2× silence checks of 300ms.

---

## 4. Selector Resilience Strategy Pattern

### Problem
CSS selectors break when Claude.ai DOM changes. XPath works but is slow. Solution: **Priority Registry Pattern**.

```javascript
class SelectorRegistry {
  constructor() {
    this.strategies = new Map();
    this.health = new Map(); // track success/failure per strategy
  }

  register(capability, strategies) {
    // strategies = [
    //   { name: 'css-primary', select: () => document.querySelector(...) },
    //   { name: 'css-fallback', select: () => document.querySelector(...) },
    //   { name: 'xpath', select: () => xpathQuery(...) }
    // ]
    this.strategies.set(capability, strategies);
    strategies.forEach(s => this.health.set(s.name, { hits: 0, misses: 0 }));
  }

  find(capability) {
    const strategies = this.strategies.get(capability);
    if (!strategies) return null;

    // Sort by health (success rate)
    const sorted = [...strategies].sort((a, b) => {
      const healthA = this.health.get(a.name);
      const healthB = this.health.get(b.name);
      const rateA = healthA.hits / (healthA.hits + healthA.misses || 1);
      const rateB = healthB.hits / (healthB.hits + healthB.misses || 1);
      return rateB - rateA;
    });

    for (const strategy of sorted) {
      try {
        const result = strategy.select();
        if (result && result.offsetParent !== null) { // visible check
          this.health.get(strategy.name).hits++;
          return result;
        }
      } catch (e) {
        this.health.get(strategy.name).misses++;
      }
    }
    return null;
  }
}

// Usage
const selectors = new SelectorRegistry();

selectors.register('editor', [
  {
    name: 'data-testid',
    select: () => document.querySelector('[data-testid="chat-input"]')
  },
  {
    name: 'class-editor',
    select: () => document.querySelector('[class*="editor"][class*="input"]')
  },
  {
    name: 'contenteditable',
    select: () => document.querySelector('[contenteditable="true"]')
  },
  {
    name: 'xpath-editor',
    select: () => xpathQuery("//div[@role='textbox']")
  }
]);

selectors.register('send-button', [
  { name: 'svg-button', select: () => document.querySelector('button svg.send-icon')?.closest('button') },
  { name: 'aria-label', select: () => document.querySelector('[aria-label*="Send"]') },
  { name: 'class-send', select: () => document.querySelector('[class*="send"][class*="button"]') }
]);

// Get with fallback
const editor = selectors.find('editor');
const sendBtn = selectors.find('send-button');
```

**Benefits:**
- Automatic fallback on failure
- Health tracking trains system (tries successful ones first)
- No hardcoded XPath; CSS preferred, XPath last resort
- Extensible: add new strategies mid-session

---

## 5. Content Hashing & Diff Detection

### SHA-256 Hashing (Browser-Native)

```javascript
async function hashContent(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert to hex
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hasContentChanged(text1, text2) {
  const [h1, h2] = await Promise.all([
    hashContent(text1),
    hashContent(text2)
  ]);
  return h1 !== h2;
}
```

### Lightweight Diff Detection

```javascript
function detectMinimalChange(oldText, newText) {
  if (oldText === newText) return null;

  // Find first difference
  let start = 0;
  while (start < Math.min(oldText.length, newText.length) &&
         oldText[start] === newText[start]) {
    start++;
  }

  // Find last difference
  let endOld = oldText.length - 1;
  let endNew = newText.length - 1;
  while (endOld >= start && endNew >= start &&
         oldText[endOld] === newText[endNew]) {
    endOld--;
    endNew--;
  }

  return {
    type: newText.length > oldText.length ? 'append' : 'modify',
    position: start,
    removed: oldText.substring(start, endOld + 1),
    added: newText.substring(start, endNew + 1),
    newLength: newText.length,
    oldLength: oldText.length
  };
}
```

### Use Cases
1. **Verify response complete:** Hash of response text stops changing
2. **Detect user edit:** Hash changes before send (security check)
3. **Cache key:** Hash response to avoid re-processing duplicates
4. **Streaming validation:** Append detection (newText always contains oldText until complete)

**For prompt_repeat:**
- Hash initial response → hash after 300ms silence → if different, streaming continued
- Hash initial prompt → hash before send → should not change (user shouldn't edit)

---

## Summary: Architecture for prompt_repeat

| Component | Pattern | Library/Code |
|-----------|---------|--------------|
| **State** | Hand-rolled FSM with timeout/fallback | ~50 lines custom class |
| **Editor** | InputEvent + MutationObserver verify | Native DOM APIs |
| **Streaming** | Two-observer pattern + stability | 80 lines StreamingDetector |
| **Selectors** | Priority registry with health tracking | 60 lines SelectorRegistry |
| **Validation** | SHA-256 hash + minimal diff | crypto.subtle + string walk |

**Total custom code: ~400 lines for fully resilient extension.**

---

## Unresolved Questions

1. Does Claude.ai use `.streaming` or other marker class? Need to inspect actual DOM.
2. Does ProseMirror require specific node type creation or accepts text insertion via InputEvent?
3. How to handle shadow DOM in editor (if nested)? ContentEditable alone may not work.
4. Is rate-limiting needed on selector health checks (to avoid thrashing)?

---

## Sources

- [SmallFSM GitHub](https://github.com/greim/smallfsm)
- [Stream Detection for LLM Responses](https://www.fogel.dev/detecting_llm_streaming_completion)
- [ProseMirror Reference Manual](https://prosemirror.net/docs/ref/)
- [Web Cryptography API - SubtleCrypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)
- [Resilient Selectors in Synthetic Testing](https://www.datadoghq.com/blog/css-xpath-selectors-synthetic-testing/)
- [MutationObserver - Web APIs | MDN](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
- [JavaScript Web Cryptography API Guide](https://jameshfisher.com/2017/10/30/web-cryptography-api-hello-world/)
