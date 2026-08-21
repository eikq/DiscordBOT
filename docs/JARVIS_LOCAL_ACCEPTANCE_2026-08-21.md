# Jarvis local acceptance — 2026-08-21

Owner machine: Windows 11.

Completion branch: `local/jarvis-acceptance-completion-2026-08-21`
from exact source HEAD `0cd7b0da462ae0f5baf083c05db81ea9f94100c0`
(`local/jarvis-journal-recovery-2026-08-21`).

Labels in the completion table are `CODE_FIXED`, `UNIT_VERIFIED`,
`LIVE_VERIFIED`, `OWNER_VISUAL_PENDING`, or `BLOCKED`. Cloud tests never
upgrade `BLOCKED_LOCAL_ACCEPTANCE` to owner visual acceptance.

Repository verification on this machine (completion pass):

- `npx tsc --noEmit` PASS
- focused pending-goal suite 29 / 29 PASS
- `npm run test:cloud` **571 / 571 PASS** (was 565 before Self Knowledge tests)
- `npm run build` PASS (known Vite CoreScene chunk warning and esbuild
  `import.meta` CJS warning; not treated as failure)

Disposable fixtures only. No owner documents, credentials, CCTV footage,
browser cookies, or private voice samples were committed. Reminder titles from
live Allow Once are not copied here.

Ollama probe (no secrets): `http://127.0.0.1:11434/api/version` → HTTP 200,
version `0.32.14`. Model id is not copied from `.env` into this report.

Authoritative dashboard start: `JARVIS_STANDALONE=1` `HOST=127.0.0.1`
`npx tsx server.ts`. Bound **http://127.0.0.1:3000**. Discord not started.

| ID | Area | Status | Notes |
| --- | --- | --- | --- |
| LA-015 | Trusted Operator | LIVE_VERIFIED (HTTP subset) | Earlier disposable-runtime PASS retained. HTTP: sandbox Risk Brief + Allow Once via `/api/jarvis/actions/confirm`; Emergency Stop / owner resume; rollback checkpoint AVAILABLE. No issued lease remained to revoke after reminder grant. |
| LA-017 | Execution / recovery sandbox | LIVE_VERIFIED (HTTP) | `operator.sandbox.writeConfig` waiting permission, Allow Once, `actionStatus: completed`, rollback available. |
| Journal C | Persistent journal | UNIT_VERIFIED + LIVE_VERIFIED (subset) | Crash-window PASS retained. Live: reminder ops journaled; no raw token/credential keys; Emergency Stop dispositions present on shared runtime; WorkAgent COMPLETED ≠ journal COMPLETED. |
| LA-001 | Ollama / Qwen hello and routes | LIVE_VERIFIED | Earlier hello / recursion / `สถานะระบบ` PASS retained. Public research now executed via `research.current` (see Research). |
| LA-016 | Model-agnostic provider | LIVE_VERIFIED | Unchanged from morning pass. |
| Self-knowledge E | Capability answers | CODE_FIXED + UNIT_VERIFIED + LIVE_VERIFIED (HTTP) | Setup and PowerShell no longer escape to the model. CCTV stays not-live. Owner visual of System page still pending. |
| LA-019 | Goal Catalog | LIVE_VERIFIED (HTTP) | All seven live turns against loopback dashboard. Owner visual of Goal ID/Expert Details still pending (LA-002). |
| LA-020 | Pending goal continuation | LIVE_VERIFIED (HTTP orchestration) | Missing time, continuation, duplicate continuation, Never mind, correction, drift, two pending sessions, Emergency Stop before grant, Allow Once → one additional reminder, duplicate grant rejected. Restart-while-WAITING_INPUT and expiry remain UNIT_VERIFIED (dashboard was not killed for those). |
| Windows reminder delivery | Toast / notification | BLOCKED | Scheduler marks store delivery + optional speech only. Storage ≠ Windows toast. |
| UI/SSE H | `/jarvis-lab` HTTP/SSE | LIVE_VERIFIED (HTTP/SSE) + OWNER_VISUAL_PENDING | Loopback HTML 200 is not visual acceptance. SSE connect, increment, unique seq, heartbeat, replay/redaction verified over HTTP. |
| Research | Public `research.current` | LIVE_VERIFIED | Qwen docs turn returned untrusted evidence URL. Previous harness had `research: false`. |
| WorldIntel MCP | Health + `intel_status` | LIVE_VERIFIED (bounded) | `availability: up`; vector store unavailable (qdrant/fastembed absent — expected). Not HTTP-gated. Unit tests keep `worldIntel: false`. |
| PRIVATE_BROWSER | Whonix | BLOCKED | Not mixed into this pass. SSE showed `PRIVATE_ROUTE_CHECK` gateway/workstation down. |
| CCTV | Live provider | BLOCKED | Remains `PREPARE_CONTRACT` / `BLOCKED_LOCAL_ACCEPTANCE`. |

`BLOCKED_LOCAL_ACCEPTANCE.md` LA-002 (browser visual QA) and Windows notification
delivery are **not** upgraded. HTTP success is not owner visual verification.

## Completion pass — Self Knowledge (CODE_FIXED)

Classifier kinds now include `NEEDS_SETUP`, `NEEDS_PERMISSION`, `AFTER_SETUP`,
`AVAILABLE_NOW`, and `GAP_EXPLANATION`. Gap questions resolve against the current
utterance (not a leftover WorkAgent `latestGap`). Goal Catalog maps setup /
unavailable / permission to `self.capabilities` and why / need-from-me to
`self.explain-gap`. No parallel Self Knowledge subsystem. No unrestricted
production shell.

Live HTTP answers (loopback `/api/jarvis/ask`):

- **“What capabilities need setup?”** → `answerIntent: self_knowledge`,
  kind `NEEDS_SETUP`. CCTV listed as NEEDS_PROVIDER / NEEDS_OWNER_INPUT /
  NEEDS_DEPENDENCY. Not claimed live.
- **“Why can't you run PowerShell?”** → kind `GAP_EXPLANATION`. Unrestricted
  PowerShell is not registered; `shell.exec` is policy-forbidden; no
  administrator authority; typed alternatives (desktop/status/runtime) listed
  from evidence. Not a bare “I cannot run PowerShell.”

System UI “Needs setup” count includes `NEEDS_OWNER_INPUT`. Command Center now
presents `WAITING_PERMISSION` ahead of `WAITING_INPUT` so Allow Once is not
hidden behind an older pending question.

## Completion pass — Dashboard / SSE

- Process: `npx tsx server.ts` with `JARVIS_STANDALONE=1`, `HOST=127.0.0.1`
- URL: **http://127.0.0.1:3000/jarvis-lab**
- `/api/health` 200 `{status:ok}`; `/jarvis-lab` 200 Vite shell (~393 bytes)
- `/api/jarvis/status` ready; research + workspace + reminders attached/healthy
- SSE `/api/jarvis/events?stream=1`: connection; live seq increment (e.g. 33→51)
  with unique seqs; heartbeat comment `hb` at 15s; replay `after=` returns
  buffered events without duplicate seq; summaries redacted; no chain-of-thought
  field

Cursor cannot mark the UI OWNER_VERIFIED.

## Completion pass — LA-019 Goal Catalog (HTTP)

| Turn | Route / result |
| --- | --- |
| Research the latest Qwen documentation | RESEARCH / agentic; `research.current` SUCCESS; evidence `https://docs.qwencloud.com/changelog/models` |
| Search my workspace for CapabilityGapResolver | WORKSPACE ≠ web; SUCCESS |
| สถานะระบบ | `system.status` read-only SUCCESS |
| Remind me to test Jarvis tomorrow at 15:00 | `reminders.create` BLOCKED waiting permission (ActionGate) |
| What can you do? | CAPABILITY_SUMMARY from Self Knowledge; no invented live CCTV |
| Compare the security notes | Clarification: public web vs approved workspace |
| Remind me to test Jarvis | Asks only for time |

## Completion pass — LA-020 Pending Goal (HTTP)

- Missing time → WAITING_INPUT / “When should I remind you?”
- “Tomorrow at 15:00.” → same `reminders.create` goal, ActionGate BLOCKED, no
  reminder before approval
- Duplicate continuation stayed BLOCKED waiting permission (no extra mutation
  in presented text)
- “Never mind” cancelled the pending goal
- Explicit correction with a time → same goal, still ActionGate
- Goal drift (“Research the latest Qwen documentation.” while a reminder was
  pending) → ask whether to cancel; reminder not executed
- Two sessions both received pending goals / time questions
- Emergency Stop while a reminder waited: grant returned
  `Emergency Stop is active. Only the owner can resume operation.`; owner resume 200
- Allow Once via `POST /api/jarvis/command-center/grant` on the ask `taskId`:
  that task `COMPLETED`; reminder `activeCount` increased; duplicate grant 400
  “No step is waiting for permission.”

Reminder WorkAgent permission is a planning-gate step, not
`/api/jarvis/actions/confirm` with a proposal token. Tasks Allow Once (grant)
is the dashboard path. Sandbox mutations still use confirm+token.

Restart-while-WAITING_INPUT and TTL expiry were not re-run live (would require
stopping the dashboard the owner still needs for visual QA). They remain
UNIT_VERIFIED in `tests/jarvis_pending_goal_continuation.test.ts`.

## Research / WorldIntel

Previous LA-001 harness set `research: false` / `worldIntel: false`, so Goal
Catalog correctly said there was no verified route. The live dashboard attaches
`research.current` (DuckDuckGo + Wikipedia). That is the public research path.

WorldIntel MCP is installed and healthy on this machine (`availability: up`,
14 allowlisted tools, pinned commit `9254192d83f88bd7e5312b074c11f09398b84ca9`).
`intel_status` executed with `<untrusted_tool_output>` wrapping. Qdrant/fastembed
are not installed; vector store stays unavailable. `world-intel.*` IDs are not
in `GATED_CAPABILITY_IDS`, so `/api/jarvis/ask` `capabilityCalls` cannot invoke
them. Unit/cloud tests keep `worldIntel: false` so workers do not hang on a live
MCP child process.

PRIVATE_BROWSER / Whonix were not used. No silent fallback to host Chrome/Edge.

## Journal regression (shared owner runtime)

Inspected `data/jarvis/runtime/execution-journal.db` aggregates only (no
payload dump):

- `reminders.create` records present (AUTHORIZED / verification NOT_STARTED)
- WorkAgent task COMPLETED did not rewrite those rows to journal COMPLETED
- no forbidden journal keys (`token`, `credential`, …) in serialized records
- Emergency Stop left many `CANCELLATION_REQUESTED` rows, which remain
  “active” by schema (not terminal). `journalActive` on the shared runtime is
  therefore large and is **not** a count of this pass’s mutations
- sandbox checkpoints still AVAILABLE for rollback

## OWNER_VISUAL_PENDING

Open **http://127.0.0.1:3000/jarvis-lab** and report screenshots/notes:

1. Assistant: “What capabilities need setup?”, “Why can't you run PowerShell?”,
   “What can you do?”
2. System: Available now vs Needs setup vs Local acceptance; CCTV not live
3. Tasks: waiting permission / Allow Once for a disposable reminder
4. Security: Risk Brief, Emergency Stop
5. Activity: SSE events, no chain-of-thought, redaction

Do not mark OWNER_VERIFIED until the owner confirms.

## Remaining BLOCKED_LOCAL_ACCEPTANCE

- CCTV live provider / LAN / credentials
- Windows reminder toast delivery
- PRIVATE_BROWSER / Whonix
- LA-002 full browser visual QA (Ctrl+K, reduced-motion, etc.)
- Unrestricted shell / new computer-control / CCTV provider / Proactive
  Intelligence / Content Studio — not started

---

## Earlier same-day pass (journal recovery branch)

The sections below are the morning disposable-runtime results. Research-route
and Self Knowledge FAIL notes in that pass are superseded by the completion
table above.

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
- research the latest Qwen documentation (morning harness): route RESEARCH agentic, presented “I do not currently have a verified route for that goal.” Superseded by live `research.current` in the completion pass.

## Self-knowledge E (morning)

- “Can you access my CCTV?” correctly said CCTV is not live and remains a prepared owner-only contract. It did not claim RTSP/ONVIF works.
- “What capabilities need setup?” was not classified as self-knowledge (FAIL; fixed in the completion pass).

Do not mark `BLOCKED_LOCAL_ACCEPTANCE.md` items LIVE_VERIFIED from this report except where the exact documented procedure, including dashboard UI, has been run.
