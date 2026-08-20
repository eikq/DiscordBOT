# Jarvis master status

Updated: 2026-08-20

Source of truth remains **current code + PROJECT_CONTEXT.md**.

Accepted standalone packs still in force:

- JF-010 actions / permissions
- JF-011 runtime / services
- JF-012 reminders
- JF-013 public GET research
- JF-013.5 intent
- JF-014 workspace intelligence
- JF-SKILLS-001 instruction/reference only (`scriptsAllowed=false`)

This continuation added the security-first layer **on top of** those packs,
then the cloud-safe work-agent / evolution / command-center layer,
then a runtime-integration pass: CapabilityHost work-agent invocation,
isolated SQLite task/evolution stores, and night-cycle consolidation.
A later research-addendum pass added isolated `ops.db` traces, a versioned
runtime spec, model trust tiers, fixture-only certification, and Command
Center intelligence surfaces. It did not restart the project or rewrite Discord.

See `JARVIS_SECURITY_STATUS.md` for SEC/JF-014.5+ labels.

Command-center SSE browser QA, Ollama multi-step, Whonix/PRIVATE_BROWSER,
mic, CCTV, Discord voice, live model certification, and real media pipelines
remain **BLOCKED_LOCAL_ACCEPTANCE** (LA-001–LA-025). Do not treat unit tests
as live verified.
