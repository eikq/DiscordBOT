# Night Autonomous Developer Directive

## Goal
Allow the local machine to continue low-risk engineering work unattended overnight.

## Core architecture

```text
Task Queue
   ↓
Deterministic Orchestrator
   ↓
Local Qwen Coding Agent
   ├─ read/search files
   ├─ apply bounded patches
   └─ request approved commands
   ↓
Tests / lint / build
   ├─ PASS → record result
   └─ FAIL → bounded retries → escalation packet
   ↓
Context reset
   ↓
Next NIGHT_SAFE task
   ↓
Morning report
```

The LLM is not the orchestrator.

The orchestrator owns:
- task selection
- allowed scope
- attempt/time limits
- test commands
- pass/block logic
- escalation threshold
- stop time
- state/report writing

## NIGHT_SAFE only

Allowed examples:
- unit tests
- lint/type fixes
- small internal refactors with tests
- well-specified pure functions
- adapters/interfaces
- docs based on verified code
- local developer tooling
- bounded error handling fixes

Not NIGHT_SAFE by default:
- live Discord tests
- voice capture/training
- CCTV/NVR changes
- external messages
- deployment
- destructive DB migration
- dependency major upgrades
- broad architecture rewrites
- public network exposure

## Per-task reset

Every task gets a fresh context packet:
- AGENTS.md
- concise current project state
- exact task
- relevant rules
- relevant files
- latest failing test output

After completion/retry:
- summarize
- persist state
- reset model context
- move to next task

Do not grow one conversation all night.
