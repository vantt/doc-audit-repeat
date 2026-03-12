---
phase: 2
title: "State Machine Engine"
status: pending
effort: 3h
---

# Phase 2: State Machine Engine

## Overview

Implement a hand-rolled finite state machine with 16 states, guarded transitions, per-state timeouts, retry policies, checkpoint hooks, and cooperative pause model.

**Priority:** P0 — blocks Phase 4 (orchestrator).
**Depends on:** Phase 1 (data model, logger).

## Key Insights

- v2.0 uses simple string status (`idle/running/paused/done/error`); v2.1 needs 15 distinct states + `idle`
- FSM must be deterministic: every transition defines source, target, guard, timeout, retry policy
- Checkpoint hook fires at every critical phase boundary
- Pause is cooperative: `pauseRequested` flag checked at safe boundaries (after checkpoint, before nav, before send)
- FSM itself is stateless logic; actual state lives in RunState (persisted via StorageLayer)

## Requirements

### Functional
- Define all valid transitions between 15 states (PRD Section 7)
- Guard functions: conditions that must be true before transition
- Timeout per state with configurable durations
- Retry policy per state: max attempts, backoff
- Checkpoint callback at phase boundaries
- Pause check at safe boundaries
- Transition logging via Logger

### Non-Functional
- < 200 lines
- Pure logic, no side effects (side effects handled by orchestrator callbacks)
- Testable without Chrome APIs

## Architecture

```
StateMachine
  - transitions: Map<sourceState, Map<event, {target, guard?, timeout?}>>
  - onTransition(callback)     — hook for logging/checkpointing
  - transition(currentState, event, context) -> {newState, error?}
  - canTransition(currentState, event, context) -> boolean
  - getTimeout(state) -> ms
  - getRetryPolicy(state) -> {maxAttempts, backoffMs}
  - isPauseBoundary(state) -> boolean
```

**Event-driven transitions:**
- Events: `VALIDATED`, `V1_CAPTURED`, `NAVIGATED`, `COMPOSED`, `PAYLOAD_VERIFIED`, `SENT`, `ACK_RECEIVED`, `GENERATION_COMPLETE`, `STABILIZED`, `EVALUATED`, `CHECKPOINTED`, `PAUSE_REQUESTED`, `RESUME`, `FAIL`, `ROUND_COMPLETE`, `ALL_ROUNDS_COMPLETE`, `EARLY_STOP`

## Related Code Files

| File | Action | Notes |
|------|--------|-------|
| `src/lib/state-machine.js` | CREATE | FSM engine |
| `src/lib/data-model.js` | READ | Uses RunStatus enum |
| `src/lib/logger.js` | READ | Transition logging |

## Implementation Steps

1. **Define transition table** (~40 lines)
   - Map from `(currentState, event) -> targetState`
   - Key transitions:
     - `idle + START -> validating`
     - `validating + VALIDATED -> capturing_v1`
     - `capturing_v1 + V1_CAPTURED -> navigating`
     - `navigating + NAVIGATED -> composing`
     - `composing + COMPOSED -> verifying_payload`
     - `verifying_payload + PAYLOAD_VERIFIED -> sending`
     - `sending + SENT -> waiting_for_ack`
     - `waiting_for_ack + ACK_RECEIVED -> waiting_for_completion`
     - `waiting_for_completion + GENERATION_COMPLETE -> stabilizing`
     - `stabilizing + STABILIZED -> evaluating`
     - `evaluating + EVALUATED -> checkpointing`
     - `checkpointing + CHECKPOINTED -> navigating` (next round)
     - `checkpointing + ALL_ROUNDS_COMPLETE -> completed`
     - `checkpointing + EARLY_STOP -> completed`
     - Any state + `FAIL -> failed`
     - Safe boundaries + `PAUSE_REQUESTED -> paused`
     - `paused + RESUME -> {last safe state}`

2. **`StateMachine` object** (~80 lines)
   - `StateMachine.transition(currentStatus, event, context)` returns `{newStatus, valid}`
   - `context` carries: `{currentRound, totalRounds, pauseRequested, retryCount}`
   - Guards: e.g., `ROUND_COMPLETE` only valid when `currentRound < totalRounds`
   - `StateMachine.getTimeout(status, config)` — lookup per-state timeout from config
   - `StateMachine.getRetryPolicy(status)` — return `{maxAttempts, backoffMs}`
   - `StateMachine.isPauseBoundary(status)` — true for: `checkpointing`, `navigating`, `composing`

3. **Timeout configuration** (~20 lines)
   - `validating`: 10s
   - `capturing_v1`: 15s
   - `navigating`: 30s (nav timeout)
   - `composing`: 10s
   - `verifying_payload`: 5s
   - `sending`: 10s
   - `waiting_for_ack`: `config.ACK_TIMEOUT` (default 12s)
   - `waiting_for_completion`: `config.POLL_TIMEOUT` (default 600s)
   - `stabilizing`: `config.POLL_INTERVAL * config.STABLE_CHECKS * 2`
   - `evaluating`: 5s
   - `checkpointing`: 10s

4. **Retry policies** (~15 lines)
   - `navigating`: 3 attempts, 2s backoff
   - `composing`: 2 attempts, 1s backoff
   - `sending`: 1 attempt (idempotent check instead)
   - `waiting_for_ack`: 3 attempts, 3s backoff
   - `waiting_for_completion`: 1 attempt (timeout-based)
   - Others: 2 attempts, 1s backoff default

5. **Expose as global** `StateMachine` object

## Todo List

- [ ] Create `src/lib/state-machine.js`
- [ ] Define complete transition table
- [ ] Implement `transition()` with guard checking
- [ ] Implement `getTimeout()` with config integration
- [ ] Implement `getRetryPolicy()` per state
- [ ] Implement `isPauseBoundary()` for cooperative pause
- [ ] Verify file < 200 lines
- [ ] Verify all PRD states and transitions covered

## Success Criteria

- All 15 states + idle present in transition table
- `transition()` rejects invalid state+event combos
- Pause boundaries match PRD Section 7.3 (after checkpoint, before nav, before send)
- Retry policies defined for all retryable states
- Timeouts use config values where applicable
- Pure logic, no Chrome API calls

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Missing transition causes stuck state | High | Exhaustive transition table; `FAIL` event always valid from any state |
| Resume after pause needs correct re-entry point | Medium | Store `resumeToken` (last safe state) in RunState before pausing |
| Timeout values too aggressive for slow connections | Low | All timeouts configurable via config params |
