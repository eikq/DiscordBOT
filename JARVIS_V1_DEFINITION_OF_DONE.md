# Jarvis Core v1 — Definition of Done

"Finish Jarvis first" needs a concrete gate.

Jarvis v1 is complete enough to return focus to Discord when the following are true.

## A. Core

- [ ] `JarvisCore` accepts a client-agnostic request.
- [ ] It returns a structured result, not only free-form text.
- [ ] Core has no dependency on Discord transport.
- [ ] current Qwen3.8 provider is usable through the core.
- [ ] degraded/offline behavior is explicit.

## B. Memory

- [x] canonical local memory store exists. (SQLite `data/jarvis/jarvis.db`; unit-tested on temp DBs)
- [x] working / episodic / semantic / social / identity concepts are represented. (schema + store APIs)
- [x] provenance exists for factual memory.
- [x] supersession/forgetting semantics exist.
- [x] existing SocialMemoryBrain data is preserved or safely projected. (JSON/JSONL still live; optional dual-write)
- [x] retrieval has tests. (JF-004)
- [x] Obsidian remains an optional human-readable projection.
- [x] vector search is an index, not canonical truth. (Qdrant not added; payload helpers only)

## C. Tools

- [x] Jarvis has a generic capability/tool registry. (JF-005, unit-tested)
- [x] read-only MCP research works through that abstraction. (adapter; not live world-intel verified)
- [x] tool results are structured and untrusted by default.
- [x] timeouts/failures are explicit.
- [x] presentation layer cannot call tools directly. (presentation modules do not import the registry)

## D. Standalone client

At least one non-Discord client works.

Preferred:
- `/jarvis-lab` or standalone dashboard route
- text input
- response view
- current tool activity
- memory references
- runtime state

A CLI can exist as an additional test client.

Notes:
- CLI `npm run jarvis:ask` exists (JF-002; unit-tested, not live Ollama verified)
- Isolated `/jarvis-lab` command center exists (JF-006/JF-007 + UI-R1–R8; CSS/SVG; live lab UI verified 2026-08-19)
- JF-008 microphone/STT is live-verified on `/jarvis-lab`
- JF-008B measured warm typed Core turns on this 27B stack (simple median ~0.38s; ctx-reload warmup ~7.4s). The earlier 120.7s mic turn was not warm decode speed.
- JF-009 native Edge-TTS is live-verified as a lab API audio payload (2026-08-19). Browser speaker start was not measured. Standalone clone live speech was not verified (no standalone consent).
- Digital Me dashboard was not replaced

## E. Voice

- [x] local microphone input can reach STT without Discord. (JF-008; `/jarvis-lab` HyperX → Qwen3-ASR `:8765`)
- [x] final text reaches Jarvis Core. (Heard transcript + Core response on `/jarvis-lab` 2026-08-19)
- [x] result can be spoken locally. (JF-009; typed `speak=true` → Edge-TTS MP3 payload LIVE_VERIFIED 2026-08-19; browser speaker start not measured)
- [x] voice selection is separate from persona selection. (Gam voice + Jarvis persona on `/jarvis-lab`; clone speech stayed unavailable without standalone consent)
- [x] cancellation/interruption is supported or explicitly staged. (unit-tested `TurnGate` + `POST /api/jarvis/speak/cancel`; live cancel not measured)
- [x] cloned voices remain consent-gated. (standalone `STANDALONE_CLONE_CONSENT`; Discord consents are not auto-granted)

## F. Presentation

- [ ] Brain / Persona / Voice are independent.
- [ ] voice-only profile works.
- [ ] persona-only profile works.
- [ ] verified facts survive persona rendering.
- [ ] profile state is not stored only in LLM context.

## G. Permissions / actions

- [ ] tool/action side effects are classified.
- [ ] destructive/sensitive actions require explicit approval.
- [ ] read-only actions can be automated according to policy.
- [ ] action results are auditable.

## H. UI

- [ ] existing dashboard still works.
- [ ] Jarvis view exists independently of Discord status.
- [ ] core state is visible (idle/listening/thinking/tool/speaking/degraded).
- [ ] 3D Fluctlight-style visualization is optional and performance-safe.
- [ ] reduced-motion/minimal-GPU fallback exists.

## I. Verification

- [ ] lint passes.
- [ ] TypeScript tests pass.
- [ ] Python tests pass where environment permits.
- [ ] build passes.
- [ ] standalone text smoke is live-verified.
- [ ] standalone local voice smoke is live-verified.
- [ ] memory persistence is verified across restart.
- [ ] no new privacy/consent regression.

## Return-to-Discord gate

Only after the above core pieces are stable should the project prioritize:

- DiscordJarvisAdapter
- live persona/voice switching in Discord
- Jarvis tool use from Discord
- shared Jarvis memory in Discord
- Discord live voice quality
