# Night Agent Implementation Tasks

## NIGHT-BUILD-001 — Config + task schema
Status: DONE (UNIT_VERIFIED)
Validated config and task queue.

## NIGHT-BUILD-002 — Workspace safety
Status: DONE (UNIT_VERIFIED)
Repo-root validation, dirty-worktree refusal, private-path denylist, allowed write scopes.

Do not auto-create commits/worktrees without owner opt-in.

## NIGHT-BUILD-003 — Safe coding tool host
Status: DONE (UNIT_VERIFIED)
Validated file read/search/patch tools, approved shell commands, Git status/diff.
Tests must block traversal and denied commands.

## NIGHT-BUILD-004 — Local Qwen coding-agent adapter
Status: DONE (UNIT_VERIFIED + LIVE_VERIFIED DEV_NIGHT benchmark)
Fresh context per task, structured tool requests, bounded task budget, no arbitrary shell execution.
Benchmark DEV_NIGHT context with voice services stopped.

## NIGHT-BUILD-005 — Deterministic orchestrator
Status: DONE (UNIT_VERIFIED)
Task select → agent attempt → acceptance commands → retry/block → persist → next task.

## NIGHT-BUILD-006 — Escalation packets
Status: DONE (UNIT_VERIFIED)
Local packet generation. Cloud adapter interface may exist but is disabled by default.

## NIGHT-BUILD-007 — Morning report
Status: DONE (UNIT_VERIFIED)
Markdown report + machine state.

## NIGHT-BUILD-008 — Resource guard
Status: DONE (UNIT_VERIFIED)
Safely stop on critically low disk, repeated OOM/resource failure, or configured stop time.

## NIGHT-BUILD-009 — Manual CLI
Status: DONE (UNIT_VERIFIED)
Target:
```text
npm run agent:night:prepare
npm run agent:night
npm run agent:night:status
npm run agent:night:report
```

First release is manual-launch only.

## NIGHT-BUILD-010 — Windows scheduler
FUTURE. Opt-in only after manual runs.

## NIGHT-BUILD-011 — Cloud/Codex escalation
FUTURE. Optional; local run must work when quota is unavailable.
