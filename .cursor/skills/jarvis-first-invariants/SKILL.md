---
name: jarvis-first-invariants
description: Enforces standalone Jarvis-first architecture and safety invariants. Use when changing Jarvis Core, lab UI, memory, capabilities, speech, Night Agent, Discord compatibility, or when a task could rewrite Discord, add Qdrant, persist raw audio, or merge agent worktrees.
---

# Jarvis-first invariants

Keep Discord compiling; do not add Discord features. Jarvis Core stays transport-agnostic.

## Hard rules

- Canonical memory is SQLite. Do not make Qdrant/embeddings canonical.
- Do not persist raw audio. Voice cloning stays consent-gated.
- Presentation never calls tools. CapabilityHost owns invoke.
- No unrestricted filesystem/shell for Core or `/jarvis-lab`.
- Night Agent is separate: isolated worktree, no merge/reset of owner dirty files.
- Never invent live Discord/model/voice/research results.
- Never commit, push, reset, clean, or edit `.env`/secrets unless the owner asked.

## Evidence labels

`IMPLEMENTED`, `UNIT_VERIFIED`, `OFFLINE_VERIFIED`, `LIVE_VERIFIED`, `HUMAN_QUALITY_VERIFIED`.
