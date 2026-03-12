---
phase: 5
title: "Context Strategies & Quality Evaluation"
status: pending
effort: 5h
---

# Phase 5: Context Strategies & Quality Evaluation

## Overview

Implement 4 review modes (full-rewrite, edit-in-place, delta-only, section-batched), payload estimation with budget warnings, auto-fallback, content hashing, diff ratio computation, and early stop evaluation.

**Priority:** P1 — enhances reliability and handles long documents.
**Depends on:** Phase 4 (orchestrator calls compose and evaluate hooks).

## Key Insights

- v2.0 has a single hardcoded compose pattern: `prompt + separator + lastContent`
- PRD requires 4 modes; `full-rewrite` is closest to v2.0 behavior
- `section-batched` requires full implementation: configurable section size, per-section processing, merge into single artifact
- Quality evaluation includes full rubric: structure, clarity, completeness, concision, caution dimensions per PRD
- Early stop saves API usage and prevents quality degradation from over-revision
- `crypto.subtle` available in service worker for hashing

## Requirements

### Functional
- 4 review modes with payload composition logic
- Payload size estimation before composition
- Budget warning when payload > MAX_PAYLOAD_CHARS
- Auto-fallback: switch from full-rewrite to edit-in-place or section-batched if over budget
- Record strategy used per round in VersionRecord
- Diff ratio: char-level edit distance ratio between consecutive versions
- Content hash comparison: detect unchanged output
- Early stop signals: diff below MIN_DIFF_RATIO, hash unchanged, refusal detected
- Early stop evaluation returns `{shouldStop, reason}`

### Non-Functional
- Context strategies < 200 lines
- Quality evaluator < 150 lines
- Rubric scorer < 180 lines
- Content hasher < 60 lines

## Architecture

```
lib/context-strategies.js
  - composePayload(mode, prompt, previousVersion, config) -> {payload, estimatedChars, strategy, warning?}
  - estimatePayload(mode, prompt, previousVersion) -> charCount
  - selectFallback(currentMode, payloadSize, config) -> newMode

lib/quality-evaluator.js
  - evaluate(currentVersion, previousVersion, config) -> {shouldStop, reason, metrics, rubric?}
  - computeDiffRatio(textA, textB) -> ratio (0-1)
  - detectRefusal(text) -> boolean
  - computeRubric(text) -> {structure, clarity, completeness, concision, caution}

lib/rubric-scorer.js
  - scoreStructure(text) -> 0-1 (heading hierarchy, list usage, code fences)
  - scoreClarity(text) -> 0-1 (sentence length distribution, passive voice ratio)
  - scoreCompleteness(text) -> 0-1 (section coverage, TODO markers absence)
  - scoreConcision(text) -> 0-1 (filler word ratio, redundancy)
  - scoreCaution(text) -> 0-1 (hedge word frequency, qualifier usage)

lib/content-hasher.js
  - hash(text) -> hex string (SHA-256)
  - quickHash(text) -> simple hash for fast comparison
```

## Related Code Files

| File | Action | Notes |
|------|--------|-------|
| `src/lib/context-strategies.js` | CREATE | Payload composition per mode |
| `src/lib/quality-evaluator.js` | CREATE | Diff, hash compare, early stop |
| `src/lib/content-hasher.js` | CREATE | SHA-256 utility |
| `src/lib/rubric-scorer.js` | CREATE | Full rubric scoring (structure, clarity, completeness, concision, caution) |
| `src/lib/run-lifecycle.js` | MODIFY | Hook compose and evaluate steps |

## Implementation Steps

1. **`src/lib/content-hasher.js`** (~50 lines)
   - `ContentHasher.hash(text)` — SHA-256 via `crypto.subtle.digest()`, returns hex
   - `ContentHasher.quickHash(text)` — simple DJB2 hash for fast inline checks, returns number
   - Note: `crypto.subtle` available in both service worker and content script (HTTPS context)

2. **`src/lib/context-strategies.js`** (~170 lines)

   a. Mode definitions:
   - `full_rewrite`: `"{prompt}\n\n---\n\n{previousVersion}"`
   - `edit_in_place`: `"{prompt}\n\nHere is the current document. Make targeted improvements while preserving structure:\n\n---\n\n{previousVersion}"`
   - `delta_only`: `"{prompt}\n\nFocus only on the following areas that need improvement. Provide specific changes, not the full document:\n\n---\n\nDocument length: {charCount} characters\nSection count: {sectionCount}\n\nKey areas to address:\n- [auto-detected from previous round's quality summary if available]"`
   - `section_batched`: split document by `## ` headings into chunks <= SECTION_SIZE chars; process each chunk with prompt

   b. `ContextStrategies.composePayload(mode, prompt, previousVersion, config)`:
   - Estimate size first
   - If over budget and AUTO_FALLBACK_STRATEGY: try fallback chain (full_rewrite -> edit_in_place -> delta_only)
   - Return `{payload, estimatedChars, strategyUsed, warning, fallbackApplied}`

   c. `ContextStrategies.estimatePayload(mode, prompt, previousVersion)`:
   - Sum: prompt.length + separator.length + version.length (mode-dependent)
   - Return char count

   d. `ContextStrategies.selectFallback(currentMode, payloadSize, config)`:
   - If full_rewrite over budget -> edit_in_place
   - If edit_in_place over budget -> delta_only
   - If delta_only over budget -> null (terminal, user must reduce)

   e. Full section batching:
   - Split by heading levels (h1, h2, h3) respecting hierarchy
   - If chunk > SECTION_SIZE: sub-split by next heading level or `\n\n`
   - If no headings: split by `\n\n` into chunks of SECTION_SIZE
   - Return array of `{sectionIndex, heading, content, charCount}`
   - `composeBatchedRound(prompt, sections, config)` — each section opens a NEW chat (fresh context per section), collects response, merges all into single artifact
   - Orchestrator calls `executeRound()` N times for N sections within one "round"
   - Track per-section metadata in VersionRecord (sectionResults array)
   - Merge strategy: concatenate section responses in original order, preserve headings

3. **`src/lib/quality-evaluator.js`** (~140 lines)

   a. `QualityEvaluator.evaluate(currentVersion, previousVersion, config)`:
   - Compute diff ratio
   - Compare content hashes
   - Check refusal
   - Aggregate stop signals:
     - `diff_ratio < MIN_DIFF_RATIO` → "Output nearly unchanged"
     - `contentHash === previousHash` → "Identical output"
     - `refusalDetected` → "Refusal detected"
   - Return `{shouldStop, reasons[], metrics: {diffRatio, hashMatch, refusal}}`

   b. `QualityEvaluator.computeDiffRatio(textA, textB)`:
   - Simple approach: Levenshtein distance / max(len(A), len(B))
   - For long texts (>10k chars): sample-based — compare first 2k + last 2k + 3 random 1k windows
   - Return ratio 0..1 (0 = identical, 1 = completely different)

   c. `QualityEvaluator.detectRefusal(text)`:
   - Check for known refusal patterns:
     - "I can't", "I cannot", "I'm unable to", "I apologize but"
     - Text length < 200 chars when previous version was > 1000
     - Empty or near-empty response
   - Return boolean (conservative: only flag clear refusals)

   d. Lightweight Levenshtein for short texts (<5k chars):
   - Standard DP algorithm
   - For longer texts: character frequency comparison as approximation

4. **`src/lib/rubric-scorer.js`** (~150 lines)

   a. `RubricScorer.score(text)` -> `{structure, clarity, completeness, concision, caution, overall}` (each 0-1)

   b. `scoreStructure(text)`:
   - Count heading levels, verify hierarchy (h1 > h2 > h3)
   - List presence and consistency (bullet vs numbered)
   - Code fence count and closure
   - Table presence and row consistency
   - Score: weighted average of checks

   c. `scoreClarity(text)`:
   - Sentence length distribution (median, p90)
   - Passive voice indicators ("was", "were", "been" + past participle patterns)
   - Transition word usage
   - Score: penalize very long sentences and high passive ratio

   d. `scoreCompleteness(text)`:
   - Section coverage: count non-empty sections
   - Absence of TODO/TBD/FIXME markers
   - Absence of placeholder text ("[insert here]", "...")
   - Min char count per section (not just headers with no content)

   e. `scoreConcision(text)`:
   - Filler word ratio: "very", "really", "basically", "actually", "just", "quite"
   - Repeated phrase detection (bigram/trigram frequency)
   - Words per section heading ratio

   f. `scoreCaution(text)`:
   - Hedge words: "might", "perhaps", "possibly", "could potentially"
   - Qualifier frequency
   - Double-negative detection
   - Score: moderate hedging is good (0.5-0.7 range optimal)

   g. `RubricScorer.trend(currentScores, previousScores)`:
   - Compare dimension-by-dimension
   - Return `{improving, stagnant, declining}` per dimension + overall

5. **Modify `src/lib/run-lifecycle.js`**:
   - In compose step: call `ContextStrategies.composePayload()` instead of hardcoded template
   - In evaluate step: call `QualityEvaluator.evaluate()`; if `shouldStop`, use EARLY_STOP event on FSM
   - Store `strategyUsed` and `qualitySummary` in VersionRecord

## Todo List

- [ ] Create `src/lib/content-hasher.js` with SHA-256 and quick hash
- [ ] Create `src/lib/context-strategies.js` with 4 review modes
- [ ] Implement payload estimation and budget checking
- [ ] Implement auto-fallback chain
- [ ] Implement section splitting for batched mode
- [ ] Create `src/lib/quality-evaluator.js` with diff ratio and early stop
- [ ] Implement refusal detection (conservative)
- [ ] Implement sampling-based diff for large texts
- [ ] Create `src/lib/rubric-scorer.js` with 5 dimensions + trend analysis
- [ ] Implement structure scoring (headings, lists, code fences, tables)
- [ ] Implement clarity scoring (sentence length, passive voice)
- [ ] Implement completeness scoring (section coverage, placeholder detection)
- [ ] Implement concision scoring (filler words, repetition)
- [ ] Implement caution scoring (hedge words, qualifiers)
- [ ] Implement rubric trend analysis (improving/stagnant/declining)
- [ ] Implement full section-batched: heading-aware splitting, sub-splitting, merge
- [ ] Hook compose and evaluate into run-lifecycle.js
- [ ] Store rubric scores in QualitySummary on VersionRecord
- [ ] Add rubric stagnation as early stop signal
- [ ] Verify each file < 200 lines

## Success Criteria

- All 4 review modes produce correct payload format
- Payload estimation within 5% of actual composed size
- Auto-fallback triggers when payload > MAX_PAYLOAD_CHARS
- Diff ratio correctly identifies low-change rounds
- Hash comparison detects identical outputs
- Refusal detection flags obvious refusals without false positives
- Early stop returns clear reason
- `section-batched` splits document reasonably by headings

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Levenshtein too slow for 100k+ char docs | Medium | Sampling-based approach for large texts |
| Auto-fallback produces worse prompt format | Low | Each mode's prompt is self-contained; test each |
| Section splitting breaks mid-paragraph | Low | Split on headings first; fallback to double-newline |
| Refusal detection false positives | Medium | Conservative patterns only; flag, don't auto-terminate |

## Security Considerations

- Content hashing is computation-only, no network calls
- Document content stays in local storage; no external transmission
