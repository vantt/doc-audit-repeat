---
phase: 4
title: "Orchestrator (Durable Run Lifecycle)"
status: pending
effort: 5h
---

# Phase 4: Orchestrator (Durable Run Lifecycle)

## Overview

Major rewrite of `background.js` around the FSM. Implements checkpointing at every phase boundary, idempotent send with payload hash + acknowledgement, resume from checkpoint, service worker restart recovery, retry budget management, and failure taxonomy with recovery matrix.

**Priority:** P0 — core execution engine.
**Depends on:** Phase 1 (data model, storage, logger, config), Phase 2 (FSM), Phase 3 (content actions).

## Key Insights

- v2.0 `background.js` (377 lines) is a single monolithic file with inline cycle logic, no checkpointing, no idempotent send, no failure codes
- v2.0 `runCycle()` is a single async function with linear flow; errors just set `status = "error"`
- MV3 service worker can restart at any time; must recover from checkpoint on `chrome.runtime.onStartup` / `onInstalled`
- `importScripts()` must be called synchronously at top level of service worker
- Phase 4 is the largest phase; split orchestration logic into `background.js` (message routing, recovery) and `lib/run-lifecycle.js` (round execution)

## Requirements

### Functional
- FSM-driven execution: each step is a state transition
- Checkpoint at every phase boundary via StorageLayer
- Idempotent send: payload hash before insert, editor verification before click, ACK detection after click, retry checks ACK first
- Resume from checkpoint: load RunState, validate tab, check prior side-effect, continue
- Service worker restart: `onStartup` handler loads checkpoint, enters resumable state
- Retry budget: per-state max attempts, decrement on failure, terminal when exhausted
- Failure taxonomy: 14 failure codes from PRD Section 9 mapped to retryable/resumable/terminal
- Recovery matrix: per-phase safe-to-retry and safe-to-resume flags
- Cooperative pause: check `pauseRequested` at FSM pause boundaries

### Non-Functional
- `background.js` < 200 lines (message routing, init, recovery)
- `lib/run-lifecycle.js` < 200 lines (round step execution)
- `lib/failure-taxonomy.js` < 120 lines (codes, policies)

## Architecture

```
background.js (entry point)
  importScripts('lib/data-model.js', 'lib/config-defaults.js',
                'lib/logger.js', 'lib/storage-layer.js',
                'lib/state-machine.js', 'lib/failure-taxonomy.js',
                'lib/run-lifecycle.js')

  - onStartup/onInstalled: attempt recovery from checkpoint
  - onMessage: START_RUN, PAUSE_RUN, RESUME_RUN, RESET_RUN, GET_STATE, EXPORT_RUN, DEBUG_SELECTORS
  - broadcastState() to popup
  - delegates round execution to RunLifecycle

lib/run-lifecycle.js
  - RunLifecycle.startRun(runState) — init + validate + capture V1
  - RunLifecycle.executeRound(runState) — nav -> compose -> verify -> send -> ack -> wait -> stabilize -> evaluate -> checkpoint
  - Each step: transition FSM, execute action, handle result, checkpoint
  - Uses sendToContent() from background for DOM actions
```

## Related Code Files

| File | Action | Notes |
|------|--------|-------|
| `src/background.js` | REWRITE | Message routing, recovery, imports |
| `src/lib/run-lifecycle.js` | CREATE | Round execution steps |
| `src/lib/failure-taxonomy.js` | CREATE | Failure codes, recovery rules |

## Implementation Steps

1. **`src/lib/failure-taxonomy.js`** (~100 lines)

   a. `FailureTaxonomy.CODES` — frozen object mapping code -> `{meaning, retryable, resumable, userAction}`
   - All 14 codes from PRD Section 9.1: tab_missing, domain_mismatch, page_not_ready, selector_not_found, editor_input_rejected, payload_verification_failed, send_not_acknowledged, stream_timeout, empty_response, refusal_detected, rate_limited, worker_restarted, storage_write_failed, unknown_runtime_error

   b. `FailureTaxonomy.RECOVERY_MATRIX` — per-phase: `{safeToRetry, safeToResume, notes}`

   c. `FailureTaxonomy.classify(failureCode)` -> `{retryable, resumable, terminal, userAction}`

   d. `FailureTaxonomy.getRecovery(phase, failureCode)` -> `{action, description}`

2. **`src/lib/run-lifecycle.js`** (~190 lines)

   a. `RunLifecycle.init(deps)` — receive references to: `sendToContent`, `broadcastState`, `navigateTab`

   b. `RunLifecycle.startRun(runState)`:
   - Transition: idle -> validating
   - Validate tab exists and is claude.ai
   - Transition: validating -> capturing_v1
   - Send `EXTRACT_TURN` to content, store as V1
   - Compute content hash for V1
   - Transition: capturing_v1 -> checkpointing
   - Save checkpoint
   - Begin first automated round

   c. `RunLifecycle.executeRound(runState)`:
   - Check pauseRequested at entry (pause boundary)
   - **Navigate:** transition -> navigating, call navigateTab, wait DELAY_AFTER_NAV
   - **Compose:** transition -> composing, build payload per reviewMode (delegate to context strategy in Phase 5; use full-rewrite default here)
   - **Verify:** transition -> verifying_payload, send `COMPOSE_EDITOR` to content, then `VERIFY_EDITOR_PAYLOAD` with expected hash
   - **Send:** transition -> sending, record stepId, send `CLICK_SEND`
   - **ACK:** transition -> waiting_for_ack, poll for new user turn (max ACK_TIMEOUT)
   - **Wait:** transition -> waiting_for_completion, poll `CHECK_COMPLETION` until not generating
   - **Stabilize:** transition -> stabilizing, require STABLE_CHECKS consecutive stable polls
   - **Evaluate:** transition -> evaluating, extract final response via `EXTRACT_TURN`, compute hash (quality eval deferred to Phase 5)
   - **Checkpoint:** transition -> checkpointing, save version + run state
   - Check: if all rounds done -> completed; if early stop -> completed; else -> next round

   d. Each step wrapped in try/catch:
   - Catch maps error to FailureCode
   - Check retry budget for current phase
   - If retryable and budget remains: retry step
   - If resumable: checkpoint and transition to failed
   - If terminal: transition to failed, preserve versions

   e. `RunLifecycle.resumeRun(runState)`:
   - Load checkpoint
   - Determine resume point from `resumeToken` (last completed phase)
   - Validate tab
   - Check if prior side-effect occurred (e.g., was send already ACK'd?)
   - Continue from next step

3. **Rewrite `src/background.js`** (~180 lines)

   a. ES module imports at top:
   ```js
   import { DataModel, RunStatus, ReviewMode } from './lib/data-model.js';
   import { ConfigDefaults } from './lib/config-defaults.js';
   import { Logger } from './lib/logger.js';
   import { StorageLayer } from './lib/storage-layer.js';
   import { StateMachine } from './lib/state-machine.js';
   import { FailureTaxonomy } from './lib/failure-taxonomy.js';
   import { RunLifecycle } from './lib/run-lifecycle.js';
   ```
   Manifest: `"background": {"service_worker": "background.js", "type": "module"}`

   b. Init: `RunLifecycle.init({sendToContent, broadcastState, navigateTab})`

   c. Recovery on startup:
   ```js
   chrome.runtime.onStartup.addListener(async () => {
     const saved = await StorageLayer.loadCheckpoint();
     if (saved && saved.status !== 'idle' && saved.status !== 'completed' && saved.status !== 'failed') {
       Logger.log('warn', 'worker_restarted', 'Service worker restarted, run in progress');
       // Mark as resumable, don't auto-resume
       saved.failureCode = 'worker_restarted';
       saved.status = 'failed'; // user must click Resume
       await StorageLayer.saveCheckpoint(saved);
     }
   });
   ```

   d. Message handler:
   - `START_RUN`: create RunState via DataModel, merge config, call `RunLifecycle.startRun()`
   - `PAUSE_RUN`: set `runState.pauseRequested = true` (cooperative)
   - `RESUME_RUN`: load checkpoint, call `RunLifecycle.resumeRun()`
   - `RESET_RUN`: confirm versions preserved, reset to idle, purge if requested
   - `GET_STATE`: return current RunState
   - `EXPORT_RUN`: return versions + logs + config as bundle
   - `DEBUG_SELECTORS`: forward `INSPECT_PAGE` to content

   e. **Keepalive: alarms + offscreen document** during active run:
   ```js
   // Start keepalive when run begins
   chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }); // every 24s
   chrome.alarms.onAlarm.addListener((alarm) => {
     if (alarm.name === 'keepalive') { /* noop, refreshes SW timer */ }
   });
   // Create offscreen document for reliable keepalive
   await chrome.offscreen.createDocument({
     url: 'offscreen.html',
     reasons: ['WORKERS'],
     justification: 'Keep service worker alive during document review run'
   });
   // offscreen.html sends periodic messages to SW every 20s
   // Clear both when run completes/fails/pauses
   chrome.alarms.clear('keepalive');
   chrome.offscreen.closeDocument();
   ```
   Add `"alarms"`, `"offscreen"` to manifest permissions.
   Create `src/offscreen.html` + `src/offscreen.js` (~20 lines each — periodic ping to SW).

   f. `sendToContent(tabId, action, data)` — same retry pattern as v2.0 but with structured error returns

   f. `broadcastState()` — same pattern, send RunState snapshot to popup

   g. `navigateTab(tabId, url)` — same as v2.0

## Todo List

- [ ] Create `src/lib/failure-taxonomy.js` with 14 codes and recovery matrix
- [ ] Create `src/lib/run-lifecycle.js` with startRun/executeRound/resumeRun
- [ ] Implement idempotent send: hash -> verify -> click -> ACK check
- [ ] Implement checkpoint at every phase boundary
- [ ] Implement retry budget tracking per phase
- [ ] Implement cooperative pause at FSM boundaries
- [ ] Implement resume from checkpoint with side-effect detection
- [ ] Rewrite `src/background.js` with importScripts and message routing
- [ ] Implement service worker restart recovery
- [ ] Verify each file < 200 lines
- [ ] Test importScripts loading order

## Success Criteria

- Full round lifecycle: navigate -> compose -> verify -> send -> ACK -> wait -> stabilize -> evaluate -> checkpoint
- Checkpoint persisted at every phase boundary
- Idempotent send: no duplicate sends when retry occurs after ACK
- Resume from checkpoint continues from correct step
- Service worker restart: run marked as resumable, not auto-resumed
- Failure codes mapped correctly per PRD taxonomy
- Retry budget decremented and terminal when exhausted
- Cooperative pause transitions at safe boundaries only
- Background.js, run-lifecycle.js, failure-taxonomy.js each < 200 lines

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| importScripts() fails if path wrong | High | Test immediately; use relative paths from SW root |
| Service worker killed during checkpoint write | High | StorageLayer uses atomic write pattern; worst case resume from prior checkpoint |
| ACK detection races with page updates | Medium | Poll with timeout; conservative ACK_TIMEOUT default (12s) |
| Resume logic complex with many edge cases | High | Store explicit resumeToken (last completed phase + round); test each resume scenario |
| Multiple rapid START_RUN clicks | Low | Guard: reject START if status !== idle |

## Security Considerations

- No credentials or API keys in run state
- Checkpoint data contains document content — covered by privacy mode (Phase 6)
- Service worker restart doesn't leak state to unauthorized contexts
