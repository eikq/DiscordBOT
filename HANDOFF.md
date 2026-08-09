# Digital Me Engineering Handoff

Updated: 2026-08-09

Digital Me is a Thai-first Discord voice bot and local dashboard. The repository has been stabilized after the generated handoff proved inaccurate.

## Stabilization completed

- Repaired clean npm installation and added a lockfile.
- Removed the unused native Opus dependency implicated in decoder crashes; the receiver uses asm.js `opusscript`.
- Fixed Phase 2's fixture-shape crash and Phase 3's 30-second sleeps.
- Fixed Phase 4 memory supersession and stopped its simulator from clearing the real database.
- Made simulations assert their claims and return failure exit codes.
- Fixed the STT sequencing race so response generation waits for the final transcript.
- Removed fabricated offline transcripts and synthetic tone “speech.”
- Kept the bot in `SPEAKING` until playback completes and added tested cancellation paths.
- Enforced `RECORD_RAW_AUDIO=false` and `TRANSCRIPT_RETENTION` behavior.
- Replaced the stock Edge-TTS placeholder with an authenticated, Drive-backed RVC v2 sample/training/inference service.
- Added server-scoped self-consent, revocation, deletion, manual training, status, and consent-aware voice selection commands.
- Pinned the upstream RVC revision and implemented its documented preprocess, RMVPE, HuBERT, model, and index CLI stages.
- Added automated regression tests and honest benchmark output.

## Verification commands

```bash
npm install
npm run verify
npm run benchmark
npm run start:local
```

See `PROJECT_STATUS.md` for the verified/pending boundary and `WHAT_I_NEED_FROM_OWNER.md` for live Discord requirements.

## Immediate next milestone

Run `colab/DigitalMe_RVC_Colab.ipynb` on a real T4, collect at least two minutes of the owner's consented clean Discord speech, complete `/voice-train start`, and verify `/speak` in Discord. This external GPU/Discord validation is the remaining voice-cloning boundary.

## Archive note

The tracked `project.tar.gz` is corrupted by binary-to-text transcoding and is not recoverable. The Git repository is the authoritative source.
