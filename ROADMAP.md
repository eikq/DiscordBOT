# Digital Me → Jarvis Roadmap

This roadmap is a **proposed engineering direction**. It is not evidence that a phase is complete.

Status vocabulary:

- `CURRENT` — existing baseline from the source context
- `VERIFY` — code exists but requires real/live confirmation
- `NEXT` — recommended near-term engineering work
- `FUTURE` — planned direction, not implemented
- `OPTIONAL` — only pursue when product need is clear

---

## Phase A — Stabilize the current working tree
Status: NEXT

Goal:
Make the present Qwen3.8 + research working tree reproducible and honestly documented.

Work:

- inspect `git status`
- reconcile modified/untracked Qwen/research files
- run lint/test/build baselines
- run research unit tests
- verify scripts reference the current runtime
- improve error messages for missing optional services
- update context/state docs only with verified claims
- preserve all privacy and consent invariants

Exit criteria:

- working tree state is understood
- non-live tests pass or blockers are documented
- no accidental loss of current uncommitted work

---

## Phase B — Current-machine runtime baseline
Status: NEXT / VERIFY

Goal:
Measure what actually runs on the RTX 5090 Laptop profile.

Work:

- run local launcher
- record which services become UP
- measure VRAM/RAM while:
  - voice stack idle
  - Qwen loaded
  - ASR active
  - TTS/RVC active
- run benchmark command honestly
- identify GPU contention and context limits
- create documented runtime profiles

Recommended profiles:

1. `VOICE_INTERACTIVE`
2. `RESEARCH`
3. `DEV_NIGHT` (future local coding worker)

Exit criteria:

- actual resource map exists
- no fabricated performance claims
- runtime knobs have safe defaults

---

## Phase C — Live Discord smoke without voice-clone claims
Status: VERIFY

Goal:
Prove the network/audio/session loop first.

Sequence:

1. Discord login
2. slash commands registered
3. `/join`
4. receive voice
5. STT final transcript
6. social decision
7. source TTS response
8. playback
9. human barge-in
10. `/leave`
11. reconnect/error behavior

Do not require training a clone for this phase.

Exit criteria:

- observed live behavior is recorded separately from unit-test evidence

---

## Phase D — Consented live clone verification
Status: VERIFY

Goal:
Prove the complete consent → dataset → training → playback loop.

Work:

- explicit server consent
- selected capture target only
- collect sufficient clean accepted audio
- freeze version
- train/fine-tune according to current policy
- publish/select `best`
- run `/speak`
- human listening test
- verify revoke stops future capture

Exit criteria:

- a real human has heard the generated result
- privacy behavior is confirmed live
- no quality claim is based solely on training loss

---

## Phase E — Research integration hardening
Status: CURRENT / NEXT

Goal:
Make world-intel a reliable, read-only optional intelligence capability.

Work:

- live smoke current feeds
- verify real citation URLs
- expose partial-source failure cleanly
- add timeout/cancellation
- keep explicit `/research` and dashboard workflow
- do not put research into normal group voice automatically yet

Optional later:
spoken research intent routing with product-specific timeout and interruption behavior.

---

## Phase F — Jarvis Core
Status: FUTURE

See also `JARVIS_MEMORY_ARCHITECTURE.md` and `JARVIS_UI_UX_VISION.md`. Those are proposed designs, not current code.

Goal:
Evolve Digital Me without rewriting it.

Proposed new modules:

- `src/jarvis/core/` — orchestration/event bus
- `src/jarvis/tools/` — tool registry/MCP adapters
- `src/jarvis/automation/` — scheduler/event triggers
- `src/jarvis/perception/` — normalized perception events
- `src/jarvis/permissions/` — action approval policy
- `src/jarvis/clients/` — desktop/Android adapters

Principles:

- existing Discord voice path remains a client/capability
- LLM is a reasoning component, not the whole operating system
- state is external and inspectable
- actions have explicit permission levels
- hardware/network failures degrade gracefully

---

## Phase G — CCTV Intelligence MVP
Status: FUTURE

Goal:
Use one home CCTV stream to detect unusual observable activity locally.

Start with one camera only.

Pipeline:

CCTV/RTSP
→ frame ingestion
→ object detector
→ multi-object tracker
→ user-defined zone
→ event aggregator
→ local event store
→ deterministic anomaly rules
→ snapshot/clip reference
→ optional Jarvis summary/alert

Initial detectable facts should be observational:

- number of people
- cars/motorcycles
- dwell duration
- repeated visits
- activity by time window
- box-like/package-like objects if the detector can support them reliably

Do not infer criminal intent from appearance or closed packages.

Do not make identity recognition a prerequisite.

Recommended first milestone:
"Show one live stream with tracked person/vehicle IDs and create one event when a zone rule fires."

Later:

- baseline statistics
- anomaly score
- multi-camera support
- searchable event history
- optional visual embeddings for object/event similarity

---

## Phase H — Android / Edge Terminal
Status: FUTURE

Goal:
Reuse low-cost/old Android hardware as an interface and edge sensor.

Possible responsibilities:

- wake word / VAD
- mic
- speaker
- status/orb UI
- local sensor/camera input
- lightweight offline commands
- LAN connection to Jarvis Core

Heavy reasoning remains on the RTX machine when available.

---

## Phase I — Autonomous Local Developer
Status: FUTURE

Goal:
Allow a local Qwen coding agent to work through tasks overnight and use a cloud coding model only for escalation.

Do not implement until project tests and task boundaries are reliable.

Proposed loop:

Task queue
→ local Qwen
→ edit
→ targeted tests
→ retry with bounded attempts
→ escalation packet if blocked
→ cloud coding model when available
→ tests
→ state report
→ next task

Requirements:

- isolated dev runtime profile
- no access to production secrets by default
- no live Discord sends
- no raw-audio capture
- no destructive Git commands
- no automatic push
- bounded retries
- persistent task/report files
- context reset between tasks

See `NIGHT_AGENT_FUTURE.md`.

---

## Phase J — Optional model specialization
Status: OPTIONAL

Only after enough real data/evaluations exist:

- retarget owner/persona LoRA work to the actual current model strategy
- evaluate whether LoRA is better than prompt + memory + retrieval
- package/start semantic embedding service if it measurably improves retrieval
- evaluate smaller fast router model vs Qwen3.8 for low-latency commands

Do not fine-tune simply because a training script exists.
