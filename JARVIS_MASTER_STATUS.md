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
