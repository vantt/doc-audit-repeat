---
phase: 1
title: "Project Restructure & Data Model"
status: pending
effort: 3h
---

# Phase 1: Project Restructure & Data Model

## Overview

Establish the foundation: create `src/lib/` module directory, define all data types via JSDoc, build storage abstraction, structured logger, and config defaults. Update manifest for v2.1.

**Priority:** P0 — blocks all subsequent phases.

## Key Insights

- v2.0 has no type definitions; all state is ad-hoc object literals in `background.js`
- PRD defines 4 core types: `RunState` (16+ fields), `VersionRecord`, `StepRecord`, `LogEvent`
- MV3 service worker loads libs via `importScripts()` at top level — all lib files must be self-contained (no import/export)
- Content script libs can use IIFE pattern or be loaded via manifest `js` array
- `chrome.storage.local` default 10MB; `unlimitedStorage` permission needed for large docs

## Requirements

### Functional
- All PRD data model types defined with JSDoc
- Storage layer: save/load/purge run state, save/load versions separately
- Checkpoint: atomic write of RunState to storage
- Logger: structured events with ts, runId, round, phase, code, level, msg, evidence
- Config: all 16 parameters from PRD Section 12 with defaults and ranges

### Non-Functional
- Each file < 200 lines
- No external dependencies
- All libs work in both service worker and content script contexts

## Architecture

```
src/
  lib/
    data-model.js       — enums, factory functions, JSDoc types
    storage-layer.js    — chrome.storage.local abstraction
    logger.js           — structured log engine
    config-defaults.js  — parameter definitions with defaults/ranges
  manifest.json         — updated
  background.js         — unchanged this phase (add importScripts later)
  content.js            — unchanged this phase
  popup.html            — unchanged this phase
  popup.js              — unchanged this phase
```

## Related Code Files

| File | Action | Notes |
|------|--------|-------|
| `src/manifest.json` | MODIFY | Bump version to 2.1.0, add `unlimitedStorage` |
| `src/lib/data-model.js` | CREATE | RunState, VersionRecord, StepRecord, LogEvent, enums |
| `src/lib/storage-layer.js` | CREATE | Checkpoint, load, purge, version artifact storage |
| `src/lib/logger.js` | CREATE | Structured logging with ring buffer |
| `src/lib/config-defaults.js` | CREATE | All config params with defaults, ranges, descriptions |

## Implementation Steps

1. Create `src/lib/` directory

2. **`src/lib/data-model.js`** (~120 lines)
   - Define enums as frozen objects: `RunStatus`, `ReviewMode`, `FailureCode`, `LogLevel`, `SelectorCapability`, `HealthState`
   - `RunStatus`: idle, validating, capturing_v1, navigating, composing, verifying_payload, sending, waiting_for_ack, waiting_for_completion, stabilizing, evaluating, checkpointing, paused, completed, failed
   - `ReviewMode`: full_rewrite, edit_in_place, delta_only, section_batched
   - Factory functions: `createRunState(overrides)`, `createVersionRecord(overrides)`, `createStepRecord(overrides)`, `createLogEvent(overrides)`
   - `generateId()` — simple unique ID generator (`Date.now().toString(36) + Math.random().toString(36).slice(2,7)`)
   - Export all via ES module `export { DataModel, RunStatus, ReviewMode, ... }`

3. **`src/lib/storage-layer.js`** (~150 lines)
   - Keys: `run_state` (hot), `run_versions_{runId}` (artifacts), `user_settings`
   - `StorageLayer.saveCheckpoint(runState)` — persist RunState
   - `StorageLayer.loadCheckpoint()` — load latest RunState or null
   - `StorageLayer.saveVersion(runId, versionRecord)` — append to version array
   - `StorageLayer.loadVersions(runId)` — load all versions for run
   - `StorageLayer.saveSettings(settings)` / `loadSettings()`
   - `StorageLayer.purgeRun(runId)` — delete run state + versions
   - `StorageLayer.purgeAll()` — delete everything
   - All methods return Promises (chrome.storage API is async)
   - Error handling: wrap in try/catch, return `{ok, error}` results

4. **`src/lib/logger.js`** (~100 lines)
   - `Logger` class with ring buffer (max 500 events)
   - `Logger.log(level, code, msg, context)` — context: `{runId, round, phase, evidence}`
   - Builds `LogEvent` via `DataModel.createLogEvent()`
   - `Logger.getLogs(since?)` — retrieve logs optionally filtered
   - `Logger.export()` — return all logs as JSON-serializable array
   - `Logger.clear()` — reset buffer
   - Console output: `[BG][level] code: msg` format
   - `export` as named export `Logger`

5. **`src/lib/config-defaults.js`** (~90 lines)
   - `CONFIG_SCHEMA` — object mapping param name to `{default, min, max, type, description}`
   - All 16 params from PRD Section 12
   - `ConfigDefaults.getDefaults()` — return default config object
   - `ConfigDefaults.validate(userConfig)` — clamp values to valid ranges, return sanitized config
   - `ConfigDefaults.merge(base, overrides)` — merge with validation

6. **`src/manifest.json`** modifications:
   - `"version": "2.1.0"`
   - Add `"unlimitedStorage"`, `"alarms"`, `"offscreen"` to `permissions` array
   - Add `"type": "module"` to background service_worker config
   - Add `src/lib/*.js` files to background service_worker via import (handled in Phase 4)
   - Add lib files to `content_scripts.js` array (handled in Phase 3)

## Todo List

- [ ] Create `src/lib/` directory
- [ ] Create `src/lib/data-model.js` with all enums and factory functions
- [ ] Create `src/lib/storage-layer.js` with checkpoint/version/settings/purge
- [ ] Create `src/lib/logger.js` with structured ring-buffer logging
- [ ] Create `src/lib/config-defaults.js` with all PRD params
- [ ] Update `src/manifest.json` — version bump + unlimitedStorage
- [ ] Verify all lib files are < 200 lines
- [ ] Verify libs work standalone (no import/export, global exposure)

## Success Criteria

- All 4 lib files created, syntactically valid JS
- `DataModel` provides factory functions for all PRD types
- `StorageLayer` can save/load checkpoint and versions
- `Logger` produces structured `LogEvent` objects
- `ConfigDefaults` covers all 16 PRD parameters with validation
- Manifest updated to 2.1.0 with `unlimitedStorage`
- No file exceeds 200 lines

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| ES module import resolution in MV3 SW | Medium | Use `"type": "module"` in manifest background config; requires Chrome 121+ |
| `chrome.storage.local` quota without `unlimitedStorage` | Medium | Permission added; also separate versions from hot state |
| No global namespace pollution | N/A | ES modules provide proper scoping via import/export |

## Security Considerations

- Storage layer must not store API keys or credentials
- Purge functions must be thorough (no orphaned keys)
- Version content stored as-is; no sanitization needed (user's own content)
