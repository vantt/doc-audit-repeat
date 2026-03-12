---
title: "v2.1 Durable Review Cycle"
description: "Upgrade Chrome extension from MVP to production-grade durable job execution with checkpointing, state machine, selector registry, and diagnostics"
status: pending
priority: P1
effort: 27h
branch: main
tags: [chrome-extension, refactor, feature]
created: 2026-03-12
---

# v2.1 Durable Review Cycle — Implementation Plan

## Summary

Upgrade AI Document Audit Repeat Chrome extension from v2.0 MVP (simple state, hardcoded selectors, no persistence) to v2.1 (16-state FSM, checkpointed execution, selector registry, context strategies, quality evaluation, failure taxonomy, diagnostic export, and privacy controls).

**PRD:** `docs/PRD_v2.1_Revised.md`

## Architecture Decisions

1. **No build tool** — plain JS Chrome extension (MV3), matches v2.0
2. **Modular `src/lib/`** — split monolithic files into <200-line focused modules
3. **Hand-rolled FSM** — no library, keep lightweight
4. **`chrome.storage.local`** for hot state + run metadata; `unlimitedStorage` for large docs
5. **ES modules for SW + popup** (`"type": "module"`). Content scripts use **manifest js array** (IIFE pattern, no module support). Requires Chrome 121+ (Jan 2024)
6. **Content script stays stateless** — re-injectable after navigation; libs loaded via manifest `content_scripts.js` array
7. **Alarms + offscreen document** — keep service worker alive during active run; offscreen sends periodic messages
8. **Section-batched = new chat per section** — fresh context per section, more predictable than same-chat
9. **Heuristic rubric** — regex/string-based scoring, no NLP libraries. Refine later if needed

## Module Dependency Graph

```
background.js (type: module)
  import from lib/state-machine.js (FSM engine)
  import from lib/run-lifecycle.js (round execution)
  import from lib/storage-layer.js (checkpoint/persist)
  import from lib/failure-taxonomy.js (codes, recovery)
  import from lib/context-strategies.js (payload composition)
  import from lib/quality-evaluator.js (diff, rubric, early stop)
  import from lib/rubric-scorer.js (5-dimension scoring)
  import from lib/content-hasher.js (SHA-256)
  import from lib/logger.js (structured logging)
  import from lib/config-defaults.js (params)
  import from lib/data-model.js (types/enums)

content.js (IIFE, manifest js array loading order)
  <- lib/selector-registry.js (strategy lookup, window.SelectorRegistry)
  <- lib/content-extraction.js (turn-aware extraction, window.ContentExtraction)

popup.js (type: module)
  import from lib/data-model.js (enums for display)
  import from lib/config-defaults.js (param ranges)
```

## Phase Summary

| # | Phase | Effort | Status | File |
|---|-------|--------|--------|------|
| 1 | Project Restructure & Data Model | 3h | pending | [phase-01](phase-01-restructure-data-model.md) |
| 2 | State Machine Engine | 3h | pending | [phase-02](phase-02-state-machine.md) |
| 3 | Selector Registry & Content Script | 4h | pending | [phase-03](phase-03-selector-registry.md) |
| 4 | Orchestrator (Durable Run Lifecycle) | 5h | pending | [phase-04](phase-04-orchestrator.md) |
| 5 | Context Strategies & Quality Evaluation | 5h | pending | [phase-05](phase-05-context-quality.md) |
| 6 | Popup UI Overhaul | 3h | pending | [phase-06](phase-06-popup-ui.md) |
| 7 | Testing & Acceptance Validation | 4h | pending | [phase-07](phase-07-testing.md) |

**Total estimated effort:** 27h

## Dependencies

- Phase 1 (foundation) blocks all others
- Phase 2 (FSM) blocks Phase 4 (orchestrator)
- Phase 3 (selectors) blocks Phase 4
- Phase 4 blocks Phase 5 (context/quality needs lifecycle hooks)
- Phases 4+5 block Phase 6 (UI needs final message types)
- All phases block Phase 7 (testing)

## Key Risks

| Risk | Mitigation |
|------|-----------|
| ES modules require Chrome 121+ | Acceptable — Chrome 121 shipped Jan 2024; 2+ years of adoption |
| Content script lib loading order | Manifest `content_scripts.js` array with correct order: registry → extraction → content.js |
| Popup lib loading | Use `<script type="module">` in popup.html |
| Claude.ai DOM changes mid-implementation | Selector registry with health tracking isolates breakage |
| Storage 10MB limit for `chrome.storage.local` | Request `unlimitedStorage`, store versions separately from hot state |
| Content script re-injection after navigate | Existing retry pattern works; registry adds confidence tracking |
| Service worker killed during long polling | Use `chrome.alarms` + `chrome.offscreen` API for reliable keepalive during active run |
| Large payload via chrome.tabs.sendMessage | Documents up to 120k chars (~480KB) well within message limits; warn at payload estimation |

## Open Questions (from PRD)

1. `section-batched` mode: merged artifact vs per-section only? **Recommend: single merged artifact in v2.1**
2. Auto-retry after `rate_limited`? **Recommend: require explicit resume**
3. Refusal detection aggressiveness? **Recommend: conservative, flag but don't auto-terminate**
4. Log redaction in diagnostic export? **Recommend: no redaction in v2.1, add warning label**
5. IndexedDB vs `chrome.storage.local`? **Recommend: start with storage.local + unlimitedStorage, migrate if needed**
6. Dry-run validation mode? **Recommend: defer to v2.2, not in scope**
