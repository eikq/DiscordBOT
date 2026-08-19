---
name: jarvis-night-agent-safety
description: Safety rules for the Night Autonomous Coding Worker. Use when editing src/agent, night-agent config, Cursor/Grok coding workers, worktrees, reports, CLI policy, or overnight unattended runs.
---

# Night Agent safety

Night Agent is not Jarvis Core. Do not give Core/lab unrestricted file or shell tools.

## Required isolation

- Work only in the isolated Night worktree.
- Do not merge, reset, clean, or manipulate the owner's dirty primary tree.
- Manual CLI only unless an explicit scheduler task is approved.
- Cursor/Grok is the coding worker when the Grok-only override is active; do not silently re-enable local Qwen fallback.

## Policy

- Follow `NIGHT_AGENT_SAFETY_POLICY.md`, command allowlists, and `agent` preflight.
- Record honest blocked/failed provider results. Never invent pass counts.
- Do not expose `.env`, tokens, transcripts, datasets, or RVC weights in reports.
