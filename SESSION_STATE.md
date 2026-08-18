# Cursor Session State

Updated: 2026-08-18
Agent/model: Cursor Grok 4.6 (primary builder)

## Git state

- Product progress branch: `feature/jarvis-platform-contracts` tracking `origin/feature/jarvis-platform-contracts`
- Previous session commit: `5f1d69a Add Jarvis Core presentation contracts...`
- Dirty pre-existing product work left unstaged:
  - `data/behavior/examples.json`
  - `data/language/custom_dictionary.json`
  - `python/local_stt_service.py`
  - `scripts/benchmark.ts`, `local_llm_process.ts`, `local_voice_process.ts`
  - `src/bot/personality/ResponseGenerator.ts`
  - `src/index.css`
- Unrelated local files left untouched:
  - `ChatGPT-Website-Creator-Prompt-Pack.pdf`
  - `Digital_Me_Cursor_Handoff_Pack.zip`
  - `Jarvis_Core_Discord_Presentation_Addendum.zip`

## Baseline actually run

| Command | Result | Notes |
|---|---|---|
| `npm run lint` | PASS | After JARVIS-003 adapter path fix |
| `npx tsx --test tests/jarvis_platform.test.ts tests/core.test.ts` | PASS | 53 tests |
| `npx tsx --test tests/jarvis_memory.test.ts tests/research.test.ts` | PASS | 12 tests |
| Combined unique TS tests this wrap-up | PASS | 65 |
| `python -m unittest discover -s tests -p "test_*.py"` | NOT RE-RUN | Earlier session: 35 passed, 8 skipped |
| `npm run build` | NOT RE-RUN | Earlier P0: PASS |
| Discord live session | NOT RUN | Needs token + human |

## Work completed this session

- JARVIS-001 / JARVIS-002: presentation-neutral contracts + independent PresentationProfile.
- JARVIS-003: wrap production `ResponseGenerator` behind `ResponseGeneratorPresentationEngine`.
  - Live `AudioReceiver` uses `presentLegacyTurn` with no independent profile.
  - `/voice` and `/persona` still both write `activeVoiceSpeakers`.
  - Voice-only profiles do not load persona examples.
  - Structured Core facts skip `generate()` and cannot be dropped.
  - Consent model unchanged.

## Current compatibility behavior

Live Discord is unchanged: selecting `/voice` or `/persona` still sets both voice and identity. Independent setters exist under `src/jarvis/presentation/compatibility.ts` and are used only when a caller supplies an explicit `PresentationProfile`.

## Current blockers

- Live Discord login/join/STT/playback/barge-in: needs owner token and a real VC test.
- Consented voice clone listening test: needs owner consent + clean audio + human judgment.
- Live `/research` citation freshness: needs `npm run research:smoke` while Ollama and MCP are up.
- Owner LoRA still targets Typhoon 4B relative to current Qwen3.8 runtime.
- Embedding server still not part of the one-command launcher.
- MEMORY-002 SQLite dual-write should not start until reviewed.
- JARVIS-004 live command decoupling should not start until reviewed.

## Next recommended task

`JARVIS-004` with caution: allow independent voice vs persona internally in live commands, keeping current `/voice` as a compatibility mapping.

Do not start MEMORY-002 or dashboard redesign without a go-ahead.
