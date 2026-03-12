---
phase: 3
title: "Selector Registry & Content Script Upgrade"
status: pending
effort: 4h
---

# Phase 3: Selector Registry & Content Script Upgrade

## Overview

Replace hardcoded selector arrays in `content.js` with a strategy registry supporting 5 capability groups, priority ordering, health tracking, confidence scoring, and diagnostic logging. Upgrade extraction to be turn-aware with payload verification.

**Priority:** P0 — blocks Phase 4 (orchestrator needs content actions).
**Depends on:** Phase 1 (data model, logger).

## Key Insights

- v2.0 `content.js` has `SEL` object with 4 hardcoded arrays; no health tracking, no confidence
- PRD defines 5 capability groups: `editor`, `sendButton`, `completionState`, `assistantTurn`, `newChatTarget`
- v2.0 `extractLastResponse()` grabs last DOM element; no turn awareness, no streaming detection
- v2.0 `typeText()` has 3 methods (execCommand, innerHTML, clipboard); need to add payload verification
- Content script must remain stateless (re-injectable); registry config can be passed via message or loaded from storage
- Content script files loaded via manifest `content_scripts.js` array — IIFE pattern (no ES modules in content scripts)
- Load order: `selector-registry.js` → `content-extraction.js` → `content.js`. Each file exposes globals via `window.SelectorRegistry`, `window.ContentExtraction`

## Requirements

### Functional
- Strategy registry with 5 capability groups (PRD Section 14)
- Each strategy: id, capability, priority, selector/heuristic, confidenceBase, enabled, version
- Health tracking per strategy: healthy/degraded/suspect/broken
- `resolve(capability)` — try strategies in priority order, return best match with confidence
- Turn-aware extraction: identify latest completed assistant turn, ignore streaming
- Payload verification: compare editor content against intended payload hash
- Post-send acknowledgement: detect new user turn appeared
- Diagnostic output: per-capability evidence (strategies tried, match count, failure reason)

### Non-Functional
- Selector registry < 200 lines
- Content extraction < 200 lines
- Content.js refactored to use registry, < 200 lines
- No external dependencies

## Architecture

```
content.js (orchestrator of DOM actions)
  -> selector-registry.js (strategy lookup + health)
  -> content-extraction.js (turn-aware extraction + verification)
```

**Message handlers in content.js (v2.1):**
- `EXTRACT_TURN` — turn-aware extraction with confidence
- `COMPOSE_EDITOR` — type text using strategy order
- `VERIFY_EDITOR_PAYLOAD` — compare editor content to expected hash
- `CLICK_SEND` — find + click send button
- `CHECK_COMPLETION` — is generating? stability check
- `INSPECT_PAGE` — diagnostic bundle
- `FIND_NEW_CHAT_TARGET` — locate new chat link/button
- `DEBUG` — backward compat

## Related Code Files

| File | Action | Notes |
|------|--------|-------|
| `src/lib/selector-registry.js` | CREATE | Strategy registry with health and diagnostics |
| `src/lib/content-extraction.js` | CREATE | Turn-aware extraction, verification, hashing |
| `src/content.js` | REWRITE | Refactor to use registry and extraction libs |
| `src/manifest.json` | MODIFY | Add lib files to content_scripts.js array |

## Implementation Steps

1. **`src/lib/selector-registry.js`** (~180 lines)

   a. Default strategies (frozen):
   ```
   editor: [
     {id:'ed-prosemirror', selector:'div.ProseMirror[contenteditable="true"]', priority:1, confidence:0.95},
     {id:'ed-contenteditable', selector:'div[contenteditable="true"]', priority:2, confidence:0.7},
   ]
   sendButton: [
     {id:'send-aria', selector:'button[aria-label="Send Message"]', priority:1, confidence:0.95},
     {id:'send-aria-lc', selector:'button[aria-label="Send message"]', priority:2, confidence:0.9},
     {id:'send-testid', selector:'button[data-testid="send-button"]', priority:3, confidence:0.85},
     {id:'send-heuristic', heuristic:'aria-contains-send', priority:4, confidence:0.6},
     {id:'send-fieldset', heuristic:'last-button-in-fieldset', priority:5, confidence:0.4},
   ]
   completionState: [
     {id:'cs-stop-btn', selector:'button[aria-label="Stop Response"]', priority:1, confidence:0.9},
     {id:'cs-stop-btn-lc', selector:'button[aria-label="Stop response"]', priority:2, confidence:0.9},
     {id:'cs-streaming', selector:'[data-is-streaming="true"]', priority:3, confidence:0.85},
   ]
   assistantTurn: [
     {id:'at-conv-turn', selector:'[data-testid="conversation-turn"]', priority:1, confidence:0.9},
     {id:'at-streaming', selector:'div[data-is-streaming]', priority:2, confidence:0.8},
     {id:'at-claude-msg', selector:'.font-claude-message', priority:3, confidence:0.75},
     {id:'at-prose', selector:'.prose, .whitespace-pre-wrap, .markdown', priority:4, confidence:0.5},
   ]
   newChatTarget: [
     {id:'nc-project-link', heuristic:'project-new-chat-url', priority:1, confidence:0.9},
     {id:'nc-default', heuristic:'claude-new-chat-url', priority:2, confidence:0.85},
   ]
   ```

   b. `SelectorRegistry.resolve(capability)` — iterate strategies by priority, return `{element, strategyId, confidence, matchCount}` or `{error, strategiesTried}`

   c. `SelectorRegistry.resolveAll(capability)` — return all matching elements for assistantTurn

   d. `SelectorRegistry.updateHealth(strategyId, success)` — track success/fail counts, derive health state

   e. `SelectorRegistry.getDiagnostics(capability?)` — return full diagnostic per capability

   f. Heuristic handlers: map heuristic IDs to functions (e.g., `aria-contains-send` scans all buttons)

2. **`src/lib/content-extraction.js`** (~150 lines)

   a. `ContentExtraction.extractLatestTurn()`:
   - Use `SelectorRegistry.resolveAll('assistantTurn')` to get all turn elements
   - Filter: skip streaming turns (`data-is-streaming="true"`), skip empty, skip system notices
   - Take last completed turn
   - Extract `rawText` (innerText) and `normalizedText` (trimmed, collapsed whitespace)
   - Compute `charCount`, `lineCount`
   - Return `{rawText, normalizedText, charCount, lineCount, extractionSource, extractionConfidence, turnId?}`

   b. `ContentExtraction.computeHash(text)`:
   - Use `crypto.subtle.digest('SHA-256', ...)` (available in content script context)
   - Return hex string

   c. `ContentExtraction.verifyEditorPayload(expectedHash)`:
   - Read current editor content via `SelectorRegistry.resolve('editor')`
   - Normalize and hash
   - Compare to expectedHash
   - Return `{matches, actualHash, expectedHash}`

   d. `ContentExtraction.detectNewUserTurn(previousTurnCount)`:
   - Count current user turns, compare to previous count
   - Return `{acknowledged, currentCount}`

   e. `ContentExtraction.isGenerating()`:
   - Use `SelectorRegistry.resolve('completionState')`
   - Return `{generating, confidence, evidence}`

3. **Refactor `src/content.js`** (~120 lines)
   - Remove hardcoded `SEL` object
   - Remove inline `extractLastResponse()`, `isGenerating()`, `typeText()`, `clickSend()` (moved to libs)
   - Keep message handler switch, but dispatch to lib functions
   - New message actions: `EXTRACT_TURN`, `COMPOSE_EDITOR`, `VERIFY_EDITOR_PAYLOAD`, `CLICK_SEND`, `CHECK_COMPLETION`, `INSPECT_PAGE`, `FIND_NEW_CHAT_TARGET`
   - Backward compat: keep `EXTRACT_RESPONSE` -> delegates to `EXTRACT_TURN`
   - `COMPOSE_EDITOR`: focus editor, clear, insert text using execCommand then innerHTML fallback (no clipboard default)
   - `CLICK_SEND`: resolve sendButton, wait for enabled, click
   - `INSPECT_PAGE`: return `SelectorRegistry.getDiagnostics()` for all capabilities

4. **Update `src/manifest.json`**:
   - Add to content_scripts js array: `["lib/selector-registry.js", "lib/content-extraction.js", "content.js"]`

## Todo List

- [ ] Create `src/lib/selector-registry.js` with 5 capability groups
- [ ] Implement strategy resolution with priority ordering
- [ ] Implement health tracking (healthy/degraded/suspect/broken)
- [ ] Implement diagnostic output per capability
- [ ] Implement heuristic handlers for non-selector strategies
- [ ] Create `src/lib/content-extraction.js` with turn-aware extraction
- [ ] Implement SHA-256 content hashing via crypto.subtle
- [ ] Implement editor payload verification
- [ ] Implement post-send acknowledgement detection
- [ ] Refactor `src/content.js` to use registry and extraction libs
- [ ] Add new message action handlers
- [ ] Update manifest content_scripts js array
- [ ] Verify each file < 200 lines

## Success Criteria

- 5 capability groups registered with multiple strategies each
- `resolve()` returns best match with confidence score
- Health tracking updates on success/failure
- Turn-aware extraction ignores streaming turns
- Payload verification uses SHA-256 hash comparison
- New user turn acknowledgement detection works
- Diagnostic export shows all strategies tried per capability
- Backward compat: old `EXTRACT_RESPONSE` still works

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Claude.ai DOM change breaks all strategies for a capability | High | Multiple strategies per capability; health tracking surfaces which broke |
| crypto.subtle not available in content script | Low | Available in secure contexts (HTTPS); claude.ai is HTTPS |
| Content script load order matters | Medium | Manifest `js` array is ordered; registry loads before content.js |
| innerText extraction loses markdown formatting | Medium | Test with actual Claude output; consider innerHTML -> markdown conversion if needed |

## Security Considerations

- Content hashing is one-way (SHA-256), no sensitive data exposure
- Diagnostic export shows selectors and match counts, not document content
- No clipboard access by default (PRD Section 13.4)
