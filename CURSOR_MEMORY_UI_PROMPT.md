# Cursor Prompt — Add Memory Architecture and Jarvis UI Direction

Read:
- `PROJECT_CONTEXT.md`
- `AGENTS.md`
- `JARVIS_MEMORY_ARCHITECTURE.md`
- `JARVIS_UI_UX_VISION.md`
- `MEMORY_UI_TASKS.md`

Important:
These files describe a proposed future direction. Do not immediately replace working SocialMemoryBrain code or the existing dashboard.

First:

1. Inspect the current SocialMemoryBrain, FriendMemoryManager, Obsidian vault export, embeddings path, dashboard, server APIs, and existing CSS/components.
2. Compare current code to the proposed design.
3. Produce a short implementation plan that preserves backward compatibility.
4. Identify which pieces can be implemented now without live Discord/hardware.
5. Start only with the smallest safe design/prototype task.

Recommended first implementation if the repository baseline is stable:
- create `/jarvis-lab` as an isolated UI experiment with mocked system states
OR
- define memory interfaces/schema without migrating data

Do not:
- delete existing memory files
- make Qdrant the sole source of truth
- make Obsidian a runtime dependency
- rewrite the dashboard wholesale
- weaken consent/privacy
- allocate significant GPU UI effects without measuring impact
- claim Fluctlight is a real scientific memory architecture

When a prototype is ready, report:
- files changed
- tests/build run
- performance implications
- what remains experimental
- what must be reviewed before integration
