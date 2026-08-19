# Jarvis Core + Discord Client + Presentation Engine Addendum

This addendum updates the project direction after the P0 baseline and MEMORY-001 design work.

It does **not** replace:

- `PROJECT_CONTEXT.md`
- `AGENTS.md`
- the original Cursor handoff pack
- `JARVIS_MEMORY_ARCHITECTURE.md`
- `JARVIS_UI_UX_VISION.md`

It clarifies one architectural principle:

> Jarvis is the central reasoning platform.  
> Discord/Digital Me is one client/subsystem that can use Jarvis.  
> Persona and Voice are independent presentation layers.

## Install

Copy this addendum into the repository root:

`C:\Users\piriy\Documents\DiscordBOT`

Then open Cursor and paste the contents of:

`CURSOR_JARVIS_PLATFORM_PROMPT.md`

## Current verified state this addendum assumes

The latest Cursor session reported a stable non-live baseline:

- lint PASS
- TypeScript tests: 61 passed (`core` + `research` + `jarvis_memory` + `jarvis_platform`)
- P0 research/Qwen consistency fixes completed
- MEMORY-001 is design-only
- JARVIS-001/002 contracts exist in `src/jarvis/` and are not live-wired
- no SQLite dual-write migration has started
- no `/jarvis-lab` implementation has started
- no live Discord/research/voice verification was performed

The next architectural work should therefore avoid jumping directly into MEMORY-002 or a dashboard rewrite.

Recommended next sequence:

1. JARVIS-001/002 — DONE
2. JARVIS-003 wrap `ResponseGenerator` behind PresentationEngine
3. decouple live persona selection from voice selection (JARVIS-004)
4. Discord adapter to Jarvis Core
5. only then integrate broader memory and UI layers
