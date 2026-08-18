# Digital Me / Jarvis — Global Agent Instructions

This file defines global engineering instructions for AI coding agents working in this repository.

## 1. Source of truth

Before changing code:

1. Read `PROJECT_CONTEXT.md`.
2. Inspect the current repository and `git status`.
3. Treat the current working tree and tests as stronger evidence than historical documentation.
4. Do not trust `PHASE0`–`PHASE8` status documents as current truth.
5. If documentation conflicts with code, verify the code path and record the discrepancy.
6. Never invent live-test results, transcripts, voice quality, benchmark numbers, or service availability.

## 2. Current project identity

This repository is `digital-me-discord-bot`, a Thai-first local Discord voice companion evolving toward a broader Jarvis-style local agent.

Current major subsystems include:

- Discord voice receive/playback
- Qwen3-ASR local STT
- SocialBrain turn-taking logic
- SocialMemoryBrain + older FriendMemoryManager
- persona-scoped behavior examples
- local Ollama Qwen3.8 27B LLM
- JaiTTS / Edge-TTS source TTS
- local authenticated RVC voice conversion/training
- React + Express local dashboard
- read-only world-intel MCP research layer
- consent-gated voice training workflow

Do not rewrite these as a greenfield project.

## 3. Working-tree safety

The user may have valuable dirty or untracked work.

Before edits:

- run `git status`
- inspect relevant diffs
- preserve unrelated changes
- never run destructive cleanup commands against untracked files
- never reset, checkout, clean, or revert unrelated user changes
- do not commit, push, merge, rebase, or open a PR unless the user explicitly asks

Avoid destructive commands such as:

- `git reset --hard`
- `git clean -fd`
- blanket file deletion
- deleting `.runtime`, local datasets, voice models, or memory stores

If a task requires destructive migration, stop and request approval.

## 4. Secrets and private data

Never expose, print, commit, copy into documentation, or upload:

- `.env`
- Discord tokens
- API keys
- bearer tokens
- private transcripts
- raw consented WAV datasets
- RVC model weights
- `data/brain/`
- `data/memory/`
- local persona/consent stores
- private CCTV footage or credentials

Use placeholders in examples.

## 5. Voice consent is a hard invariant

Voice cloning and raw-audio capture must remain consent gated.

Never weaken:

- `RECORD_RAW_AUDIO=false` default
- per-server consent
- Allow/Decline interaction
- capture-target scoping
- revoke behavior
- dataset isolation

A consented conversation participant may be transcribed for conversation behavior, but raw training audio must only be stored for the selected consented capture target.

Generated cloned audio must not be represented as the real person.

## 6. Research safety is a hard invariant

The world-intel research integration is read-only.

Maintain:

- tool allowlist
- rejection of mutating tools
- `<untrusted_tool_output>` treatment
- source ledger
- no invented citations
- graceful upstream failure reporting

Do not automatically wire research into live voice without an explicit product task and timeout/UX design.

## 7. Architecture discipline

Prefer extension over rewrite.

Keep major concerns separated:

- `src/bot/brain` — social/decision policy
- `src/bot/personality` — response/persona behavior
- `src/bot/memory` — memory
- `src/bot/stt` — transcription providers
- `src/bot/tts` — speech providers/output
- `src/bot/voice` — consent/dataset/RVC workflow
- `src/bot/llm` — local LLM provider/tool loop
- `src/bot/research` — research/MCP
- `src/jarvis` — presentation-neutral Core + PresentationProfile contracts (not wired into the live Discord loop yet)
- dashboard/server code — operator control surface

Brain, Persona, and Voice are independent selections. Voice selection alone must not load persona memory; persona selection alone must not select an RVC model. Preserve live `/voice` coupling through the compatibility mapper until an explicit command-behavior task.

New Jarvis capabilities should be modular and replaceable rather than hard-coupled to one LLM or model.

Platform addendum: `JARVIS_PLATFORM_TASKS.md`, `CURSOR_JARVIS_PLATFORM_PROMPT.md`. Do not start MEMORY-002 or JARVIS-003 without review.

## 8. LLM design rules

Do not use the large LLM for tasks that deterministic code or a specialized model can do reliably.

Prefer:

- deterministic rules for permissions and safety
- specialized STT for audio transcription
- specialized object detector/tracker for CCTV
- structured stores for state
- LLM for ambiguous reasoning, planning, synthesis, and natural-language interaction

Do not make correctness depend on the LLM "remembering" previous chat history.

Persist important state in files/databases.

## 9. Testing behavior

For every meaningful change:

1. identify the smallest relevant test set
2. run it before or after the change as appropriate
3. add regression coverage for bugs
4. run lint/type/build checks when affected
5. run `npm run verify` only when a heavy whole-repo gate is warranted

Never claim a live hardware/Discord/voice test passed if only mocks or unit tests ran.

Use terminology:

- "implemented and unit-tested"
- "offline/simulated verified"
- "live verified"

Do not blur these categories.

## 10. Autonomous work behavior

When given a broad objective:

1. inspect
2. create a short plan
3. choose the smallest unblocked task
4. implement
5. test
6. inspect diff
7. document state
8. continue to the next compatible task

Do not repeatedly ask the user for decisions that can be resolved from the repository.

Do stop for:

- credentials/secrets not available
- consent decisions
- irreversible operations
- hardware actions requiring a human
- architecture changes with major product consequences
- conflicting requirements with no safe interpretation

If blocked, record the blocker and continue another independent task.

## 11. Documentation maintenance

Keep these files useful:

- `PROJECT_CONTEXT.md` — high-level current source of truth; update only after verifying facts
- `TASKS.md` — actionable backlog
- `ROADMAP.md` — phase direction, not proof of completion
- `SESSION_STATE.md` — current Cursor session results
- `DECISIONS.md` — architecture decisions made after this handoff
- `JARVIS_MEMORY_ARCHITECTURE.md` / `JARVIS_UI_UX_VISION.md` — proposed memory and UI direction; not current implementation
- `MEMORY_UI_TASKS.md` — addendum queue; start only after P0 baseline
- `JARVIS_PLATFORM_TASKS.md` / `JARVIS_PLATFORM_ARCHITECTURE.md` — Core/presentation queue; `src/jarvis/` is implemented, not live-wired

Do not mark a future roadmap item complete because scaffolding exists.

## 12. Definition of done

A task is done only when its acceptance criteria are satisfied.

For code tasks, this normally includes:

- implementation exists
- relevant tests pass
- no known regression introduced
- error handling is explicit
- state/docs updated if behavior changed

For live tasks, a human/live environment may still be required; mark those `IMPLEMENTED_NEEDS_LIVE_VERIFY`, not `DONE`.
