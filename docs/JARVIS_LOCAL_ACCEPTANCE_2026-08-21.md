# Jarvis local acceptance — 2026-08-21

Owner machine: Windows 11. Repository branch:
`local/jarvis-journal-recovery-2026-08-21` at
`1d11fa1717553f7f619f64d527fc853f345969f5` (later docs commits may follow).

Labels used below are only `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`. Cloud
tests never upgrade `BLOCKED_LOCAL_ACCEPTANCE` to `LIVE_VERIFIED`.

Repository verification on this machine (not local acceptance):

- `npx tsc --noEmit` PASS
- `npm run test:cloud` 565 / 565 PASS
- `npm run build` PASS

Disposable fixtures only. No owner documents, credentials, CCTV footage,
browser cookies, or private voice samples were used.

Ollama probe (no secrets): `http://127.0.0.1:11434/api/version` → HTTP 200,
version `0.32.14`. Model id is not copied from `.env` into this report.

| ID | Area | Status | Notes |
| --- | --- | --- | --- |
| LA-015 | Trusted Operator | PASS | Disposable runtime root. Latch file persisted; model/system resume failed; owner resume cleared it. HTTP `/jarvis-lab` UI still NOT_RUN. |
| LA-017 | Execution / recovery sandbox | PASS | `operator.sandbox.writeConfig` only. Restart did not apply twice. Rollback was a new approved action. |
| Journal C | Persistent journal crash-window | PASS | CHECKPOINTED restart offered retry and did not auto-mutate. No Windows hard-kill. |
| LA-001 | Ollama / Qwen hello and routes | PASS | hello→CONVERSATION; explain recursion→INFORMATION; สถานะระบบ→`system.status`. Research routed RESEARCH/agentic but had no verified executable route in this harness. |
| LA-016 | Model-agnostic provider | PASS | Qwen reachable; `สถานะระบบ` used the typed capability path (244ms, no LLM spoken-response log) while conversation turns used LocalLLM. Permission/Emergency Stop were not altered by the model family. |
| Self-knowledge E | Capability answers / CCTV honesty | FAIL | CCTV and computer-control answers were honest. “Why can't you run PowerShell?” fell through to a generic catalog. “What capabilities need setup?” escaped to the conversational model. |
| LA-019 | Goal Catalog | NOT_RUN | Backend unit coverage exists; live catalog turns were not run as a separate suite. |
| LA-020 | Pending goal continuation | NOT_RUN | Cloud/unit reminder continuation PASS; live owner reminder notification not run. |
| UI/SSE H | `/jarvis-lab` | NOT_RUN | After backend paths. |
| CCTV | Live provider | BLOCKED | Remains `PREPARE_CONTRACT`. |

## LA-015 Trusted Operator

- Date/time: 2026-08-21 ~18:15 +07
- Environment: owner Windows process, disposable temp runtime root
- Actions: issue one-use test lease; queue WorkAgent task; require sandbox confirmation; Emergency Stop; reconstruct `TrustedOperatorRuntime` from the same root
- Expected: stop blocks new tasks; pending confirm is not reusable as a successful mutation; lease REVOKED; latch survives reconstruction; model/system/jarvis resume fail; owner resume clears
- Observed: PASS. Evidence: `.runtime/acceptance/local-2026-08-21.json`
- Remaining risk: HTTP dashboard Activity/SSE not inspected

## LA-017 Sandbox execution / recovery

- Actions: Allow-once sandbox write; restart host on same root; same operation id; rollback as a new confirm
- Expected: CHECKPOINT then VERIFIED; restart idempotent; ROLLBACK_VERIFIED
- Observed: PASS (`checkpoint_eca0b666-3c3d-4106-ac53-c3ef376e8e6d`)
- Remaining risk: UI Risk Brief chrome not opened

## Journal C

- Actions: persist CHECKPOINTED journal; new coordinator; observe PRIOR
- Expected: no auto-mutation; RETRY_OFFERED; model cannot authorize retry
- Observed: PASS

## LA-001 / LA-016 Ollama

- hello: route CONVERSATION, presented “Hello! How can I help you today?”
- explain recursion: route INFORMATION, model-generated explanation (~580 chars)
- สถานะระบบ: route CAPABILITY, `system.status` completed, GPU name reported from host telemetry
- research the latest Qwen documentation: route RESEARCH agentic, presented “I do not currently have a verified route for that goal.” Research execution was not live-verified in this harness.

## Self-knowledge E

- “Can you access my CCTV?” correctly said CCTV is not live and remains a prepared owner-only contract. It did not claim RTSP/ONVIF works.
- “What capabilities need setup?” was not classified as self-knowledge and returned the mocked conversational string. Treat as FAIL until that classifier covers setup questions.

Do not mark `BLOCKED_LOCAL_ACCEPTANCE.md` items LIVE_VERIFIED from this report except where the exact documented procedure, including dashboard UI, has been run.
