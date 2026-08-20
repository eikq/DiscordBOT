# Cursor Cloud sequential queue status

Updated: 2026-08-20

This is the continuation pointer for the long-running Cloud development
queue. Later queued prompts must **not** restart from
`origin/local/jarvis-acceptance-2026-08-20`.

## Continuation branch

`cursor/jarvis-cloud-evolution-2026-08-20`

Fetch and continue from the latest successfully pushed HEAD of that
branch only. Do not merge. Do not push `main`. Do not force push.

## Queue 01 — Presenter Intelligence + Desktop Presence

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.

Base: `8aba6b019c436b1e636f32274607015a4dc23e38`
(`origin/local/jarvis-acceptance-2026-08-20`)

Work landed first on
`cursor/jarvis-presenter-desktop-cloud-2026-08-20-4838` and is now the
starting HEAD of the dedicated evolution branch.

Queue 01 HEAD: `5d6e5bc32cf6d5d330e37e9dff0eccb1ccf11d89`

Cloud evidence: `npx tsc --noEmit` PASS; targeted Presenter/Desktop
48/48; `npm run test:cloud` **517/517**.

Labels stay:

- LA-001 **PARTIAL**
- LA-002 **PARTIAL**
- LA-026 **PARTIAL** (live speech↔motion NEEDS_LOCAL_VERIFY)
- LA-027 **PARTIAL — NATIVE_SHELL_REQUIRED**

Native helper is not installed. Do not mark LIVE_VERIFIED from Cloud.

Handoff: `CURSOR_CLOUD_PRESENTER_DESKTOP_HANDOFF.md`.

## Queue 02 — Research Intelligence V2

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.

Queue 02 HEAD: `d02f40155aa1521cefbf24fc05aac605310462de`

Structured query planning, depth budgets (NONE never hits providers),
source trustClass metadata, dedup with provenance, claim/evidence
links, contradiction reporting, cache honesty, citation grounding,
research Presenter mapping, observable traces. PRIVATE_BROWSER stays
fail-closed. Whonix/Tor: **LOCAL_VERIFY_REQUIRED**.

Cloud evidence: `npx tsc --noEmit` PASS; targeted research/v2 +
JF-013 + Presenter briefing tests green; `npm run test:cloud`
**532/532**.

Handoff: `docs/JF013_SAFE_WEB_RESEARCH.md`, ADR-024.

## Queue 03 — Canonical Memory Intelligence V2

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.

Implementation: `b7b9e49dc6c637fef4ea847d39254bd8693b55f2`
Queue 03 HEAD: `7b8b19dd08f3fc8db350c116a7c598fdd443bf47`

SQLite remains canonical truth. Qdrant/vector is a derived retrieval
index only and is **not** started. Obsidian/view layers stay
presentation only. SocialMemoryBrain JSON/JSONL is unchanged.

Shipped:

- Schema v3 quality fields: confidence, importance, status, provenance,
  created/updated, ownerTrusted, derived, memoryClass, supersedes,
  expiry, memoryRefs
- Statuses: ACTIVE / SUPERSEDED / FORGOTTEN / EXPIRED (no silent overwrite)
- Owner preference change: new fact + old retained as superseded
- Hybrid fusion: lexical/FTS + optional semantic hits + recency +
  importance + active + class relevance; orphan vector ids dropped
- Query-aware classes: conversation / technical / device / general
- Bounded turn retrieval (default 8, max 12) with transparent scores
- Episode → significance → candidate → validate → semantic or reject
- Web/research cannot become owner-trusted facts
- Owner correction: จำอันนี้ / อันนี้ไม่ใช่ / เปลี่ยนเป็น / ลืมเรื่องนี้
- Optional Presenter "Jarvis remembered this because..." provenance view

Cloud evidence: `npx tsc --noEmit` PASS; `npm run test:cloud` **541/541**.

Handoff: ADR-025, `tests/jarvis_memory_v2.test.ts`.

## Queue 04 — Safe Evolution + Procedural Skills V2

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.

Implementation: `866e843e935dcd99fb02ecf60952e78002e832da`
Queue 04 HEAD: `9175ef5c4c65ec8aab7e0f0d5a40c0280e55c26b`

Preserve `DISCOVER != INSTALL != REVIEW != TRUST != EXECUTE`.
Jarvis may never approve its own privilege expansion.
`autoPromote=false`. Skill instructions are plans, not authority.

Shipped:

- One idempotent task lifecycle: experience → verify → classify →
  reflection → memory candidate → skill candidate → isolated benchmark
- Skill candidate fields: id, name, goal, trigger conditions, required
  capabilities, steps, preconditions, verification, failure modes,
  security scope, evidence, version, trust status
- Trust states: DRAFT, REVIEW_REQUIRED, TRUSTED, REJECTED, DEPRECATED
- Trusted-only retrieval; rejected/deprecated excluded
- Structured failure knowledge; planning may avoid known failures
  without new authority
- Isolated benchmark never sets TRUSTED
- No uncontrolled recursive self-modification

Cloud evidence: `npx tsc --noEmit` PASS; targeted skills/evolution tests
green; `npm run test:cloud` **553/553**.

Handoff: ADR-026, `tests/jarvis_skills_v2.test.ts`.

## Queue 05 — Model Registry, Certification, Routing and Efficiency

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.

Implementation: `e38f27281841dc8938eeaf07890a8617d396b6c0`
Queue 05 HEAD: `d0f333660a40c6f828778bf21cb5a9927d399aad`

Trust tiers remain STANDARD / EXPERIMENTAL / RESTRICTED.
RESTRICTED models are never auto-selected and are never security
authorities. Unknown abilities stay `unverified`. Cloud certification
is FIXTURE_ONLY (never LIVE_VERIFIED). No model downloads. No invented
RAM/VRAM/energy or live tok/s.

Shipped:

- Profile fields: modelId, provider, engine, trustTier, context/tool/
  structured/coding/Thai/research/vision/recovery, latency and
  throughput evidence, hardware requirements, certification state
- Workload router: casual, information, deep_reasoning, research,
  coding, voice_realtime, night_background, vision
- Routing obeys policy/trust, certification, availability, latency,
  context, and owner preference (RESTRICTED preference is ignored)
- Night stronger/slower model only when `idle === true` is measured;
  assumed idle does not unlock it
- Compatible trusted fallback with `fallbackFrom` / `fallbackReason`
  on traces
- Efficiency: success rate, latency, p50, p95, tokens, tokens/sec,
  tool calls, retries; hardware metrics only when a probe exists

Cloud evidence: `npx tsc --noEmit` PASS; targeted
`tests/jarvis_models_v2.test.ts` + `tests/jarvis_research_addendum.test.ts`
20/20; `npm run test:cloud` **562/562**.

Handoff: ADR-027, `tests/jarvis_models_v2.test.ts`.

## Queue 06 — Realtime Voice Interaction Architecture

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.
Microphone / STT / TTS / RVC live verification is **not** claimed.

Implementation: `7d3a69008bff41947105c516b16ba7d74d5987c4`
(feat `b8e4f4a9ae00feecfac913e1fa8612cd15e7c549`)
Queue 06 HEAD: `f63b51898778c7732ead37279babfb81d7675de3`

Explicit turn states: IDLE, LISTENING, TRANSCRIBING, THINKING,
WORKING, SPEAKING, INTERRUPTED, WAITING_OWNER, ERROR.

Shipped:

- `src/jarvis/realtime/` coordinator with mockable STT/TTS ports
- Barge-in classification: question / correction / stop / new_command
- Mutating WorkAgent apply (risk !== LOW, running/retrying) is never
  paused or cancelled by barge-in; playback may stop
- Streaming: CONVERSATION/INFORMATION may present early with
  `claimSuccess: false`; agentic success only after verified COMPLETED
- One Presenter playback clock; estimate timer is ignored while speech
  is the authority (no independent fake timer)
- Resource signals: realtime_voice > owner_task > background_evolution
  (NightCycle callback on Command Center). No OS/process priority hacks
- Persona and voice stay independent; style is not capability authority
- Default `RECORD_RAW_AUDIO=false` unchanged; mocks do not persist PCM

Cloud evidence: `npx tsc --noEmit` PASS; targeted
`tests/jarvis_realtime_voice.test.ts` **13/13**. Related speech / STT /
briefing / work-agent / evolution / command-center tests stayed green
after the Thai correction-boundary fix. Full `npm run test:cloud` is
deferred while later Cloud follow-ups are queued.

Handoff: ADR-028, `tests/jarvis_realtime_voice.test.ts`.

## Queue 07 — Perception, Screen, CCTV and Device Architecture

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.
No live camera or device claims.

Implementation: `8d3753cdb20c1f101084bce4fb6ec7671c6d0404`
Queue 07 HEAD: `4593b351d6a1a778ed915eeca05b994ed8312a2e`

Unified `src/jarvis/perception/` layer on top of existing simulated
vision/devices/monitor. Observing never grants authority to act.

Shipped:

- Typed PerceptualEvent: source, timestamp, observation, confidence,
  region/object refs, privacy classification, simulation, evidence refs
- Screen capture contracts: display, Jarvis window, selected region
  (mocks; `controlGranted: false`)
- Vision interpretation is `untrusted` and `authoritative: false`
- CCTV actions: view, searchEvents, control, configure, admin.
  Default Jarvis grant is view + searchEvents only
- Perceptual memory candidates (`memoryClass: perceptual/episodic`)
  with bounded retention; `persistToCanonical: false`
- Anomaly pipeline: normalize → rule/threshold → candidate → cooldown
  → owner notification candidate. `physicalAct: false`
- Device identity: deviceId, type, owner label, capabilities, trust,
  connectivity, lastSeen. Secrets stripped from traces
- Command Center snapshot/presentation labeled SIMULATION, no live camera

Cloud evidence: `npx tsc --noEmit` PASS; targeted
`tests/jarvis_perception.test.ts` **8/8** plus command-center /
cloud-finalization / lab-ui tests green. Full `npm run test:cloud`
deferred while later Cloud follow-ups are queued.

Handoff: ADR-029, `tests/jarvis_perception.test.ts`.

## Queue 08 — Proactive Runtime + Scheduler + Night Agent V2

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.
No live GPU sensors, reminder-timer quality, or unattended Night coding
claims.

Implementation: `c6c22ef0de4c51368d2759e73eea59d5a8268d32`
(feat `95a60584071a735fba016702ce3e4c5f2be384c1` + budget-pause test fix)
Queue 08 HEAD: `4b123835e3ad078c25be743da861ec3a66d032ed`

Unified proactive work around the three existing schedulers. Did **not**
add a fourth scheduler.

Shipped:

- Five-level resource priority: realtime_voice > owner_task >
  scheduled_action > monitoring > background_evolution. Background
  yields; no OS process priority hacks
- `ProactiveRuntime` coordinator (`isScheduler: false`) over
  reminders, ProactiveMonitor, and NightCycle
- Notice/suggest policy: GPU-high-load style alerts notify; they do
  not auto-act or kill processes
- Monitor: existing quiet hours / cooldown / dedup plus importance,
  suppression, and owner acknowledgement
- Night V2 pipeline is a mapping over existing stages: maintenance,
  trace analysis, benchmark, memory review, skill review, RuntimeSpec
  candidate, report. `autoPromoted: false`. Yielded vs budget paused
- Interrupted mutating apply is not blindly retried
- Command Center job board: scheduled, running, paused, yielded,
  waiting, completed. No hidden reasoning. Labeled SIMULATION

Cloud evidence: `npx tsc --noEmit` PASS; targeted
`tests/jarvis_proactive_runtime.test.ts` **9/9** plus evolution /
realtime / research-addendum / command-center / cloud-finalization /
work-agent / perception tests green (86/86 in that set). Full
`npm run test:cloud` deferred while later Cloud follow-ups are queued.

Handoff: ADR-030, `tests/jarvis_proactive_runtime.test.ts`.

## Queue 09 — Command Center V2 unified operational interface

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.
No live `/jarvis-lab` visual sign-off. Native helper is not installed.

Implementation: `3c6f5ce19e92cbfa129404ca45d6b6b5a691670e`
Queue 09 HEAD: `85a87694a0478a13f90b3a686ddbd7b850898c22`

Presentation-only mode shell over existing Command Center snapshots.
Did **not** rebuild CommandCenterRuntime, Core, or schedulers.

Shipped:

- Six modes: ASSISTANT, PRESENTER, OPERATIONS, MEMORY, INTELLIGENCE,
  DEVICES. Default Assistant. One primary body at a time.
- Assistant home: conversation, active task, model, voice, alert,
  recommended next action
- Operations: request, route, DAG, active step, capabilities,
  permission wait, verification, bounded recent tasks
- Presenter: existing briefing architecture + fullscreen-ready chrome
- Memory: provenance, active/superseded, owner corrections via Ask
- Intelligence: models, spec, traces, certifications, benchmarks,
  candidates; `INSUFFICIENT_DATA` when evidence is absent
- Devices: online/offline, VIEW only, SIMULATION vs LIVE, permission
  boundary. SEE != CLICK. VIEW != CONTROL
- Global presence chip: REAL / SIMULATION / DEGRADED / OFFLINE.
  Simulation is never visually treated as live hardware
- Meaningful motion only (request path, narration target, alert,
  permission wait); reduced motion respected
- Widescreen / notebook / Presenter layouts. No dedicated phone layout

Cloud evidence: `npx tsc --noEmit` PASS; targeted
`tests/jarvis_command_center_v2.test.ts` plus lab-ui / briefing /
command-center / lab-scene tests green. Full `npm run test:cloud`
deferred while later Cloud follow-ups are queued.

Handoff: ADR-031, `tests/jarvis_command_center_v2.test.ts`.

## Queue 10 — Security Hardening Pass

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.
Defensive review. Existing controls were not disabled.

Queue 10 HEAD: `935b01bfe3d36eb6ba1819140c8d203470e13f51`

Implementation: `a3487504f652aab4ffb30b3a3456c323781b4690`

Shipped:

- Adversarial regressions in `tests/jarvis_security_hardening.test.ts`
- IPv4-mapped IPv6 / decimal-hex / metadata / nip.io SSRF blocks
- Prompt-injection strings remain data (owner policy, confirmation
  token, install program, `.env`, localhost)
- Native helper: forged IPC, replay, HWND/PID, protocol mismatch,
  impersonation fail closed
- Untrusted research cannot plant owner-trusted memory or TRUSTED skills
- WorkAgent grants require owner; webpage actor is UNTRUSTED_ACTOR
- Trace denylist includes credentials, cookies, `.env`, voice secrets
- Gitignore + Night denylist: display aliases, model weights, runtime DBs

Cloud evidence: `npx tsc --noEmit` PASS; targeted security / skills /
memory / perception / presenter tests **127/127**; `npm run test:cloud`
**614/614**.

Labels stay:

- LA-001 **PARTIAL**
- LA-002 **PARTIAL**
- LA-026 **PARTIAL**
- LA-027 **PARTIAL — NATIVE_SHELL_REQUIRED**

Handoff: ADR-032, `tests/jarvis_security_hardening.test.ts`.

## Queue 11 — Full-System Cloud Integration Pass

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.
No new architecture. Integrates Queues 01–10.

Queue 11 HEAD: `47a1f6ca15e734c53c2f1d395e59868c97b64e1d`

Implementation: `3768a1d25f0dd4b75e618bdeedc805ba99dcba50`
TurnId test fix: `0d2bdd835182ed8346bdb52e8fb2626169d999f7`

Shipped:

- Distinct ops codes: `UNSUPPORTED_HOST`, `PERMISSION_REQUIRED`,
  `DENIED`, `TIMEOUT`, `PROVIDER_UNAVAILABLE`, `INSUFFICIENT_DATA`,
  `UNKNOWN_DISPLAY`, `VERIFICATION_FAILED` (plus existing
  `CAPABILITY_DENIED` / `RESEARCH_TIMEOUT`)
- Correlation helper: independent default `turnId`; traces may carry
  `stepId` / `presentationId`
- 14 offline/simulated end-to-end fixtures
- Lab research traces keep `requestId`/`sessionId`/`taskId`; `turnId`
  is independent and coherent
- Simulation/live confusion stays labeled: native helper fixtures,
  perception, and Night benchmarks are not LIVE

Cloud evidence: `npx tsc --noEmit` PASS; targeted integration +
local-acceptance + ops **30/30**; `npm run test:cloud` **633/633**
on `0d2bdd835182ed8346bdb52e8fb2626169d999f7`.

Labels stay:

- LA-001 **PARTIAL**
- LA-002 **PARTIAL**
- LA-026 **PARTIAL**
- LA-027 **PARTIAL — NATIVE_SHELL_REQUIRED**

Evidence labels for this queue: **IMPLEMENTED** + **CLOUD_VERIFIED**
(unit). Not **LIVE_VERIFIED**. Existing LA-026/027 / Whonix / native
helper / live mic-STT-TTS remain **NEEDS_LOCAL_VERIFY** /
host-only as before.

Handoff: ADR-033, `tests/jarvis_cloud_integration.test.ts`.

## Queue 12 — Final Cloud Audit and Physical-Machine Handoff

Status: **COMPLETE** (handoff). Not LIVE_VERIFIED.
No new architecture. Cloud feature queues stop here.

Queue 12 HEAD: _pending pin after docs commit_

Handoff document: `CURSOR_LOCAL_ACCEPTANCE_NEXT.md`

Shipped:

- Classification of remaining work (CLOUD_COMPLETE /
  LOCAL_VERIFY_REQUIRED / LOCAL_IMPLEMENTATION_REQUIRED /
  OWNER_DECISION_REQUIRED / BLOCKED_EXTERNAL)
- Ordered Windows local tests (dependency order)
- Native window return test (build/install only after owner approval)
- Voice return test (mic / STT / TTS / barge-in / Presenter / independence)
- Explicit Cloud stop-line (ADR-034)

Labels stay:

- LA-001 **PARTIAL**
- LA-002 **PARTIAL**
- LA-026 **PARTIAL**
- LA-027 **PARTIAL — NATIVE_SHELL_REQUIRED**

Do not start another Cloud feature automatically. Do not merge.
Do not push `main`.

## Operating constraints still in force

- LLM output ≠ execution
- CapabilityHost / ActionGate remain authoritative
- Jarvis cannot approve itself
- web / model / skills output = untrusted data
- no unrestricted production shell
- no uncontrolled recursive self-modification
- no multi-agent swarm
- no automatic LoRA training / skill promotion / restricted-model routing
