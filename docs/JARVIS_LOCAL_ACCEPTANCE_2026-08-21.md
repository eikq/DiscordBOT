# Jarvis local acceptance — 2026-08-21

Owner machine: Windows 11. Repository branch:
`local/jarvis-journal-recovery-2026-08-21`.

Labels used below are only `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`. Cloud
tests never upgrade `BLOCKED_LOCAL_ACCEPTANCE` to `LIVE_VERIFIED`.

Repository verification on this machine (not local acceptance):

- `npx tsc --noEmit` PASS
- `npm run test:cloud` 565 / 565 PASS
- `npm run build` PASS

Disposable fixtures only. No owner documents, credentials, CCTV footage,
browser cookies, or private voice samples were used.

| ID | Area | Status | Notes |
| --- | --- | --- | --- |
| LA-015 | Trusted Operator | NOT_RUN | Queued after journal checkpoint. |
| LA-017 | Execution / recovery sandbox | NOT_RUN | `operator.sandbox.writeConfig` only. |
| Journal C | Persistent journal crash-window | NOT_RUN | Test-hook fixtures; no Windows hard-kill. |
| LA-001 | Ollama / Qwen hello and routes | NOT_RUN | |
| LA-016 | Model-agnostic provider | NOT_RUN | |
| Self-knowledge E | Capability answers / CCTV honesty | NOT_RUN | |
| LA-019 | Goal Catalog | NOT_RUN | |
| LA-020 | Pending goal continuation | NOT_RUN | |
| UI/SSE H | `/jarvis-lab` | NOT_RUN | After backend paths. |
| CCTV | Live provider | BLOCKED | Remains `PREPARE_CONTRACT`. |

Evidence references will be added when each staged test actually runs.
