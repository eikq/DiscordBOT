---
name: jarvis-runtime-qa
description: Use when verifying or diagnosing the standalone Jarvis runtime, observable pipeline, degraded states, UI controls, or performance.
version: 1.0.0
---

# Jarvis runtime QA

- Verify observable behavior with evidence; never fabricate live service results.
- Distinguish unit-tested, offline/simulated verified, live verified, and human-quality verified.
- Prefer the smallest relevant test before the whole-repository gate.
- Keep Discord out of standalone Jarvis verification.
- Check typed Ask, streaming, memory evidence, tool results, Persona/Voice independence, microphone, speech, camera, quality modes, reduced motion, and 2D fallback when relevant.
- Treat unavailable local AI services as degraded/unavailable, not as proof that fallback output came from Qwen, STT, or voice cloning.
- Measure performance after the scene settles and report the actual viewport and quality mode.
