# Future Overnight Local Coding Agent

This is a future design specification. Do not implement it until the normal repository tests and task descriptions are reliable.

## Goal

Allow a local Qwen coding agent to continue low-risk project work unattended overnight.

Cloud coding agents (Cursor/Codex or another provider) are optional escalation resources, not hard dependencies.

## Non-goals

The overnight developer must not:

- control the user's live Discord identity
- send messages publicly
- capture raw voice data
- reconfigure CCTV
- expose services to the Internet
- delete project/user data
- push/merge automatically
- change consent/security policies autonomously

## Loop

```text
load state
  |
choose one READY task
  |
create internal checkpoint/report state
  |
inspect relevant files
  |
implement
  |
run targeted tests
  |
PASS ------------------> record result -> next task
  |
FAIL
  |
local retry (bounded)
  |
still failing
  |
create escalation packet
  |
cloud model if available
  |
re-test
  |
resolved or mark BLOCKED
  |
reset LLM task context
  |
next task
```

## Context strategy

Do not grow one chat all night.

At each task:

- read `AGENTS.md`
- read concise project/session state
- read task definition
- retrieve relevant files
- execute
- summarize result
- release/reset conversation state

Persistent memory belongs in repository state files, not the model's context.

## Suggested persistent files

- `TASKS.md`
- `SESSION_STATE.md`
- `agent_state.json`
- `.agent/lessons/`
- `.agent/escalations/`
- `.agent/reports/`

These are future suggestions; choose tracked/ignored status deliberately.

## Retry policy

Suggested default:

- max 3 local fix attempts on the same failing test/root issue
- if no measurable progress, stop looping
- build an escalation packet

## Escalation packet

Include:

- task goal
- acceptance criteria
- exact failing command
- exact error
- relevant files
- current diff summary
- attempts already made
- suspected root cause
- last known passing state
- constraints that must not be violated

Do not send the entire Qwen conversation.

## When cloud escalation is unavailable

If Codex/Cursor usage is exhausted:

- mark the task `BLOCKED_LOCAL`
- save a high-quality escalation packet
- continue independent READY tasks

## Morning report

Produce:

- completed tasks
- changed files
- tests passed/failed
- blockers
- escalation packets
- security/privacy-sensitive areas touched
- owner actions required
- recommended next task

## Git policy

Current project policy says do not commit unless the user asks.

Therefore the first overnight implementation should not auto-commit.

Potential future safe options, only with explicit user approval:

- separate Git worktree
- dedicated branch
- local commits without push

Never auto-push by default.
