# Memory + UI Addendum Tasks

These are additional future tasks. Merge them into the main `TASKS.md` only after Cursor audits the repository.

## MEMORY-001 — Memory interfaces and schema design
Priority: P1/P2 after baseline stabilization
Status: DONE

Goal:
Design a general Jarvis memory API around the current SocialMemoryBrain.

Deliver:
- TypeScript interfaces
- proposed SQLite schema/migrations
- provenance model
- no destructive migration yet

Acceptance:
- existing SocialMemoryBrain behavior still works
- memory types are explicitly separated
- privacy and delete/forget semantics are specified

## MEMORY-002 — SQLite canonical memory adapter
Depends on MEMORY-001
Status: DONE (JF-003; unit-tested; JSON/JSONL still authoritative)

Goal:
Introduce SQLite behind an adapter while preserving current files during transition.

Acceptance:
- dual-write or migration strategy is testable
- facts and episodes keep provenance
- contradictions are superseded, not silently overwritten

## MEMORY-003 — Hybrid retrieval prototype
Depends on stable embeddings

Goal:
Combine structured filters + lexical search + semantic vector candidates.

Acceptance:
- retrieval returns canonical memory IDs
- vector DB is not authoritative storage
- evaluation fixtures compare retrieval quality

## MEMORY-004 — Obsidian projection v2

Goal:
Improve the existing vault export to represent Jarvis memory types.

Acceptance:
- human-readable notes
- stable memory IDs in note properties
- backlinks/relationships
- no unsafe automatic bidirectional overwrite

## UI-001 — `/jarvis-lab` real-time 3D core prototype

Goal:
Create a separate experimental UI route without replacing the current dashboard.

States:
- IDLE
- LISTENING
- THINKING
- SPEAKING
- RESEARCH
- ALERT
- DEGRADED

Acceptance:
- state changes are visible
- reduced motion works
- normal dashboard remains unchanged
- renderer can be disabled
- performance is measured

## UI-002 — Memory Explorer prototype
Depends on MEMORY-001

Goal:
Show selected memory nodes and provenance around the core.

Acceptance:
- never render the entire DB blindly
- click node -> canonical memory details/evidence
- search and type filters work

## UI-003 — CCTV intelligence panel
Depends on CCTV MVP

Goal:
Integrate camera event data into the Jarvis visual language.

Acceptance:
- shows observable facts/confidence
- no intent/criminality inference
- event links to snapshot/clip
- privacy/retention controls visible

## UI-004 — Optional cinematic boot/demo
Priority: Low

Goal:
Adapt the image-sequence scroll-cinematic idea from the provided prompt pack for a privacy-safe demo/intro.

This is not the operational UI.

Acceptance:
- optional asset download
- reduced-motion/video fallback
- dashboard can launch without cinematic assets
