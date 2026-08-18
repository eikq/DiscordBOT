# Current Project State for Cursor

> This is a condensed operational view derived from `PROJECT_CONTEXT.md`.
> The repository itself and tests remain the strongest source of truth.

## Current baseline

Repository:
`C:\Users\piriy\Documents\DiscordBOT`

Package:
`digital-me-discord-bot` `0.1.0`

Current local target hardware:
RTX 5090 Laptop 24 GB VRAM + 64 GB system RAM profile.

## Current default runtime stack

- STT: Qwen3-ASR-1.7B, fallback 0.6B, local HTTP `:8765`
- LLM: Ollama `digital-me-qwen38:27b-ad-q4km`, OpenAI-compatible `:11434/v1`
- Embeddings: optional Qwen3-Embedding-0.6B HTTP `:8767`, with fallback path
- RVC: authenticated local service `:8766`
- Source TTS: JaiTTS-F5TTS `:8768`, Edge-TTS for short reactions/fallback
- Research: pinned `world-intel-mcp` via local stdio MCP environment
- Dashboard: local React + Express `127.0.0.1:3000`

## Important current resource behavior

`start:local` deliberately limits LLM GPU offload with `LLM_VOICE_GPU_LAYERS` so ASR, JaiTTS and RVC can remain resident.

Therefore, do not assume an LLM context or GPU-layer setting can be increased without affecting voice services.

The launcher currently does not automatically start:

- embedding HTTP server
- world-intel install/setup

Research has separate setup/smoke commands.

## Implemented and locally covered

See `PROJECT_CONTEXT.md` for the authoritative detailed list. Broadly:

- dashboard/server build
- social brain and deterministic turn-taking
- persona-scoped examples
- inspectable social memory
- consent-gated capture/training workflow
- RVC client/training orchestration
- local TTS/RVC path
- barge-in cancellation logic
- simulators/stress tests
- research allowlist/tool loop unit tests
- privacy defaults

## Still requiring real live verification

Do not claim complete until actually verified:

- real Discord login + slash registration
- live voice join/receive/playback and reconnect behavior
- real Discord Opus → STT → response → TTS/RVC → playback
- human listening quality of a trained clone
- live barge-in in VC
- Qwen3-ASR production quality
- Qwen3.8 latency/quality alongside the full voice stack
- JaiTTS naturalness
- world-intel live freshness/citations
- live `/research`
- embedding HTTP service integration
- production behavior under GPU contention

## Known unfinished areas

- one-command launcher does not bring up every optional local service
- owner LoRA training/deployment is not complete and the current training target is stale relative to Qwen3.8 27B
- research is not automatically invoked from spoken voice chat
- true streaming TTS is not implemented
- current JaiTTS checkpoint is non-commercial
- no zero-latency voice changer
- several historical docs contain incorrect/inflated status claims

## Dirty working tree warning

The source context recorded a research/Qwen working-tree drop that was modified/untracked at the time it was written.

Cursor must run `git status` again and treat the current output as authoritative.

Never assume those files were committed after the context document was written.
