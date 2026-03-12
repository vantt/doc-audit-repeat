# PRD: AI Document Audit Repeat — Chrome Extension

**Version:** 2.1.0  
**Status:** Revised Draft  
**Date:** March 12, 2026  
**Owner:** Product / Engineering  

> Chrome extension for durable, checkpointed, iterative document review on Claude.ai.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Overview](#2-product-overview)
3. [Goals, Non-Goals, and Success Metrics](#3-goals-non-goals-and-success-metrics)
4. [User Journey](#4-user-journey)
5. [System Architecture](#5-system-architecture)
6. [Data Model](#6-data-model)
7. [Run Lifecycle and State Machine](#7-run-lifecycle-and-state-machine)
8. [Functional Requirements](#8-functional-requirements)
9. [Failure Taxonomy and Recovery Matrix](#9-failure-taxonomy-and-recovery-matrix)
10. [Non-Functional Requirements](#10-non-functional-requirements)
11. [Detailed Use Cases](#11-detailed-use-cases)
12. [Configuration Parameters](#12-configuration-parameters)
13. [Security, Privacy, and Permissions](#13-security-privacy-and-permissions)
14. [Selector Strategy Registry](#14-selector-strategy-registry)
15. [Observability and Diagnostics](#15-observability-and-diagnostics)
16. [Testing Strategy](#16-testing-strategy)
17. [Risks and Mitigations](#17-risks-and-mitigations)
18. [Roadmap](#18-roadmap)
19. [Technical Constraints and Dependencies](#19-technical-constraints-and-dependencies)
20. [Acceptance Criteria](#20-acceptance-criteria)
21. [Open Questions](#21-open-questions)

---

## 1. Executive Summary

### 1.1 Problem Statement

When users refine long-form documents on Claude.ai, they often repeat the same loop many times:

1. capture the latest output,
2. open a new chat,
3. paste the document back with a review prompt,
4. send,
5. wait,
6. repeat.

This workflow is slow, error-prone, mentally disruptive, and especially painful for long business plans, PRDs, technical writeups, and structured reports.

### 1.2 Proposed Solution

Build a Chrome extension named **AI Document Audit Repeat** that automates multi-round document review directly inside Claude.ai web. The user performs the first run manually to control the initial prompt and quality bar. The extension then executes subsequent rounds as a **durable, checkpointed job** with explicit recovery, versioning, diagnostics, and export.

### 1.3 Why v2.1 Exists

Version 2.0 established a workable MVP architecture, but it still treated the product mainly as DOM automation. Version 2.1 upgrades the design into a more production-grade system by introducing:

- a durable job model,
- explicit state machine transitions,
- idempotent send safeguards,
- resume-from-checkpoint behavior,
- higher-fidelity extraction,
- adaptive context strategies,
- failure taxonomy and recovery rules,
- stronger privacy and observability.

### 1.4 Core Value Proposition

- **Preserves Claude web behavior:** no separate API integration, no separate prompt stack.
- **Automates repeated review loops:** less manual copy/paste, lower task friction.
- **Improves reliability:** protects against duplicate sends, reloads, and selector breakage.
- **Produces usable artifacts:** saves each version with metadata, diffability, and export.
- **Stays local-first:** runs in-browser with minimal permissions and no external data transport.

---

## 2. Product Overview

### 2.1 Target Users

| Persona | Description | Primary Need |
|---|---|---|
| Consultant | Iterates on strategy decks, business plans, client memos | Multiple refinement passes with minimal manual work |
| Founder / PM | Revises PRDs, specs, strategy docs, launch plans | Better structure, clarity, and completeness across rounds |
| Researcher | Revises technical reports, literature summaries, analyses | Stronger logic, organization, and readability |
| Writer / Editor | Polishes long-form content and editorial drafts | Repeated improvement with version history |
| Power User | Runs repetitive AI workflows on long documents | Durable automation and operational trust |

### 2.2 Product Principles

- **Human-controlled first pass:** the user owns the initial prompt and first output.
- **Automation after certainty:** automated loops begin only after V1 is accepted as the starting point.
- **Reliability over cleverness:** the product should prefer safe recovery over fragile speed hacks.
- **Traceability by default:** every round should be inspectable, attributable, and exportable.
- **Quality-aware execution:** more rounds are not always better; the product should be able to stop early.

### 2.3 Primary User Problem

Users do not merely need “automation.” They need **trustworthy iterative refinement** that:

- does not silently send duplicates,
- does not lose progress on reload,
- does not degrade output fidelity,
- does not force them to babysit every round,
- still leaves them with clear artifacts and evidence of what happened.

---

## 3. Goals, Non-Goals, and Success Metrics

### 3.1 Goals

1. Automate iterative review from V2 onward with minimal manual intervention.
2. Preserve each completed version with metadata and export.
3. Survive navigation, reload, popup close, and service worker restart through checkpointed execution.
4. Prevent duplicate sends and false completion states.
5. Support long documents with configurable polling, timeouts, and adaptive context strategies.
6. Provide diagnostics sufficient to troubleshoot selector failures and runtime issues.

### 3.2 Non-Goals

1. Replacing Claude.ai’s native capabilities or system prompts.
2. Supporting arbitrary websites outside Claude.ai in v2.1.
3. Full semantic quality evaluation that guarantees “better” writing in every round.
4. Rich attachment workflows such as file upload automation in v2.1.
5. Multi-tab parallel execution in v2.1.
6. Cross-account cloud sync in v2.1.

### 3.3 Success Metrics

| Metric | Target | Priority |
|---|---:|---|
| Happy-path round completion rate | >= 95% | P0 |
| Duplicate-send rate | 0 in test suite; < 0.1% field target | P0 |
| State recovery success after reload / worker restart | >= 90% | P1 |
| False-success rate (marked complete but wrong / truncated output) | < 1% | P0 |
| Extraction fidelity for headings / lists / code fences | >= 99% preservation in test corpus | P1 |
| Median round latency for 10k-word document | Tracked and reported by mode | P1 |
| Time to identify selector failure using diagnostics | <= 5 minutes | P1 |
| User task reduction vs manual loop | >= 70% fewer manual actions after round 1 | P1 |

### 3.4 Product Outcome Definition

A run is successful when the extension completes the planned rounds or stops early according to policy, while preserving correct artifacts, avoiding duplicate messages, and leaving enough logs and metadata for inspection.

---

## 4. User Journey

### 4.1 Phase 1 — Manual First Run

The user opens Claude.ai, optionally inside a project, submits the initial review prompt plus source content, and waits for Claude to complete the first answer. This first answer becomes **V1**, the starting point for automation.

### 4.2 Phase 2 — Configure Extension

The user opens the extension popup and configures:

- review prompt for subsequent rounds,
- total rounds,
- execution mode,
- context strategy,
- timeout behavior,
- early-stop behavior,
- export preferences.

The extension validates the current tab, identifies whether it is inside a project context, and displays readiness status.

### 4.3 Phase 3 — Automated Execution

The extension extracts V1, creates a run record, checkpoints its initial state, opens a new chat in the same project context if applicable, composes the next payload according to the selected context strategy, sends the message, waits for generation completion, validates the output, stores the next version, checkpoints again, then repeats.

### 4.4 Phase 4 — Review, Resume, or Download

The user can:

- monitor live progress,
- pause after the current round,
- resume from the latest checkpoint,
- inspect logs and diagnostics,
- download individual versions,
- download all artifacts,
- inspect change summaries.

### 4.5 Phase 5 — Finish or Reset

At completion, pause, or failure, the run remains inspectable. The user may reset the run only after artifacts are preserved or intentionally discarded.

---

## 5. System Architecture

### 5.1 Design Principles

- **Tab-locked execution:** the extension operates on one fixed Claude.ai tab ID.
- **Durable job execution:** every run is a persisted job with checkpoints.
- **Explicit state machine:** transitions are finite, guarded, and logged.
- **Separation of concerns:** orchestration, DOM interaction, and UI remain separated.
- **Idempotent actions:** actions that can cause side effects, especially send, must be safe to retry.
- **Selector resilience:** DOM targeting is managed through a registry of strategies, not a single selector string.
- **Observability first:** every important action should leave structured evidence.

### 5.2 Three-Layer Architecture

| Layer | File | Responsibility |
|---|---|---|
| Orchestrator | `background.js` or `service_worker.js` | Owns state, job lifecycle, checkpointing, retries, recovery, and popup broadcasts |
| DOM Agent | `content.js` | Performs DOM discovery, extraction, typing, clicking, and completion-state detection |
| Control Panel | `popup.html` + `popup.js` | Displays status, accepts commands, shows logs, artifacts, and diagnostics |

### 5.3 Supporting Components

| Component | Responsibility |
|---|---|
| Storage Layer | Persists run state, settings, and artifacts in `chrome.storage.local` or IndexedDB |
| Selector Registry | Stores strategy groups, priorities, health state, and diagnostics metadata |
| Exporter | Packages versions, metadata, logs, and optional change summaries |
| Quality Evaluator | Computes lightweight stop signals and rubric metadata |
| Diagnostics Engine | Produces structured logs, failure codes, and selector debug bundles |

### 5.4 Communication Model

- **Popup -> Background:** `START_RUN`, `PAUSE_RUN`, `RESUME_RUN`, `RESET_RUN`, `GET_STATE`, `EXPORT_RUN`, `DEBUG_SELECTORS`
- **Background -> Content:** `EXTRACT_TURN`, `COMPOSE_EDITOR`, `VERIFY_EDITOR_PAYLOAD`, `CLICK_SEND`, `CHECK_COMPLETION`, `INSPECT_PAGE`, `FIND_NEW_CHAT_TARGET`
- **Content -> Background:** result payloads with `ok`, `data`, `failureCode`, `evidence`, `timings`
- **Background -> Popup:** state snapshots, log events, progress updates, diagnostic summaries

### 5.5 Architectural Decision Highlights

1. **Background owns the run state** because popup and content script lifetimes are not durable enough.
2. **Content script remains stateless** so re-injection after navigation or reload is simpler.
3. **Checkpointing happens at every critical phase boundary** to support resume and recovery.
4. **Send is modeled as a side-effecting action with acknowledgement** rather than as a fire-and-forget click.

---

## 6. Data Model

### 6.1 Top-Level Run Object

```ts
RunState {
  runId: string;
  status: RunStatus;
  tabId: number | null;
  projectUrl: string | null;
  startedAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
  reviewPrompt: string;
  totalRounds: number;
  currentRound: number;
  reviewMode: ReviewMode;
  config: RunConfig;
  retryBudget: RetryBudget;
  pauseRequested: boolean;
  resumeToken: string | null;
  failureCode: FailureCode | null;
  failureDetail: string | null;
  lastCheckpointAt: number | null;
  versions: VersionRecord[];
  logs: LogEvent[];
  diagnostics: DiagnosticBundleSummary[];
}
```

### 6.2 Run Status Enum

```ts
idle |
validating |
capturing_v1 |
navigating |
composing |
verifying_payload |
sending |
waiting_for_ack |
waiting_for_completion |
stabilizing |
evaluating |
checkpointing |
paused |
completed |
failed
```

### 6.3 Version Record

```ts
VersionRecord {
  round: number;
  rawText: string;
  normalizedText: string;
  charCount: number;
  lineCount: number;
  contentHash: string;
  extractionConfidence: number;
  extractionSource: string;
  turnId: string | null;
  startedAt: number | null;
  completedAt: number;
  strategyUsed: ReviewMode;
  payloadHash: string | null;
  qualitySummary: QualitySummary | null;
}
```

### 6.4 Step Record

```ts
StepRecord {
  stepId: string;
  round: number;
  phase: RunStatus;
  attempts: number;
  startedAt: number;
  endedAt: number | null;
  success: boolean | null;
  failureCode: FailureCode | null;
}
```

### 6.5 Log Event

```ts
LogEvent {
  ts: number;
  level: "debug" | "info" | "warn" | "error";
  code: string;
  msg: string;
  runId: string;
  round: number | null;
  phase: RunStatus | null;
  evidence?: Record<string, unknown>;
}
```

### 6.6 Storage Principles

- Keep the latest run state persisted after every checkpoint.
- Separate large artifacts from hot state where practical.
- Support user-selected retention policy: persistent or ephemeral.
- Persist enough metadata to resume safely, even when popup is closed.

---

## 7. Run Lifecycle and State Machine

### 7.1 Lifecycle Overview

Each run follows a deterministic lifecycle:

1. `validating`
2. `capturing_v1`
3. `navigating`
4. `composing`
5. `verifying_payload`
6. `sending`
7. `waiting_for_ack`
8. `waiting_for_completion`
9. `stabilizing`
10. `evaluating`
11. `checkpointing`
12. repeat or exit to `paused`, `completed`, or `failed`

### 7.2 State Machine Rules

Every transition must define:

- entry conditions,
- timeout,
- retry policy,
- checkpoint behavior,
- visible user log,
- terminal vs resumable failure behavior.

### 7.3 Pause Model

Pause is cooperative. When the user requests pause, the system sets `pauseRequested = true` and completes the current safe boundary before transitioning to `paused`. Safe boundaries are:

- after a version is checkpointed,
- before navigation begins,
- before a new send attempt begins.

### 7.4 Resume Model

Resume is available in v2.1 and must:

1. load the latest checkpoint,
2. validate tab and domain,
3. validate whether the prior side effect already occurred,
4. continue from the next safe step without duplicate send.

### 7.5 Early Stop Model

A run may stop before `totalRounds` when all enabled stop checks agree that continuing is unlikely to help. Possible stop signals:

- diff ratio below threshold,
- content hash unchanged or near-unchanged,
- rubric score no longer improves,
- repeated refusal or empty-response detection,
- payload budget exceeded and no valid fallback strategy remains.

### 7.6 Idempotent Send Contract

Send must satisfy all of the following:

1. payload hash is computed before insertion,
2. editor content is verified against the intended payload,
3. `roundId` and `stepId` are recorded before click,
4. after click, the extension waits for acknowledgement of a new user turn,
5. retries must first check whether acknowledgement already occurred.

If acknowledgement already exists, the step must not click send again.

### 7.7 Completion Contract

A round is complete only when all of the following are true:

- generation has ended,
- the latest assistant turn is stable across `STABLE_CHECKS`,
- extracted content passes non-empty validation,
- the extracted turn is not obviously a system notice or refusal placeholder unless explicitly allowed,
- the new version has been checkpointed successfully.

---

## 8. Functional Requirements

### 8.1 FR-1: Tab Detection and Locking

1. Detect the active Claude.ai tab when the popup opens.
2. Validate domain and basic page readiness.
3. Lock a single `tabId` for the run.
4. Re-validate the locked tab before every DOM interaction.
5. Detect project-scoped context and preserve navigation inside the same project when applicable.
6. Reject start if the tab is missing, wrong domain, or obviously incompatible.

### 8.2 FR-2: Run Initialization

1. Create a new `runId` and initialize persisted run state.
2. Store the configured prompt, mode, round count, and policies.
3. Extract the current Claude answer as candidate V1.
4. Validate V1 before allowing execution to continue.
5. Create the first checkpoint before the first automated navigation.

### 8.3 FR-3: Turn-Aware Response Extraction

1. Identify the latest completed assistant turn, not merely the last DOM container.
2. Ignore incomplete streaming turns and non-answer UI notices.
3. Preserve structure as faithfully as possible, including headings, lists, code fences, blockquotes, tables, and paragraph breaks.
4. Store both `rawText` and `normalizedText`.
5. Compute `contentHash`, `charCount`, `lineCount`, and `extractionConfidence`.
6. Include extraction evidence for debugging: selector/strategy used, node count, and turn metadata.

### 8.4 FR-4: New Chat Navigation

1. Open a new chat in the same project scope where possible.
2. Wait for page readiness and editor availability after navigation.
3. Re-inject or re-handshake with the content script if needed.
4. Fail with a specific code if a new chat target cannot be found.
5. Preserve run state across navigation.

### 8.5 FR-5: Context Strategy and Payload Composition

The extension must support the following review modes:

- `full-rewrite`: send prompt + full prior version.
- `edit-in-place`: send prompt instructing targeted revision while keeping structure.
- `delta-only`: send prompt + selected change instructions + minimal prior context.
- `section-batched`: split the document into bounded sections and process iteratively.

Requirements:

1. Estimate payload size before each round.
2. Warn when payload exceeds configured budget.
3. Switch strategy automatically if auto-fallback is enabled.
4. Record the strategy used per round.
5. Preserve stable delimiters in the composed payload so verification is reliable.

### 8.6 FR-6: Editor Interaction

1. Insert text using DOM-native approaches compatible with the editor.
2. Avoid reliance on the system clipboard as the default path.
3. Dispatch the minimum required input events for editor recognition.
4. Detect and verify the send button using strategy sets and heuristics.
5. Wait for temporary disabled states up to configured timeout.
6. Fail specifically if the editor rejects the payload or if the send button cannot be safely invoked.

### 8.7 FR-7: Payload Verification

1. Verify that the editor contains the intended payload before sending.
2. Compare normalized editor content against the planned payload hash.
3. Refuse send if verification fails.
4. Log a verification failure with evidence.

### 8.8 FR-8: Idempotent Send and Post-Send Acknowledgement

1. Assign each round a unique `roundId`.
2. Record each send attempt with a unique `stepId`.
3. After click, verify that a new user turn appears.
4. Do not resend if prior acknowledgement is detected.
5. Distinguish between “button clicked” and “message accepted by the page.”

### 8.9 FR-9: Response Completion and Stability Detection

1. Detect ongoing generation using strategy groups rather than a single selector.
2. Support stop-button, streaming-marker, and content-growth heuristics.
3. Require stability across a configurable number of polls.
4. Enforce a configurable timeout.
5. Retry content script handshake where safe.
6. Escalate to a specific timeout or empty-response failure when warranted.

### 8.10 FR-10: Version Management

1. Save every completed version with metadata immediately after extraction.
2. Maintain immutable per-round artifacts.
3. Support downloading individual versions as `revision_vN.md`.
4. Support downloading all versions plus metadata in one bundle.
5. Support optional change summaries and a machine-readable manifest.

### 8.11 FR-11: Pause, Resume, Reset

1. Start a new run after successful validation.
2. Pause at the next safe boundary.
3. Resume from the latest checkpoint without duplicate send.
4. Reset only after explicit confirmation if artifacts exist.
5. Preserve completed versions across pause and failure.

### 8.12 FR-12: Quality Evaluation and Early Stop

1. Optionally compute lightweight quality signals after each round.
2. Support rubric dimensions such as structure, clarity, completeness, concision, and caution.
3. Support early stop when improvement is negligible.
4. Surface stop reasons in the UI and export manifest.

### 8.13 FR-13: Error Handling and Recovery Guidance

1. Every failure must map to a standardized `failureCode`.
2. Each failure must declare whether it is retryable, resumable, or terminal.
3. The UI must show a recovery suggestion, not just a raw error.
4. Completed versions must remain downloadable after failure.

### 8.14 FR-14: Export and Artifact Packaging

1. Export version files, metadata manifest, and logs.
2. Support optional diagnostic bundle export.
3. Include per-version hashes and timestamps in the manifest.
4. Preserve enough metadata for offline auditability.

### 8.15 FR-15: Diagnostics and Selector Debugging

1. Expose “Debug selectors” from the popup.
2. Show which selector strategies matched for editor, send button, completion state, and assistant turn.
3. Allow export of a selector diagnostic bundle as JSON.
4. Surface confidence and failure evidence, not just pass/fail.

---

## 9. Failure Taxonomy and Recovery Matrix

### 9.1 Standard Failure Codes

| Failure Code | Meaning | Retryable | Resumable | Typical User Action |
|---|---|---:|---:|---|
| `tab_missing` | Locked tab no longer exists | No | Yes | Reopen Claude tab or choose current compatible tab |
| `domain_mismatch` | Current page is not Claude.ai | No | Yes | Return to Claude.ai |
| `page_not_ready` | DOM not ready after navigation | Yes | Yes | Wait / retry |
| `selector_not_found` | Required capability could not find a DOM target | Sometimes | Yes | Run selector diagnostics; update strategy |
| `editor_input_rejected` | Editor did not accept or preserve payload | Yes | Yes | Retry with alternate input strategy |
| `payload_verification_failed` | Editor content does not match intended payload | Yes | Yes | Retry composition or reduce content |
| `send_not_acknowledged` | Click may have occurred but a new user turn was not confirmed | Yes | Yes | Resume will first check for acknowledgement |
| `stream_timeout` | Generation did not complete in time | Sometimes | Yes | Retry or increase timeout |
| `empty_response` | Assistant turn completed but content is empty or unusable | Sometimes | Yes | Retry or inspect Claude response |
| `refusal_detected` | Claude refused or returned a safety template | No | Yes | Adjust prompt or stop run |
| `rate_limited` | Claude quota / rate limit behavior detected | No | Yes | Wait and resume later |
| `worker_restarted` | Service worker lifecycle interrupted execution | N/A | Yes | Resume from checkpoint |
| `storage_write_failed` | Checkpoint or artifact persistence failed | Sometimes | No | Free storage / retry |
| `unknown_runtime_error` | Unexpected runtime exception | Sometimes | Yes | Inspect logs and retry |

### 9.2 Recovery Principles

- Never retry a send without checking whether acknowledgement already happened.
- Prefer checkpoint-based resume over re-running a whole round.
- Preserve completed versions even after terminal failure.
- Show the user the most likely next step in human-readable language.

### 9.3 Recovery Matrix by Phase

| Phase | Safe to Auto-Retry | Safe to Resume | Notes |
|---|---:|---:|---|
| `validating` | Yes | Yes | No side effects yet |
| `capturing_v1` | Yes | Yes | Read-only phase |
| `navigating` | Yes | Yes | Must re-validate page readiness |
| `composing` | Yes | Yes | Must clear stale editor state before retry |
| `verifying_payload` | Yes | Yes | No send allowed until verified |
| `sending` | With acknowledgement check | Yes | High-risk side effect boundary |
| `waiting_for_ack` | Yes | Yes | Must inspect whether send already happened |
| `waiting_for_completion` | Sometimes | Yes | Timeout may require user judgment |
| `stabilizing` | Yes | Yes | Read-only, safe |
| `evaluating` | Yes | Yes | Internal logic only |
| `checkpointing` | Sometimes | Sometimes | Depends on storage error severity |

---

## 10. Non-Functional Requirements

| ID | Requirement | Metric | Priority |
|---|---|---|---|
| NFR-1 | Idle extension must not materially degrade Claude.ai performance | < 5 ms overhead on idle observers | P0 |
| NFR-2 | Content script handshake after navigation must succeed reliably | <= 8 retries within <= 12 s default envelope | P0 |
| NFR-3 | Run state must survive navigation and popup close | 100% in test scenarios | P0 |
| NFR-4 | Long documents must be supported with configurable timeout and strategy fallback | 10k+ words supported under documented limits | P1 |
| NFR-5 | Popup must remain usable on narrow screens | 380 px width minimum | P1 |
| NFR-6 | Diagnostics must isolate selector failures quickly | <= 1 click to access, <= 5 min to localize | P1 |
| NFR-7 | Manifest V3 compatibility | MV3 compliant | P0 |
| NFR-8 | Happy-path round completion reliability | >= 95% | P0 |
| NFR-9 | Duplicate send rate | 0 in automated testing; target < 0.1% in field | P0 |
| NFR-10 | False success rate | < 1% | P0 |
| NFR-11 | Recovery success after worker restart or reload | >= 90% | P1 |
| NFR-12 | Extraction fidelity for structured markdown | >= 99% preserve for headings, lists, code fences | P1 |
| NFR-13 | Log and artifact persistence should not block UI responsiveness | No visible popup freeze > 200 ms | P1 |
| NFR-14 | Storage growth must remain controlled | Retention policy and export/delete controls present | P1 |

---

## 11. Detailed Use Cases

### UC-1: Happy Path — Full Cycle Completion

1. User opens Claude.ai inside project “Q2 Strategy”.
2. User manually sends the initial review prompt with the source document.
3. User waits for Claude to finish and opens the extension popup.
4. The extension validates the tab and displays project-aware readiness.
5. User sets review prompt, total rounds = 4, review mode = `full-rewrite`.
6. The extension extracts V1, creates run state, checkpoints, and navigates to a new chat.
7. It composes prompt + V1, verifies payload, clicks send, confirms acknowledgement, waits for completion, and stores V2.
8. The process repeats for V3 and V4.
9. The run completes, shows summaries, and exports artifacts.

### UC-2: Pause and Resume

1. User starts a 5-round run.
2. During round 3, user clicks Pause.
3. The extension finishes the current safe boundary, checkpoints V3, and transitions to `paused`.
4. Later, the user returns and clicks Resume.
5. The extension loads the checkpoint and continues from round 4 without re-sending round 3.

### UC-3: Browser Reload During Execution

1. A run is in `waiting_for_completion`.
2. The popup is closed and the tab reloads unexpectedly.
3. The service worker restarts and loads the latest checkpoint.
4. The run enters resumable state with `worker_restarted` recorded.
5. Resume checks whether the last send had already been acknowledged and continues safely.

### UC-4: Selector Breakage After Claude UI Change

1. The editor strategy registry fails to locate the input field.
2. The extension returns `selector_not_found` scoped to `editor` capability.
3. The popup surfaces selector diagnostics and evidence.
4. The run remains resumable; prior completed versions remain available.

### UC-5: Long Document Triggers Payload Budget Warning

1. The user attempts a 6-round full rewrite on a very long document.
2. Payload estimation predicts context pressure.
3. The extension warns and proposes `section-batched` mode.
4. The user accepts; subsequent rounds run by section with separate metadata.

### UC-6: Refusal or Empty Response

1. Claude completes a turn that is empty or clearly a refusal template.
2. The extension detects the failure and marks the run `failed` or `paused-for-user-action` depending on config.
3. The UI shows a recommended next step: adjust prompt, retry, or stop.

---

## 12. Configuration Parameters

| Parameter | Default | Range / Values | Description |
|---|---:|---|---|
| `DELAY_AFTER_NAV` | 4000 ms | 2000–10000 | Wait after navigating to a new chat |
| `DELAY_BEFORE_SEND` | 800 ms | 300–3000 | Wait before clicking Send |
| `DELAY_AFTER_SEND` | 3000 ms | 1000–10000 | Wait after send before polling |
| `POLL_INTERVAL` | 2500 ms | 1000–5000 | Poll interval for completion checks |
| `POLL_TIMEOUT` | 600000 ms | 60000–1200000 | Max wait for response completion |
| `STABLE_CHECKS` | 3 | 2–5 | Consecutive stable polls required |
| `REVIEW_MODE` | `full-rewrite` | `full-rewrite`, `edit-in-place`, `delta-only`, `section-batched` | Context strategy |
| `MAX_PAYLOAD_CHARS` | 120000 | 20000–300000 | Budget threshold for warnings / fallback |
| `SECTION_SIZE` | 8000 | 2000–20000 | Section size for batched mode |
| `EARLY_STOP_ENABLED` | `true` | boolean | Enables stop conditions |
| `MIN_DIFF_RATIO` | 0.02 | 0–1 | Minimum diff ratio to justify continuation |
| `RUBRIC_MODE` | `off` | `off`, `lightweight`, `full` | Quality evaluation mode |
| `ACK_TIMEOUT` | 12000 ms | 3000–30000 | Max time to wait for post-send acknowledgement |
| `INPUT_STRATEGY_ORDER` | auto | ordered list | Preferred editor insertion methods |
| `PERSISTENCE_MODE` | `persistent` | `persistent`, `ephemeral` | Artifact retention policy |
| `AUTO_FALLBACK_STRATEGY` | `true` | boolean | Allows automatic strategy downgrade for large payloads |

---

## 13. Security, Privacy, and Permissions

### 13.1 Permissions

| Permission | Reason |
|---|---|
| `storage` | Persist run state, user settings, and artifacts |
| `tabs` | Detect and operate on the locked Claude.ai tab |
| `scripting` | Re-establish script execution after navigation where needed |
| `host: https://claude.ai/*` | Restrict execution to Claude.ai |

### 13.2 Security and Privacy Principles

- **Minimal permissions only.**
- **No external requests by default.** All execution stays local to the browser and Claude.ai web.
- **No API keys.**
- **Domain-restricted execution.**
- **Explicit retention policy.** Users can choose persistent or ephemeral storage mode.
- **One-click purge.** Users can delete all stored run data and artifacts.
- **Sensitive-content awareness.** The UI should warn users that private document content is being automated inside a web interface and may remain in browser storage unless deleted.

### 13.3 Privacy Modes

#### Persistent Mode

- saves versions and logs until the user deletes them,
- supports resume across sessions,
- best for debugging and auditability.

#### Ephemeral Mode

- minimizes local retention,
- keeps only the minimum state required during the run,
- deletes or aggressively prunes artifacts after export or completion based on policy.

### 13.4 Clipboard Policy

The default product path must not rely on the system clipboard, both for reliability and privacy reasons. Clipboard-based methods may exist only as an explicitly documented fallback strategy if required.

---

## 14. Selector Strategy Registry

### 14.1 Rationale

Claude.ai DOM is an external dependency and the primary fragility point. Selectors in v2.1 must be managed as a **registry of strategies**, not a loose list of fallbacks.

### 14.2 Capability Groups

| Capability | Purpose |
|---|---|
| `editor` | Locate the active editor and verify writability |
| `sendButton` | Locate and validate the send control |
| `completionState` | Detect generation in-progress vs complete |
| `assistantTurn` | Identify the latest completed assistant turn |
| `newChatTarget` | Find a safe target for new conversation navigation |

### 14.3 Strategy Record Shape

```ts
SelectorStrategy {
  id: string;
  capability: Capability;
  priority: number;
  version: string;
  enabled: boolean;
  selector?: string;
  heuristic?: string;
  confidenceBase: number;
  notes?: string;
}
```

### 14.4 Diagnostic Requirements

Every selector capability must log:

- strategy IDs attempted,
- selector strings or heuristic labels,
- match count,
- selected node evidence,
- confidence score,
- failure reason if no strategy succeeded.

### 14.5 Health Management

The registry should support a lightweight concept of health:

- `healthy`
- `degraded`
- `suspect`
- `broken`

This status is diagnostic only in v2.1, but prepares the ground for future auto-repair.

---

## 15. Observability and Diagnostics

### 15.1 Logging Requirements

All important events must be logged with structured fields:

- timestamp,
- runId,
- round,
- phase,
- event code,
- severity,
- human-readable message,
- optional evidence.

### 15.2 Event Types

At minimum, log:

- run started,
- round started,
- checkpoint written,
- navigation complete,
- payload verified,
- send acknowledged,
- completion timeout,
- selector failure,
- resume initiated,
- run paused,
- run completed,
- run failed.

### 15.3 Diagnostic Bundle Export

The extension should support exporting a JSON diagnostic bundle containing:

- current config,
- run metadata,
- selector diagnostics,
- failure record,
- timing summaries,
- hashes and counts,
- redacted evidence where feasible.

### 15.4 User-Facing Debug Surface

The popup should show:

- current phase,
- current round,
- last successful checkpoint,
- latest failure code if any,
- recommended action,
- link or button to export diagnostics.

---

## 16. Testing Strategy

### 16.1 Test Layers

1. **Unit tests**
   - state transitions,
   - stop conditions,
   - payload hashing,
   - retry and acknowledgement logic.

2. **Integration tests**
   - background/content messaging,
   - checkpoint persistence,
   - resume behavior,
   - export packaging.

3. **DOM contract tests**
   - selector registry capability checks,
   - editor insertion,
   - turn extraction fidelity.

4. **Scenario / E2E tests**
   - happy path,
   - pause/resume,
   - reload recovery,
   - selector breakage,
   - timeout,
   - refusal detection,
   - long-document strategy fallback.

### 16.2 Required Test Scenarios

| Scenario | Expected Result |
|---|---|
| Popup closed during run | Run continues or remains resumable |
| Tab reload during `waiting_for_completion` | Resume works without duplicate send |
| Send click succeeded but ACK delayed | No duplicate resend before ACK check |
| Claude UI changes one selector | Failure localized to capability, diagnostics available |
| Empty response returned | Round fails with `empty_response` |
| Payload too large | Warning or auto-fallback strategy triggers |
| Pause requested during polling | Transition to `paused` at safe boundary |

### 16.3 Test Corpus

A test corpus should include:

- plain text documents,
- heavily structured markdown,
- code-heavy content,
- tables,
- very long documents,
- documents with edge-case whitespace and delimiters.

---

## 17. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Claude.ai UI changes break DOM assumptions | High | Selector registry, diagnostics, capability-scoped failures |
| Service worker lifecycle interrupts long runs | High | Checkpointed state machine, resumable execution |
| Duplicate send corrupts the run | High | Payload verification, post-send acknowledgement, idempotent send rules |
| Long documents exceed practical context budget | High | Payload estimation, review modes, section batching, warnings |
| Editor rejects inserted text | Medium | Alternate input strategies and verification before send |
| Claude rate limits or quota issues | Medium | Detect rate-limit patterns, pause/resume flow, user guidance |
| False completion detection leads to truncated output | Medium | Multi-signal completion checks + stability window |
| Local storage accumulates sensitive artifacts | Medium | Retention modes, purge controls, user notice |
| Diagnostics are too weak to troubleshoot field failures | Medium | Structured logs, diagnostic export, selector evidence |

---

## 18. Roadmap

### 18.1 Included in v2.1

- checkpointed execution,
- resume from pause,
- idempotent send safeguards,
- failure taxonomy,
- adaptive context strategies,
- diagnostics improvements,
- quality-aware early stop,
- selector registry.

### 18.2 Phase 2 — Near Term

- side-by-side diff viewer in popup,
- automatic change summary between versions,
- custom prompt per round,
- quota / payload warnings with richer UX,
- branchable runs from any prior version.

### 18.3 Phase 3 — Medium Term

- export to `.docx` and `.pdf`,
- reusable prompt/config templates,
- richer quality scoring and trend analysis,
- project-level run history,
- optional multi-document orchestration.

### 18.4 Phase 4 — Long Term

- selector auto-repair suggestions,
- adaptive strategy tuning from historical run outcomes,
- richer semantic diffing,
- broader site support if product strategy expands.

---

## 19. Technical Constraints and Dependencies

### 19.1 Browser Requirements

- Chrome or Chromium-based browser,
- Manifest V3 support,
- Service worker lifecycle constraints accepted,
- permission model compatible with tab-scoped extension execution.

### 19.2 External Dependencies

- Claude.ai web UI and DOM structure,
- user’s Claude account and quota availability,
- network stability during long-running sessions.

### 19.3 Known Limitations in v2.1

- no attachment upload automation,
- no guaranteed semantic judgment that later versions are “better,”
- still dependent on third-party DOM stability,
- single-run / single-tab focus,
- browser storage is not a replacement for enterprise-grade document management.

---

## 20. Acceptance Criteria

The PRD is considered implementation-ready for v2.1 when the delivered product satisfies all of the following:

1. A 4-round happy-path run can complete on Claude.ai without manual intervention after round 1.
2. Pause and resume work from checkpoint without duplicate send.
3. Reloading during execution does not lose completed versions.
4. The system prevents or safely recovers from ambiguous send states.
5. Structured extraction preserves headings, lists, and code fences at the defined quality threshold.
6. Failure codes are surfaced consistently with recovery guidance.
7. Users can export versions plus a manifest.
8. Selector diagnostics are accessible from the popup.
9. Long-document warnings and at least one fallback review mode are implemented.
10. Privacy retention policy and data purge controls are exposed to the user.

---

## 21. Open Questions

1. Should `section-batched` mode produce one merged artifact or per-section artifacts only in v2.1?
2. Should the product allow automatic retry after `rate_limited`, or require explicit user resume?
3. How aggressive should refusal detection be to avoid false positives?
4. Should logs be redacted by default in diagnostic export when sensitive content is present?
5. Is IndexedDB needed for large artifact storage in the first implementation, or is `chrome.storage.local` sufficient?
6. Should the product support a “dry run validation” mode that inspects selectors and payload budget without sending anything?

---

*End of Document*
