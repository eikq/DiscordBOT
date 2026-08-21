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
Rollback Status, prepared lease inventory, Owner Approval (Deny / Modify /
Allow Once), and an always-accessible Emergency Stop dialog. Emergency Stop is
honestly `PREPARED`: no runtime stop/revocation effect is claimed. Registered
capability status now exposes descriptor description and side-effect class
without invoking the capability.

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
