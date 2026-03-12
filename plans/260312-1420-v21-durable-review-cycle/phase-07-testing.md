---
phase: 7
title: "Testing & Acceptance Validation"
status: pending
effort: 3h
---

# Phase 7: Testing & Acceptance Validation

## Overview

Create unit tests for FSM, storage, selectors, context strategies, quality evaluator. Integration tests for messaging and checkpoint persistence. Scenario tests for happy path, pause/resume, reload recovery. Build test corpus.

**Priority:** P1 — validates all prior phases.
**Depends on:** All previous phases complete.

## Key Insights

- Chrome extension testing without a build tool: use a simple test runner that runs in Node.js or browser console
- Mock `chrome.*` APIs for unit tests; real extension for scenario tests
- FSM, quality evaluator, content hasher, failure taxonomy are pure logic — easy to unit test
- Storage layer needs chrome.storage mock
- Selector registry needs DOM mock
- PRD Section 16 requires 4 test layers + 7 required scenarios + test corpus
- Keep test infra minimal: no Jest/Mocha dependency; plain assertion functions

## Requirements

### Functional
- Unit tests: FSM transitions (all valid + invalid), stop conditions, payload hashing, retry logic, failure classification
- Integration tests: background/content messaging mock, checkpoint save/load/resume
- DOM contract tests: selector registry against mock DOM
- Scenario tests: 7 required scenarios from PRD Section 16.2
- Test corpus: 5+ document types

### Non-Functional
- Tests runnable via `node tests/run-all.js` (Node.js) or loadable in browser console
- No external test framework dependency
- Each test file < 200 lines
- Clear pass/fail output

## Architecture

```
tests/
  test-runner.js            — minimal assertion lib + runner
  test-state-machine.js     — FSM transition tests
  test-storage-layer.js     — checkpoint/version persistence (mocked chrome.storage)
  test-failure-taxonomy.js  — failure code classification
  test-context-strategies.js — payload composition, estimation, fallback
  test-quality-evaluator.js — diff ratio, hash compare, early stop, refusal
  test-content-hasher.js    — SHA-256 + quick hash
  test-selector-registry.js — strategy resolution against mock DOM
  mocks/
    chrome-storage-mock.js  — in-memory chrome.storage.local mock
    dom-mock.js             — minimal DOM mock for selector testing
  test-corpus/
    plain-text.md           — simple prose
    structured-markdown.md  — headings, lists, code fences, tables
    code-heavy.md           — lots of code blocks
    tables-heavy.md         — complex tables
    long-document.md        — 10k+ words
    edge-whitespace.md      — unusual whitespace and delimiters
```

## Related Code Files

| File | Action | Notes |
|------|--------|-------|
| `tests/test-runner.js` | CREATE | Minimal assertion lib |
| `tests/test-state-machine.js` | CREATE | FSM tests |
| `tests/test-storage-layer.js` | CREATE | Storage tests |
| `tests/test-failure-taxonomy.js` | CREATE | Failure code tests |
| `tests/test-context-strategies.js` | CREATE | Context strategy tests |
| `tests/test-quality-evaluator.js` | CREATE | Quality eval tests |
| `tests/test-content-hasher.js` | CREATE | Hashing tests |
| `tests/test-selector-registry.js` | CREATE | Selector tests |
| `tests/mocks/chrome-storage-mock.js` | CREATE | Chrome storage mock |
| `tests/mocks/dom-mock.js` | CREATE | DOM mock |
| `tests/test-corpus/*.md` | CREATE | 6 test documents |

## Implementation Steps

1. **`tests/test-runner.js`** (~60 lines)
   - `assert(condition, message)` — throw on failure
   - `assertEqual(actual, expected, message)`
   - `assertThrows(fn, message)`
   - `describe(name, fn)` — group tests
   - `it(name, fn)` — individual test (sync or async)
   - `run()` — execute all registered tests, print summary
   - Track pass/fail counts

2. **`tests/mocks/chrome-storage-mock.js`** (~40 lines)
   - In-memory key-value store
   - `chrome.storage.local.get(keys, callback)`
   - `chrome.storage.local.set(items, callback)`
   - `chrome.storage.local.remove(keys, callback)`
   - `chrome.storage.local.clear(callback)`

3. **`tests/mocks/dom-mock.js`** (~50 lines)
   - Minimal mock: `document.querySelector`, `document.querySelectorAll`
   - Configurable elements: pass in a map of selector -> mock element
   - Mock element: `{tagName, className, innerText, getAttribute(), offsetParent, disabled, click(), focus(), dispatchEvent()}`

4. **`tests/test-state-machine.js`** (~120 lines)
   - Valid transitions: test each of the ~20 defined transitions
   - Invalid transitions: e.g., `idle + NAVIGATED` should fail
   - Pause boundary: verify `isPauseBoundary()` for correct states
   - Timeout lookup: verify per-state timeouts
   - Retry policy: verify per-state retry counts
   - FAIL event: valid from any non-terminal state

5. **`tests/test-storage-layer.js`** (~80 lines)
   - Save and load checkpoint roundtrip
   - Save and load versions
   - Purge run removes all keys
   - Purge all clears everything
   - Load returns null when empty
   - Settings save/load roundtrip

6. **`tests/test-failure-taxonomy.js`** (~50 lines)
   - All 14 codes exist
   - `classify()` returns correct retryable/resumable for each
   - Recovery matrix covers all phases

7. **`tests/test-context-strategies.js`** (~100 lines)
   - Each mode produces expected payload format
   - Payload estimation within 5% of actual
   - Auto-fallback triggers when over budget
   - Section batching splits correctly by headings
   - Section batching fallback to paragraph split

8. **`tests/test-quality-evaluator.js`** (~100 lines)
   - Identical texts: diff ratio = 0
   - Completely different texts: diff ratio close to 1
   - Small change: diff ratio > 0 and < MIN_DIFF_RATIO triggers stop
   - Hash match detection
   - Refusal detection: known patterns return true
   - Non-refusal text: return false
   - Early stop: combine signals correctly

9. **`tests/test-content-hasher.js`** (~40 lines)
   - Same text produces same hash
   - Different text produces different hash
   - Quick hash consistency
   - Empty string handling

10. **`tests/test-selector-registry.js`** (~80 lines)
    - Resolve with matching DOM: returns element + confidence
    - Resolve with no match: returns error + strategies tried
    - Priority ordering: higher priority tried first
    - Health update: failure degrades health
    - Diagnostics output: lists all strategies for capability

11. **Test corpus** (6 files):
    - `plain-text.md`: 500 words of prose
    - `structured-markdown.md`: h1-h4 headings, bullet lists, numbered lists, code fences, blockquotes
    - `code-heavy.md`: multiple code blocks in different languages
    - `tables-heavy.md`: markdown tables with varying columns
    - `long-document.md`: 10k+ words with mixed structure
    - `edge-whitespace.md`: tabs, multiple blank lines, trailing spaces, unicode

## Todo List

- [ ] Create `tests/` directory structure
- [ ] Create `tests/test-runner.js` minimal assertion framework
- [ ] Create `tests/mocks/chrome-storage-mock.js`
- [ ] Create `tests/mocks/dom-mock.js`
- [ ] Write FSM transition tests (all valid + invalid)
- [ ] Write storage layer tests (roundtrip, purge)
- [ ] Write failure taxonomy tests (all 14 codes)
- [ ] Write context strategy tests (4 modes, fallback)
- [ ] Write quality evaluator tests (diff, hash, refusal, stop)
- [ ] Write content hasher tests
- [ ] Write selector registry tests (resolve, health, diagnostics)
- [ ] Create 6 test corpus documents
- [ ] Verify all tests pass
- [ ] Verify each test file < 200 lines

## Success Criteria (maps to PRD Section 20 Acceptance Criteria)

1. 4-round happy-path: FSM transitions complete through all states
2. Pause/resume: checkpoint persisted, resume continues without duplicate
3. Reload recovery: checkpoint loaded, resumable state entered
4. Idempotent send: ACK check prevents duplicate
5. Extraction fidelity: test corpus documents preserved through hash comparison
6. Failure codes: all 14 classified correctly
7. Export: versions + manifest bundle generated
8. Selector diagnostics: full evidence per capability
9. Payload budget: warning and fallback triggered for large docs
10. Privacy: purge removes all stored data

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| No real Chrome API in Node.js tests | Medium | Comprehensive mocks; manual scenario testing in real extension |
| crypto.subtle not available in Node.js | Medium | Use Node.js `crypto` module as mock; or test hasher in browser only |
| DOM mock too simplistic for selector edge cases | Low | Focus on logic tests; real DOM testing done manually |
| Long-document test corpus bloats repo | Low | Generate programmatically in test setup rather than storing 10k-word file |
