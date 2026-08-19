# Runtime Resource Profiles — Proposed

This document proposes profiles for the RTX 5090 Laptop 24 GB + 64 GB RAM machine.

Do not treat numbers here as measured facts until benchmarked on the actual machine.

Implemented lab vs this proposal: `JARVIS_STANDALONE=1` applies code profile `interactive` (`src/jarvis/standalone/runtimeProfile.ts`, ADR-012). That is not this document's `VOICE_INTERACTIVE`. `start:local` remains the voice coexistence cap (`LLM_VOICE_GPU_LAYERS`, default 48). JF-009 native speech uses Edge-TTS and does not reserve or auto-start JaiTTS/RVC in the lab (ADR-013).

## Why profiles are needed

The current launcher intentionally caps LLM GPU layers so these services can coexist:

- Qwen3.8 LLM
- Qwen3-ASR
- JaiTTS
- RVC
- Discord voice pipeline

A future coding worker has a different goal from live voice interaction.

Therefore resource allocation should be profile-driven rather than one universal setting.

## Profile: VOICE_INTERACTIVE

Priority:
low-latency voice and stable coexistence.

Keep resident where possible:

- STT
- RVC
- selected TTS path
- Qwen with conservative GPU allocation

Optimize for:

- no OOM
- low barge-in latency
- no service eviction
- acceptable LLM response latency

## Profile: RESEARCH

Priority:
larger reasoning context and tool use.

Possible behavior:

- voice services may remain available but can be deprioritized
- larger Qwen context if memory permits
- explicit timeout for MCP tools
- release idle LLM using current keep-alive policy if appropriate

## Profile: DEV_NIGHT

Priority:
local coding-agent throughput and context.

Proposed behavior:

- do not load voice services unless required by tests
- do not keep a separate Discord LLM model resident
- allocate most GPU resources to one local coding LLM
- use system RAM for repository indexing, state, and optional model/cache overflow where runtime supports it
- context target should be benchmark-driven (start moderate; increase only after measuring)
- reset coding-agent conversation between tasks and persist state in files
- run live voice/CCTV only with mocks/sample streams during unattended development

## DEV_NIGHT measured 2026-08-19 (this machine)

Discord off. ASR/JaiTTS/RVC stopped for the probe. Qwen `digital-me-qwen38:27b-ad-q4km`, agentSlots=1.

- Idle after voice stop: 1251 / 24463 MiB GPU; RAM 64956 MB total / 36644 MB free
- 16K: 18181 MiB, cold load 6.39 s, warm prompt 1258 tok/s, warm gen 51 tok/s
- 32K: 19220 MiB, cold load 7.37 s, warm prompt 1369 tok/s, warm gen 57 tok/s
- 48K: 20250 MiB, cold load 7.33 s, warm prompt 1286 tok/s, warm gen 50 tok/s
- Recommended coding context: **32768** (fits; more headroom than 48K; do not assume largest is best)
- Ollama `/api/ps` still labels the loaded quant `Q8_0`; do not silently swap models

## Required future benchmark

Record:

- VRAM before model load
- VRAM after Qwen load
- RAM usage
- prompt-processing speed
- token-generation speed
- context length
- GPU layers/offload configuration
- service coexistence
- OOM behavior

Do not optimize purely for maximum context. A stable 32K/64K-style workflow with task resets may outperform a huge continuously growing session.
