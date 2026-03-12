# AGENTS.md — Operating Manual for Multi-Agent Development

> Operating rules for AI coding agents working in this repository.

This repository is expected to run with  **multiple agents participating at the same time** .

That is not an edge case. That is the normal operating mode.

The goals of this file are simple:

* protect the repo from destructive mistakes,
* prevent multi-agent collisions,
* keep work traceable,
* keep the codebase clean,
* and make every session end in a truly landed state.

---

## RULE 0 - THE FUNDAMENTAL OVERRIDE PREROGATIVE

If the user gives a direct instruction in the current session,  **follow it** .

Defaults in this file are defaults. They are not an excuse to ignore a clear instruction.

However, destructive-action safety rules still apply. A direct instruction does **not** erase the need for explicit confirmation before any irreversible command.

---

## RULE NUMBER 1: NO FILE DELETION

**YOU ARE NEVER ALLOWED TO DELETE A FILE OR DIRECTORY WITHOUT EXPRESS PERMISSION.**

That includes:

* files you created yourself,
* test files,
* temp files,
* generated files,
* scratch scripts,
* and whole folders.

You do **not** get to decide that something is "obviously safe" to remove.

If deletion seems appropriate, stop and ask. You must receive clear written permission **in this session** before any deletion happens.

---

## Irreversible Git & Filesystem Actions — DO NOT EVER BREAK GLASS

The following are forbidden unless the user provides the **exact command** and explicitly approves it in the same session:

* `git reset --hard`
* `git clean -fd`
* `rm -rf`
* force-overwrite or destructive migration commands
* any command that can delete or irreversibly overwrite code or data

Rules:

1. **No guessing.** If you are not 100% sure what a command will affect, do not run it.
2. **Safer alternatives first.** Prefer `git status`, `git diff`, `git stash`, backups, copies, or other non-destructive paths.
3. **Mandatory explicit restatement.** After approval, restate the exact command and list exactly what it will affect.
4. **Wait for confirmation.** Do not execute until the user confirms your understanding is correct.
5. **Document the audit trail.** When a destructive command is run, record:
   * the exact user text authorizing it,
   * the exact command run,
   * and when it was run.

If that audit trail is missing, the operation must be treated as if it never happened.

---

## Git Branch: ONLY Use `main`, NEVER `master`

**The default branch is `main`.**

Rules:

* All work happens on `main` unless the repo explicitly says otherwise.
* Never introduce references to `master` in code or docs.
* If this repo intentionally mirrors `main` to `master` for legacy compatibility, keep them synchronized after push:

```bash
git push origin main:master
```

---

## Generated Files — NEVER Edit Manually

If a file is generated, do not hand-edit the generated artifact unless the repo explicitly says to do so.

Instead:

* find the source of truth,
* update the source,
* re-run generation,
* and document the generation command when useful.

If the repo commits generated artifacts, this file should document where they live and how they are produced.

---

## Code Editing Discipline

### No File Proliferation

If you want to change behavior, **revise existing code files in place** whenever that is the right design.

Do **not** create fear-driven variants like:

* `mainV2.rs`
* `main_improved.rs`
* `main_enhanced.rs`
* `foo_new.py`
* `bar_fixed_final.js`

New files are for  **genuinely new functionality or boundaries** . The bar for adding files is high.

### No Backwards-Compatibility Clutter By Default

We optimize for the correct design, not temporary coexistence.

Unless the user explicitly asks otherwise:

* do not add compatibility shims,
* do not preserve deprecated wrappers,
* do not keep dead APIs around,
* migrate callers and remove the old path cleanly.

### No Brittle Bulk Edits

**NEVER** run ad-hoc scripts that bulk-modify code in this repo. Brittle regex rewrites, giant `sed` chains, and one-off transformation logic create far more problems than they solve.

Preferred approach:

* subtle or risky changes: edit carefully by hand,
* many simple changes: break them into smaller explicit edits and review diffs closely,
* large repetitive changes: use parallel subagents rather than a blind bulk rewrite,
* structured rewrites: use syntax-aware tools only when the rewrite is well-bounded, reviewable, and materially safer than hand-editing.

When in doubt, edit manually.

### `ast-grep` vs `rg`

Use `ast-grep` when  **structure matters** .

Use `rg` when  **text is enough** .

Rule of thumb:

* need correctness on code structure or a safe structural rewrite → `ast-grep`
* need fast discovery or literal/regex hunting → `rg`
* often combine them: `rg` to narrow candidates, `ast-grep` to inspect or rewrite precisely

---

## Compiler Checks (CRITICAL)

**After any substantive code changes, you MUST verify no errors were introduced.**

Use the repo's real quality gates. At minimum, cover:

* build or typecheck,
* lint or static analysis,
* tests,
* and E2E tests if the repo has them.

Suggested examples by stack:

```bash
# Rust
cargo check --all-targets
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo test

# Go
go build ./...
go vet ./...
go test ./...

# TypeScript / JavaScript
bun typecheck
bun lint
bun test

# E2E (if present)
./scripts/e2e_test.sh
```

Do not claim completion while known failures remain unless the user explicitly accepts them.

---

## Third-Party Library Usage

If you are not fully sure how a third-party library or tool works, check current docs and examples before using it.

Do not guess APIs when verification is cheap.

---

## Node / JS Toolchain

For JavaScript / TypeScript work in this repo:

* Use **bun** for everything JS/TS.
* Never introduce `npm`, `yarn`, or `pnpm` unless the repo explicitly requires one.
* Lockfiles: only `bun.lock`.
* Target current Node.js unless the repo explicitly requires older compatibility.
* `bun install -g <pkg>` is valid syntax. Do not “fix” it.

---

## Project Architecture

Document the actual system at a glance:

* main components,
* boundaries,
* data flow,
* major packages/apps/services,
* where tests live,
* and where generated artifacts come from.

Suggested structure:

* **Backend** — framework, DB, entrypoints, core modules
* **Frontend** — framework, routing, state/data layer, UI system
* **Shared** — contracts, schemas, common utilities, config
* **Infra / scripts** — deployment, CI, local dev, generators

---

## Repo Layout

```text
<repo>/
├── README.md
├── AGENTS.md
├── .beads/              # Issue tracking state
├── src/                 # Source code
└── ...
```

---

## Console Output

* Prefer  **structured, minimal logs** .
* Avoid spammy debug output unless it is actively needed.
* Treat user-facing UX as UI-first; logs are for operators and debugging.

---

## Multi-Agent Coordination Protocol

This section is the heart of the operating model.

In this repository:

* concurrent work is normal,
* coordination is mandatory,
* and ambiguity must be resolved through the shared systems below rather than through guesswork.

### 1) Working Tree Reality — This Is Not An Emergency

In a multi-agent environment, unrelated edits in the working tree are normal.

Rules:

* Do **not** stash, revert, overwrite, or "clean up" changes just because you did not personally create them.
* Treat unexpected edits as legitimate concurrent work unless the user explicitly tells you otherwise.
* Work around them carefully and preserve them.
* Do **not** stop the session just to ask anxious questions about unrelated modified files unless there is a real blocking conflict.

### 2) MCP Agent Mail — Multi-Agent Communication and File Coordination

Agent Mail is a mail-like coordination layer for coding agents.

What it provides:

* identities,
* inbox/outbox,
* searchable threads,
* advisory file reservations,
* and human-auditable coordination artifacts.

Use Agent Mail for what it actually is:

* agent-to-agent communication,
* thread-based coordination,
* file reservation / lease signaling,
* and readable handoff history.

#### Same-Repository Workflow

1. **Register identity**
   ```text
   ensure_project(project_key=<abs-path>)
   register_agent(project_key, program, model)
   ```
2. **Reserve files before editing**
   ```text
   file_reservation_paths(project_key, agent_name, ["src/**"], ttl_seconds=3600, exclusive=true)
   ```
3. **Communicate with threads**
   ```text
   send_message(..., thread_id="FEAT-123")
   fetch_inbox(project_key, agent_name)
   acknowledge_message(project_key, agent_name, message_id)
   ```
4. **Use quick reads when helpful**
   ```text
   resource://inbox/{Agent}?project=<abs-path>&limit=20
   resource://thread/{id}?project=<abs-path>&include_bodies=true
   ```

#### Macros vs Granular Tools

* Prefer macros for speed:
  * `macro_start_session`
  * `macro_prepare_thread`
  * `macro_file_reservation_cycle`
  * `macro_contact_handshake`
* Use granular tools when you need explicit control.

#### Common Pitfalls

* `from_agent not registered` → register in the correct `project_key` first
* `FILE_RESERVATION_CONFLICT` → narrow the pattern, wait for expiry, or switch to non-exclusive reservation
* auth failures → ensure the expected bearer/JWT setup is present

### 3) Beads (`br`) — Dependency-Aware Issue Tracking

Beads is the default task system.

Core rules:

* `.beads/` is authoritative state.
* Do not edit `.beads/*.jsonl` manually.
* Commit `.beads/` changes together with the related code changes.
* Use Beads for task status, dependencies, and prioritization.
* Do not duplicate tracking in markdown TODO lists or other side systems.

**Exception:** if the user explicitly asks you to use your built-in TODO functionality, comply. Otherwise, Beads remains the source of truth.

#### Why the Split Matters

Beads decides  **what work exists, what is blocked, and what is ready** .

Agent Mail handles  **conversation, coordination, reservations, and handoff** .

That split is important.

* Beads = issue state, priority, dependencies
* Agent Mail = communication, claims, audit trail, edit-surface coordination

#### Conventions

* Use the Beads issue ID (for example `br-123`) as the Agent Mail `thread_id` when possible.
* Prefix Agent Mail subjects with `[br-123]`.
* Put the issue ID in reservation reasons.
* Include the issue ID in commit messages for traceability.

#### Typical Agent Flow

1. Pick ready work:
   ```bash
   br ready --json
   ```
2. Mark claim / progress:
   ```bash
   br update br-123 --status in_progress --json
   ```
3. Reserve the edit surface in Agent Mail.
4. Announce start in the matching mail thread.
5. Implement and verify.
6. Close the issue and sync:
   ```bash
   br close br-123 --reason "Completed" --json
   br sync --flush-only
   ```

### 4) `bv` — Graph-Aware Triage Engine for `What Next`

`bv` helps decide **what to work on next** in a Beads-backed project.

Scope boundary:

* `bv` = triage, priority, planning, unblock analysis
* Agent Mail = messaging, claims, file reservations

**CRITICAL: Use ONLY `--robot-*` flags. Bare `bv` launches an interactive TUI that blocks your session.**

Recommended entry points:

```bash
bv --robot-triage
bv --robot-next
bv --robot-plan
bv --robot-insights
```

Use `bv` instead of parsing `.beads` state by hand. It computes critical paths, cycles, impact, and parallel tracks deterministically.

### 5) `cass` — Cross-Agent Search

`cass` indexes prior agent conversations so the team does not keep re-solving the same problem.

Rules:

* never run bare `cass`
* always use `--robot` or `--json`

Examples:

```bash
cass health
cass search "authentication error" --robot --limit 5
cass view /path/to/session.jsonl -n 42 --json
```

Treat `cass` as a force multiplier: if another agent already solved the problem, reuse the work instead of rediscovering it.

### 6) `cm context` — Retrieve Memory Before You Re-Solve a Problem

Before complex tasks, retrieve relevant context:

```bash
cm context "<task description>" --json
```

Use it to surface:

* relevant rules,
* anti-patterns,
* and similar prior work.

Protocol:

1. **START** : run `cm context "<task description>" --json` before non-trivial work
2. **WORK** : apply the retrieved rules and anti-patterns deliberately
3. **END** : finish the work cleanly; learning capture is handled separately

### 7) UBS — Final Pre-Commit Bug Sweep

**Golden Rule:** `ubs <changed-files>` before every commit. Exit `0` means safe. Exit `>0` means inspect, fix, and re-run.

Preferred usage:

```bash
ubs <changed-files>
ubs $(git diff --name-only --cached)
ubs .
```

Prefer changed-file scope over whole-repo scans for speed.

### 8) Landing the Plane — Session Completion and Handoff

**When ending a work session, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.**

#### Mandatory Workflow

1. **File issues for remaining work**
2. **Run quality gates** for the code you changed
3. **Update issue status**
4. **Sync Beads**
   ```bash
   br sync --flush-only
   ```
5. **Stage both code and `.beads/` changes**
6. **Commit with a traceable message**
7. **PUSH TO REMOTE**
   ```bash
   git pull --rebase
   br sync --flush-only
   git add .beads/
   git add <other files>
   git commit -m "<message>"
   git push
   git status
   ```
8. **Hand off clearly**

#### Critical Rules

* Work is **NOT** complete until `git push` succeeds.
* Never stop before pushing. That leaves work stranded locally.
* Never say "ready to push when you are." If the repo expects agent pushes,  **you must push** .
* If push fails, resolve and retry until it succeeds.

If push is blocked by auth, branch protection, remote policy, or explicit user instruction, say so clearly and state exactly what is done locally versus what remains blocked.

### 9) Quick Command Reference

#### Agent Mail

```text
ensure_project(project_key=<abs-path>)
register_agent(project_key, program, model)
file_reservation_paths(project_key, agent_name, ["src/**"], ttl_seconds=3600, exclusive=true)
fetch_inbox(project_key, agent_name)
acknowledge_message(project_key, agent_name, message_id)
send_message(...)
```

#### Beads / Triage

```bash
br ready --json
br show br-123
br update br-123 --status in_progress --json
br close br-123 --reason "Completed" --json
br sync --flush-only

bv --robot-triage
bv --robot-next
bv --robot-plan
bv --robot-insights
```

#### Reuse / Memory

```bash
cass search "<query>" --robot --limit 5
cm context "<task description>" --json
```

#### Verification

```bash
ubs <changed-files>
```

---

## What Good Behavior Looks Like

A strong agent in this repo:

* preserves safety by default,
* does not delete casually,
* does not clobber parallel work,
* communicates through Agent Mail,
* reserves files before editing,
* uses Beads for issue state,
* uses `bv` for triage instead of guessing,
* reuses prior work with `cass` and `cm`,
* verifies changes before claiming done,
* and leaves the repo in a traceable, handoff-ready state.
