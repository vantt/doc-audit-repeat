---
phase: 6
title: "Popup UI Overhaul"
status: pending
effort: 3h
---

# Phase 6: Popup UI Overhaul

## Overview

Upgrade popup to support review mode selection, context strategy config, early stop toggle, live phase display (16 states mapped to user-friendly labels), failure code with recovery suggestions, diagnostic export, privacy controls, and enhanced version list.

**Priority:** P1 — user-facing controls for all new features.
**Depends on:** Phases 4+5 (final message types and RunState shape).

## Key Insights

- v2.0 popup: 255 lines HTML + 263 lines JS; warm-toned design with Vietnamese text
- v2.0 has 5 status badges (idle/running/done/paused/error); v2.1 needs 16-state display
- v2.0 settings panel has 4 config fields; v2.1 adds review mode, early stop, privacy mode
- Preserve Vietnamese text convention from v2.0
- 380px width constraint; need careful layout for new controls
- Keep popup.html CSS inline (no build tool)

## Requirements

### Functional
- Review mode dropdown: full-rewrite, edit-in-place, delta-only, section-batched
- Early stop toggle (checkbox) + min diff ratio slider/input
- Context strategy info: payload estimate display, fallback indicator
- Phase-aware status: map 16 states to user-friendly Vietnamese labels + icons
- Failure display: failure code, human-readable description, recovery suggestion
- Diagnostic export button: download JSON bundle
- Privacy mode selector: persistent/ephemeral radio
- One-click purge button with confirmation
- Enhanced version list: per-version hash (truncated), confidence, strategy used
- Export all: versions + manifest JSON
- Resume button (when status is failed + resumable)

### Non-Functional
- popup.html < 200 lines (extract long CSS to inline `<style>` block, keep structure lean)
- popup.js < 200 lines
- Preserve warm-toned design language
- Vietnamese UI text

## Architecture

```
popup.html — structure + CSS
popup.js — controller
  reads: DataModel enums (for status labels)
  reads: ConfigDefaults (for param ranges in settings)
  sends: START_RUN, PAUSE_RUN, RESUME_RUN, RESET_RUN, GET_STATE, EXPORT_RUN, DEBUG_SELECTORS
  receives: STATE_UPDATE broadcasts
```

Note: popup can load lib files via `<script>` tags before `popup.js`.

## Related Code Files

| File | Action | Notes |
|------|--------|-------|
| `src/popup.html` | REWRITE | New UI sections, load lib scripts |
| `src/popup.js` | REWRITE | New controls, diagnostic export, privacy |

## Implementation Steps

1. **State label mapping** (in popup.js, ~20 lines)
   ```
   STATUS_LABELS = {
     idle: 'San sang',
     validating: 'Dang kiem tra...',
     capturing_v1: 'Trich xuat V1...',
     navigating: 'Mo chat moi...',
     composing: 'Soan payload...',
     verifying_payload: 'Kiem tra payload...',
     sending: 'Gui message...',
     waiting_for_ack: 'Doi xac nhan...',
     waiting_for_completion: 'Doi Claude tra loi...',
     stabilizing: 'Kiem tra on dinh...',
     evaluating: 'Danh gia chat luong...',
     checkpointing: 'Luu trang thai...',
     paused: 'Tam dung',
     completed: 'Hoan thanh',
     failed: 'Loi'
   }
   ```

2. **popup.html new sections** (~200 lines total):

   a. **Setup view additions** (after prompt textarea):
   - Review mode dropdown: `<select id="review-mode">` with 4 options
   - Early stop row: checkbox `<input id="early-stop" type="checkbox" checked>` + min diff ratio `<input id="min-diff" type="number" value="0.02" step="0.01">`
   - Privacy mode: `<select id="privacy-mode">` persistent/ephemeral

   b. **Running view upgrades**:
   - Phase display: `<div id="phase-display">` showing current phase label + icon
   - Round info enhanced: show strategy used for current round
   - Failure panel (hidden by default): `<div id="failure-panel">` with code, description, recovery suggestion, resume button
   - Version list enhanced: each version shows truncated hash, confidence badge, strategy tag

   c. **Footer actions**:
   - Export all button: versions + manifest
   - Diagnostic export button
   - Purge button with confirmation dialog

   d. **Script tags** before popup.js:
   ```html
   <script src="lib/data-model.js"></script>
   <script src="lib/config-defaults.js"></script>
   <script src="popup.js"></script>
   ```

3. **popup.js rewrite** (~195 lines):

   a. Init: same tab detection pattern, load settings from storage

   b. `renderState(state)`:
   - Status badge: use STATUS_LABELS mapping
   - Phase display: show current phase with Vietnamese label
   - Progress bars: same pattern, enhanced with strategy indicator
   - Failure panel: if `state.failureCode`, show code + description from FailureTaxonomy + recovery suggestion
   - Resume button: visible when failed + resumable (check FailureTaxonomy.classify)
   - Version list: show hash (first 8 chars), confidence (color-coded), strategy tag
   - Log area: same dark terminal style

   c. Event listeners:
   - Start: collect reviewMode, earlyStop, minDiffRatio, privacyMode from new controls
   - Pause: same
   - Resume: send `RESUME_RUN`
   - Reset: confirm if versions exist, send `RESET_RUN`
   - Export all: send `EXPORT_RUN`, receive bundle, trigger download as JSON
   - Diagnostic export: send `DEBUG_SELECTORS`, download response as JSON
   - Purge: confirm dialog, send `PURGE_ALL`
   - Settings: expand to show all config params with ranges from ConfigDefaults

   d. Download helpers:
   - `downloadVersion(v)`: same pattern, filename `revision_v{round}.md`
   - `downloadBundle(bundle)`: JSON blob download as `run_{runId}_export.json`
   - `downloadDiagnostics(data)`: JSON blob as `diagnostics_{timestamp}.json`

## Todo List

- [ ] Design status label mapping for 16 states (Vietnamese)
- [ ] Add review mode dropdown to setup view
- [ ] Add early stop toggle and min diff ratio input
- [ ] Add privacy mode selector
- [ ] Implement phase-aware status display in running view
- [ ] Implement failure panel with code + recovery suggestion
- [ ] Add resume button for resumable failures
- [ ] Enhance version list with hash, confidence, strategy
- [ ] Add export all button (versions + manifest JSON)
- [ ] Add diagnostic export button
- [ ] Add purge button with confirmation
- [ ] Load lib scripts in popup.html
- [ ] Rewrite popup.js with new controls and message types
- [ ] Verify popup.html and popup.js each < 200 lines
- [ ] Test 380px width layout with new controls

## Success Criteria

- All 16 states display correct Vietnamese label
- Review mode selection sent to background with START_RUN
- Early stop config sent and reflected in run behavior
- Failure panel shows failure code + recovery suggestion when failed
- Resume button works for resumable failures
- Export produces JSON bundle with versions + metadata
- Diagnostic export produces JSON with selector diagnostics
- Purge deletes all stored data after confirmation
- Privacy mode persisted to settings
- Layout fits 380px width without horizontal scroll

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Too many controls for 380px width | Medium | Use collapsible sections; advanced config behind toggle |
| popup.html exceeds 200 lines with all CSS | Medium | Extract repetitive CSS patterns; compress selectors |
| popup.js exceeds 200 lines | Medium | Move download helpers to separate utility if needed |
| Vietnamese text incorrect | Low | Keep existing v2.0 text patterns; verify with native speaker |

## Security Considerations

- Purge must be thorough — no orphaned storage keys
- Diagnostic export should note it may contain selector details (not sensitive)
- Privacy mode "ephemeral" must actually delete data after export/completion
