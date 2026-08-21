# Jarvis master status

Updated: 2026-08-21

Source of truth remains **current code + PROJECT_CONTEXT.md**.

Accepted standalone packs still in force:

- JF-010 actions / permissions
- JF-011 runtime / services
- JF-012 reminders
- JF-013 public GET research
- JF-013.5 intent
- JF-014 workspace intelligence
- JF-SKILLS-001 instruction/reference only (`scriptsAllowed=false`)

## Personal AI Operating Interface continuation

Branch: `work/jarvis-trusted-operator-ui` from
`cursor/jarvis-cloud-finalization-4838`.

The mounted `/jarvis-lab` route now uses a calm application shell with Home,
Assistant, Tasks, Research, Documents, Workspace, Content, Devices,
Automations, Evolution, Security, System, Activity, and Settings. Existing
runtime, WorkAgent, reminder, research, workspace, security, memory,
presentation, STT/speech, service, simulation and SSE paths are recomposed into
clear destinations. Raw IDs/providers/timings/provenance are on demand.

Trusted Operator UI includes Risk Brief, Permission Card, Verification Report,
Rollback Status, real read-only lease inventory, Owner Approval (Deny / Modify /
Allow Once), and an always-accessible Emergency Stop dialog. The hardening
branch connects those views to structured preflight, verification, rollback,
lease, containment, and Emergency Stop runtime state. Registered capability
status exposes descriptor description and side-effect class without invoking
the capability.

## Core hardening before Community Edition

Branch: `work/jarvis-core-hardening-pre-community` from exact source tree
`work/jarvis-trusted-operator-ui` at remote `c51f5c5`.

- Typed `ActionEffect` metadata and a configurable destructive/mass-change
  circuit breaker sit below the model.
- Mutations outside ActionGate are rejected. Unknown mutation metadata requires
  owner review; destructive unknown scope is blocked.
- Preflight, verification, rollback, and containment are structured runtime
  records and feed WorkAgent, Activity, and Trusted Operator UI.
- Emergency Stop is a REAL owner-only runtime latch: new autonomous execution
  and lease grants stop, ACTIVE leases are revoked, pending one-use approvals
  are invalidated, owned work receives cancellation, and only owner resume may
  clear the latch. Arbitrary OS process termination is not claimed.
- Lease inventory reports ACTIVE / EXPIRED / REVOKED / CONSUMED with owner
  approval provenance. No reusable approval token is persisted or exposed.
- Model profiles, inference provider boundary, evidence-based certification,
  and conservative routing are family-neutral. Qwen remains current owner
  configuration, not an authority or routing assumption.

See `docs/JARVIS_CORE_HARDENING_PRE_COMMUNITY.md` for exact semantics and
remaining limitations. Community installer, hardware profiler, Hugging Face
browser/downloader, GGUF picker, and automatic runtime installation are not part
of this branch.

## Execution reliability and recovery hardening

Branch: `work/jarvis-execution-recovery-hardening` from exact remote source
`work/jarvis-core-hardening-pre-community` at
`e7101599ed55f042d703f788884a4a5002466571`.

- WorkAgent cancellation and Emergency Stop now propagate one runtime-owned
  `AbortSignal` through CapabilityHost to cooperative typed handlers. Owner
  cancel, Emergency Stop, and timeout remain distinct structured reasons.
- Cancellation records distinguish request, handler acknowledgement, completion
  before cancellation, unsupported cancellation, and failed cancellation.
- A generic integrity-checked checkpoint inventory records actual prior recovery
  state under the configured Jarvis runtime root. Approval secrets are neither
  accepted nor stored.
- `operator.sandbox.writeConfig` is one bounded disposable mutation used to
  exercise preflight, owner approval, checkpoint, commit, deterministic re-read
  verification, restart idempotency, and rollback availability.
- `operator.sandbox.rollbackConfig` is a separate owner-authorized policy action.
  It validates checkpoint scope, restores only the fixed Jarvis-owned sandbox
  target, re-reads the restored state, and records `ROLLBACK_VERIFIED` only when
  the prior digest matches. Duplicate rollback is safe.
- Mutating timeout/unknown partial effect activates scoped containment. Shared
  runtime containment persists a minimal redacted inventory and reloads
  fail-closed.
- Task Center, Verification Report, Security checkpoint inventory, Activity,
  and owner approval reuse these real records. Raw checkpoint/cancellation IDs
  remain in Expert Details.

See `docs/JARVIS_EXECUTION_RECOVERY_HARDENING.md`. Community Edition, Setup
Wizard, Hugging Face selection/download, hardware profiling, runtime installers,
and distribution filtering remain explicitly out of scope.

## Capability Intelligence and Self Knowledge

Branch: `work/jarvis-capability-intelligence` from exact remote source
`work/jarvis-execution-recovery-hardening` at
`2d72ef59c95ac3b64a6fd30d7594ac66a783aac5`.

- Self Knowledge reuses CapabilityHost, CapabilitySelfModel, model profile and
  certification registries. It separates runtime readiness, maturity,
  permission, local acceptance, simulation, and distribution.
- Capability Graph resolves only registered runtime evidence across REQUIRED,
  OPTIONAL, and ALTERNATIVE dependencies. Missing IDs cannot become available
  through model output.
- CapabilityGapResolver produces structured blockers and ordered safe paths.
  WorkAgent may insert only bounded, input-compatible existing/composed routes;
  every execution still passes CapabilityHost and ActionGate.
- Capability acquisition now separates discovery, review, testing, security
  review, verification, owner approval, installation, registration/trust, and
  enable/execution. It performs none of those effects itself.
- Verified competence requires deterministic VERIFIED outcome evidence and is
  deduplicated by observation ID. Repeated structured blockers create weakness
  signals; reflection or handler OK cannot claim improvement.
- Assistant and Capability Explorer answer capability, CCTV, computer-control,
  blocker, unavailable, and verified-improvement questions from structured
  evidence rather than model imagination.
- CCTV remains SIMULATION plus an owner-only PREPARE_CONTRACT provider/profile
  architecture. Credential values, credential-bearing URLs, uncontrolled LAN
  scanning, cloud footage upload, and VIEW-to-CONTROL promotion are rejected.

See `docs/JARVIS_CAPABILITY_INTELLIGENCE.md`. Real CCTV/RTSP/ONVIF/NVR,
owner LAN, device control, Windows services, local model state, and browser
visual acceptance remain `BLOCKED_LOCAL_ACCEPTANCE`.

## Authoritative Goal Catalog and typed input adapters

Branch: `work/jarvis-goal-catalog-input-adapters` from exact remote source
`work/jarvis-capability-intelligence` at
`deab0bb96a02ab0465171221b97c0be0e8b58ca8`.

- GoalCatalog declares a bounded set of existing end-to-end owner objectives;
  it does not replace WorkAgent or CapabilityGraph.
- Exact trusted adapters validate against registered capability schemas and
  cannot create path, credential, capability, permission, confirmation, shell,
  privilege, risk, or administrator authority.
- Compatibility, ambiguity, missing owner input, scope, route evidence, and
  verification expectations are structured. Unknown goals remain unsupported.
- WorkAgent may try only bounded declared safe alternatives. Private/higher-risk
  scope, setup, credentials, installation, or new privilege stop for owner
  decision.
- Goal outcome evidence and CapabilitySelfModel competence remain distinct.
  Failed capability attempts are retained even when an alternate route completes
  the goal.
- System and Task Center show human goal readiness/routes first and keep IDs and
  adapter evidence in Expert Details.

See `docs/JARVIS_GOAL_CATALOG_INPUT_ADAPTERS.md`. Full document parsing, real
CCTV/devices, owner filesystem/provider behavior, and browser/hardware acceptance
remain partial, prepared, or `BLOCKED_LOCAL_ACCEPTANCE` as documented.

## Secure pending-goal continuation

Branch: `work/jarvis-pending-goal-continuation` from exact remote source
`work/jarvis-goal-catalog-input-adapters` at
`a7a11f5e8cafe17f26d1cece7e6f6bb4bad99b03`.

- Missing declared inputs create one expiring, session-bound PendingGoal and one
  honest `WAITING_INPUT` WorkAgent task.
- Persisted context contains redacted intent, GoalCatalog identity/version,
  validated fields, missing fields, scope, route/adapter evidence, expiry, and
  bounded idempotency receipts. It contains no execution authority or secrets.
- Continuation fills only the declared missing field, detects cancellation,
  revision and goal drift, and requires explicit selection for ambiguous or
  cross-session context.
- Resume revalidates the goal, trusted adapter, capability schema, availability,
  gap, ActionGate, permission/lease, Emergency Stop, containment, and
  verification. Concurrent duplicate resume is serialized.
- Reminder creation is the cloud-safe verified mutation: no record before owner
  approval, one typed record after approval, independent store re-read yields
  VERIFIED, and duplicate continuation does not create another record.
- CCTV brand/model continuation re-runs the provider gap and remains owner-only
  `PREPARE_CONTRACT`; no credentials, LAN scanning, or real connection are
  claimed.

See `docs/JARVIS_PENDING_GOAL_CONTINUATION.md`. Owner notification delivery,
Windows/process restart acceptance, browser visuals, live CCTV/providers, local
models, and hardware remain `BLOCKED_LOCAL_ACCEPTANCE`.

Future providers remain honest contracts: MinerU, Tokei, social/video,
Content Studio, and local computer use are `PREPARE_CONTRACT`; OpenHarness,
Awesome LLM Apps and Security Academy sources are `REFERENCE_ONLY`;
FlashInfer is `BENCHMARK_LATER`; Orbien remains deferred. CatchMe was studied,
but capture-everything/global-input/admin defaults are rejected. Personal
Digital Memory is privacy-first staging feeding existing canonical memory,
never a competing authority store. Hardware/perpetual capture is
`BLOCKED_LOCAL_ACCEPTANCE`.

This continuation added the security-first layer **on top of** those packs,
then the cloud-safe work-agent / evolution / command-center layer,
then a runtime-integration pass: CapabilityHost work-agent invocation,
isolated SQLite task/evolution stores, and night-cycle consolidation.
It did not restart the project or rewrite Discord.

See `JARVIS_SECURITY_STATUS.md` for SEC/JF-014.5+ labels.

Command-center SSE browser QA, Ollama multi-step, Whonix/PRIVATE_BROWSER,
mic, CCTV, and Discord voice remain **BLOCKED_LOCAL_ACCEPTANCE**. Do not
treat unit tests as live verified.
