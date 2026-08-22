# Jarvis Qwen runtime, conversation memory, and build studio

Updated: 2026-08-22

Status: `IMPLEMENTED` + `UNIT_VERIFIED` / `OFFLINE_VERIFIED` for the architecture
below. Do not treat mocked inference as `LIVE_VERIFIED`.

## Canonical local runtime

Standalone Jarvis uses the same OpenAI-compatible llama.cpp backend that OpenCode
already uses. Discord / Digital Me still uses `LLM_BASE_URL` / `LLM_MODEL`
(Ollama, default `http://127.0.0.1:11434/v1` and `digital-me-qwen38:27b-ad-q4km`
when those env vars are unset). Jarvis lab/text paths pass `8086` / `qwen38-cyber`
explicitly and do not silently fall back to another model.

| Field | Value |
|---|---|
| Profile id | `qwen38-cyber` |
| Display name | Qwen3.8 27B Cyber Abliterated |
| Runtime | `openai-compatible` |
| Base URL | `http://127.0.0.1:8086/v1` |
| Context | 32768 |
| Max output | 4096 |
| Auth | `Authorization: Bearer` from env |

Environment (never commit secrets):

- `LOCAL_QWEN_API_KEY` (preferred)
- `JARVIS_QWEN_API_KEY`
- `LLM_API_KEY`
- `JARVIS_LLM_BASE_URL` / `LOCAL_QWEN_BASE_URL` (default `http://127.0.0.1:8086/v1`)
- `JARVIS_LLM_MODEL` / `LOCAL_QWEN_MODEL` (default `qwen38-cyber`)

The GGUF filesystem path is not a Jarvis identity. The API alias is.

Health is explicit: `MODEL_READY`, `MODEL_OFFLINE`, `MODEL_UNREACHABLE`,
`MODEL_NOT_FOUND`, `AUTH_FAILED`. Offline replies use
`Qwen local ยังไม่พร้อม ผมยังไม่ได้เริ่มงานนี้` and do not silently switch models.
`reasoning_content` and `<think>` never become the visible answer, history, or
Obsidian.

## Conversation history

SQLite schema v3 adds `conversation_sessions` and `conversation_turns`.
Canonical store: `SqliteJarvisMemoryStore` / `ConversationHistoryStore`.

- Persist the OWNER visible turn before long work.
- Persist the final visible JARVIS answer on completion.
- Streaming does not write one row per token (`started` → `completed`).
- On process open, leftover `started` rows become `incomplete`.
- Obvious credentials are redacted before persist.
- Hidden chain-of-thought is not stored.

## Durable memory

SQLite remains canonical. Categories stay typed (working, referential, episodic,
semantic, procedural, owner preference, project, decision). Owner facts have
stronger provenance than model or web output. Contradictions supersede; they do
not delete history. Untrusted actors (`webpage`, `research`, `document`, `tool`,
`model`) cannot write owner preference/alias memory.

## Obsidian view

Path: `data/jarvis/obsidian/` (gitignored with other `data/jarvis/` files).

`OBSIDIAN != AUTHORITY`. Markdown is a rebuildable projection from SQLite
(`projectObsidianVault`). Layout:

- `Home.md`
- `Daily/YYYY-MM-DD.md`
- `Conversations/<session-id>.md`
- `Memory/Owner.md`
- `Projects/JARVIS.md`
- `Plans/<goal-id>.md`

## Context builder

`buildJarvisContext` packs current request, recent completed turns, session
summary, active goal, plan, pending permission, active memories, and project
notes. Dynamic budget: **19000 tokens** of the 32768 window. The rest is reserved
for system instructions, tool schemas, the model response, tool results, and
margin. Stale / superseded memories are excluded.

## Permission-first policy

Uncertainty is not a generic refusal. Outcomes are `EXECUTE`, `ASK_PERMISSION`,
`NEED_INPUT` / `NEED_CAPABILITY`, then `REFUSE`.

`PermissionProposal` is a short owner-facing card (goal, summary, scope,
duration, effects). Presence shows `[อนุญาตงานนี้] [ครั้งเดียว] [ไม่]` with
technical risk behind `รายละเอียด`. Goal-scoped `THIS_GOAL` leases skip
repetitive file-by-file prompts. The model cannot issue or extend its own lease.
`UNRESTRICTED_SHELL` / `ADMIN` / global filesystem remain blocked.

Safety invariants are unchanged:

- LLM OUTPUT != EXECUTION AUTHORITY
- DATA / MEMORY / PLAN / PERSISTENCE != AUTHORITY
- SEE != OPEN != PLACE != FOCUS != CLICK != TYPE != SUBMIT

## Build software / website

Goals `BUILD_WEBSITE` and `BUILD_SOFTWARE` resolve from natural Thai/English.
Flow: intent → plan (`software.planBuild`) → visual review → owner approval →
permission proposal if needed → `software.applyBuild` → sandbox artifacts.

Plans are stored in SQLite `build_plans`. Files are written only after the plan
is `APPROVED`/`EXECUTING`/`VERIFYING`/`COMPLETED`, and only under
`data/jarvis/builds/<slug>/`. Apply does not run unrestricted shell.

Pending permission and THIS_GOAL leases persist in operational SQLite
`data/jarvis/runtime/permissions.db` (`PERSISTENCE != AUTHORITY`). Restart
reloads then revalidates goal, target, effects, expiry, policy fingerprint, and
capability availability. Failed revalidation becomes `EXPIRED` /
`NEEDS_REAPPROVAL` / `INVALID_AFTER_RESTART`. Confirmation tokens stay in RAM
only; SSE `PERMISSION_SNAPSHOT` reuses an unused token so a browser refresh can
show the same pending card.

Owner allow/deny from voice, text, Presence buttons, and the confirm API enter
the same history. Button grants use `[อนุญาตงานนี้]` / `[อนุญาตครั้งนี้]` /
`[ไม่อนุญาต]` with `metadata.source` `ui_action`. Expressed text is stored
verbatim.

Model identity for “ตอนนี้ใช้โมเดลอะไร” comes from `ModelProfileRegistry` +
authenticated `/models`, never from Qwen self-description:
`Qwen3.8 27B Cyber Abliterated` alias `qwen38-cyber`.

Approved apply uses typed `ProjectWorkspace` capabilities (`project.createWorkspace`,
`writeFile`, `installDependencies`, `runScript`, `runTests`, `build`,
`startDevServer`, `stopDevServer`). Allowed package-manager ops are `npm install`
and `npm ci` inside the workspace. Scripts resolve from registered
`package.json` names (`build|test|lint|dev|preview`). Preview binds
`127.0.0.1` only. Unit tests skip live npm unless `JARVIS_LIVE_NPM=1`.
Failure proposes a bounded correction (`retryMutation: false`) and does not
blind-retry mutation.

## Realtime Presence UI

`/jarvis` keeps the cinematic Presence. When plan events arrive over the
existing ops/SSE bus, a Build / Plan surface updates UNDERSTAND → PLAN →
REVIEW → PERMISSION → SCAFFOLD → INSTALL → BUILD → TEST → PREVIEW → VERIFY →
DONE from real event types (`PLAN_CREATED`, `PLAN_APPROVED`,
`PERMISSION_REQUESTED`, `PERMISSION_SNAPSHOT`, `PLAN_STAGE_*`,
`ARTIFACT_CREATED`, `PREVIEW_READY`, `VERIFY_*`). A localhost Preview URL may
appear when a Jarvis-owned dev server is running. History is a light HUD, not a
chat replacement. No fake percentages. No raw reasoning.

## What stays gated

CLICK / TYPE / SUBMIT, unrestricted shell, global filesystem, Night Agent coding
tools, Discord voice capture, and Qdrant-as-canonical-memory stay out of this
work. Cursor remains the development agent; the local Qwen coding worker is not
a replacement.
