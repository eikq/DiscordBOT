# Cursor Prompt — Build the Overnight Autonomous Coding Worker

The owner wants a safe automatic local coding system that can continue the Jarvis project while they sleep.

Do not work on Discord features.
Do not start live CCTV or voice-training work.
Do not install a Windows scheduled task yet.

Read:
1. `AGENTS.md`
2. `PROJECT_CONTEXT.md`
3. `SESSION_STATE.md`
4. `JARVIS_FIRST_DIRECTIVE.md`
5. `NIGHT_AGENT_DIRECTIVE.md`
6. `NIGHT_AGENT_ARCHITECTURE.md`
7. `NIGHT_AGENT_SAFETY_POLICY.md`
8. `NIGHT_AGENT_TASK_SCHEMA.md`
9. `NIGHT_AGENT_ESCALATION.md`
10. `NIGHT_AGENT_REPORTING.md`
11. `NIGHT_AGENT_IMPLEMENTATION_TASKS.md`

## Goal

Build v1 of a local overnight coding agent powered primarily by the existing local Qwen runtime.

Target manual workflow:

```powershell
npm run agent:night:prepare
npm run agent:night
```

In the morning, the owner should have a report of completed, blocked and human-review tasks.

## Design rule

The LLM is NOT the orchestrator.

A deterministic TypeScript orchestrator owns:
- task queue
- policy
- tool validation
- attempts
- time budgets
- test execution
- pass/block decisions
- reporting

Qwen owns code reasoning and bounded patch generation inside those rules.

## Build order

Implement NIGHT-BUILD-001 through NIGHT-BUILD-009.

Do not implement Task Scheduler or real cloud/Codex escalation yet beyond an interface/local escalation packet.

## Hard safety constraints

- no Git push
- no destructive Git
- no writes outside approved workspace
- no `.env` access
- no private voice/memory/runtime data access
- no live Discord messages
- no voice capture/training
- no CCTV configuration
- no public deployment
- no automatic dependency installation
- no arbitrary shell execution from model text

All commands must be policy-validated.

## Workspace

Default behavior must refuse unattended coding in a dirty/unsafe primary workspace.

Do not silently overwrite active Cursor changes.

Implement a preparation flow that explains what must be clean/isolated.

Do not create commits/worktrees automatically unless owner opt-in is explicitly configured.

## DEV_NIGHT profile

For benchmarking:
- Discord off
- ASR off
- JaiTTS/RVC off
- one local Qwen coding slot
- keep Qwen warm where practical
- benchmark context instead of assuming 32K/64K

Record chosen stable context and runtime behavior.

## Coding agent

Reuse current local-Qwen/LLM abstractions where practical, but keep the coding-agent path separate from normal conversational Jarvis Core.

Regular Jarvis conversation must not gain unrestricted filesystem/shell privileges.

## Required tests

Cover:
- task schema
- dependency filtering
- path scope
- private-path denial
- command allowlist
- traversal attempts
- attempt limit
- time limit
- pass on acceptance tests
- block on repeated failure
- escalation packet
- state persistence
- context reset between tasks
- morning report
- cloud escalation unavailable
- dirty-workspace refusal

After implementation:
- run targeted tests
- lint/typecheck
- build
- perform one SAFE dry run using a synthetic NIGHT_SAFE task in a temporary/sandbox workspace
- do not modify real project behavior during the dry run

Update `SESSION_STATE.md`.

Stop before automatic Windows scheduling.

Report:
- commands added
- coding tool surface
- safety boundaries
- DEV_NIGHT Qwen context/resource benchmark
- dry-run result
- remaining risks
- exact first-manual-night steps for the owner.
