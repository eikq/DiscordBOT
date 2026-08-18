# Cursor Session State

Updated: 2026-08-18
Agent/model: Cursor Grok 4.6 (primary builder)

## Git state

- Product progress branch: `feature/jarvis-platform-contracts`
- Live Discord was tested from `npm run dev` plus a companion `npm run start:local`

## Live Discord evidence (2026-08-18 ~22:02–22:13)

Bot login: `GAMGAMGAM-bot#4471` joined voice and received Opus (`SPEECH_START` / `SPEECH_END` for several speakers).

First failure was **not Discord login**. `npm run dev` alone left STT/RVC/JaiTTS down:

- `[LocalSTT] No transcription service available at http://127.0.0.1:8765`
- `[LocalTTS] No cloned speech service available at http://127.0.0.1:8766`
- every utterance: `No transcript produced; skipping response generation`

After starting the local voice stack beside the running dashboard:

- RVC `:8766` CUDA healthy
- JaiTTS `:8768` CUDA ready
- Qwen3-ASR-1.7B `:8765` CUDA ready
- STT began returning `FINAL` Thai transcripts (~22:12)

Group VC still will not answer every line unless the clone is addressed (or the session is one-on-one). That is existing SocialBrain policy, not a crash.

Dashboard was restarted so the bot can read `.runtime/voice_api_token` for RVC. Re-join the voice channel after that restart.

## Work completed this wrap-up

- JARVIS-001/002/003 already on the branch
- `start:local` now starts missing STT/RVC/JaiTTS when `:3000` is already up, and stays alive
- `getVoiceServiceApiToken()` falls back to `.runtime/voice_api_token` so `npm run dev` can speak
- `stt:start` keeps the STT child process alive

## Tests

- `npm run lint` PASS
- `npx tsx --test tests/core.test.ts` PASS (41)

## Next

If live talk still fails after re-join: say the selected persona name in the group, or `/speak` from the dashboard. JARVIS-004 remains the next architecture task.
