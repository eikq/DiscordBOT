# Digital Me

Thai-first Discord voice bot with live transcription, social response logic, barge-in cancellation, and consent-gated local RVC voice cloning on an NVIDIA GPU.

## Public hackathon demo

- Interactive public demo: https://digital-me-thai-voice.piriyapong2551.chatgpt.site
- Submission guide and video script: [`submission/HACKATHON_SUBMISSION.md`](submission/HACKATHON_SUBMISSION.md)
- The public demo is privacy-safe: it contains no Discord token, private transcript, raw voice dataset, or trained voice weight. The real Discord/GPU pipeline remains local and should only be demonstrated with the voice owner's permission.

## Quick start

Requirements: Node.js 18 or newer.

```powershell
npm ci
Copy-Item .env.example .env
npm run start:local
```

Open `http://localhost:3000`. Live Discord voice also needs the values described in `WHAT_I_NEED_FROM_OWNER.md`.

## Local RTX voice cloning

First-time setup on Windows:

```powershell
npm run voice:setup
npm run start:local
```

`start:local` launches the authenticated voice service on `127.0.0.1:8766`, then starts the dashboard and Discord bot. It uses the isolated `.venv-rvc`, a pinned official RVC revision, and local storage under `data/local_voice`. Set `RECORD_RAW_AUDIO=true` in `.env` before collecting consented samples.

Recording is live; GPU training is asynchronous. Use `/train @member` to start one automatic learning session, `/train-status` to inspect clean/rejected clips and speaking-style coverage, then `/stop-train` to freeze a versioned dataset and queue either a first model (120 clean seconds by default) or a best-model fine-tune (180 new clean seconds by default). Upload-triggered training is disabled so training never starts halfway through a listening session.

During training, a rolling `latest` inference model is replaced after every completed epoch. A separate `best` model is replaced only when the epoch improves the mean generator training loss, and the best model becomes active after publication. The much larger resumable optimizer checkpoint remains on its normal interval to avoid excessive SSD writes. Checkpoint scores and epoch history are stored beside each published model in `checkpoint_metrics.json`; this score is a training-loss estimate, not a substitute for a human listening test.

Longer Thai replies use a persistent JaiTTS source model before RVC; short reactions retain the stable Edge-TTS source. The RTX 4060 benchmark selected the `realtime` preset (NFE 12 / CFG 2.0), while every turn now supports end-to-end cancellation before stale audio can reach RVC or Discord. See `JAITTS_INTEGRATION_STATUS.md`, `docs/JAITTS_TECHNICAL_REVIEW.md`, `docs/JAITTS_BENCHMARK.md`, and `docs/JAITTS_INTEGRATION.md`. The current JaiTTS checkpoint is CC BY-NC 4.0 and is not commercially licensed.

## Discord commands

- `/train target:@name` is the normal start button. It asks that person once if needed, joins the selected VC, posts a recording notice, and starts one persisted learning session.
- `/train-status` shows captured versus clean seconds, accepted/rejected clips, speaking-style coverage, and the current training decision.
- `/stop-train` stops capture, writes an immutable dataset manifest, then either trains a first model or fine-tunes the current best model when enough new clean audio exists.
- `/voice-consent status|revoke` lets a recorded user inspect or stop future voice capture.
- `/voice-target` and `/voice-train` remain advanced manual controls for inspecting a target or deliberately starting a chosen fresh/fine-tune job.
- `/voice user:@name` selects an actively consented model.
- `/persona user:@name name:Gam aliases:Gam,แกม,แก้ม` binds that selected voice to its own identity and nicknames.
- `/speak text:... user:@name` tests it in the voice channel.
- `/join`, `/leave`, `/status`, `/transcript`, and `/debug` manage the live bot.

`revoke` stops future capture while retaining existing local WAVs, training jobs, and models.
Selecting a voice also selects that user's persona. Persona profiles persist in `data/personas.json`; behavior examples added in the dashboard are scoped to the active default persona. With no capture target selected, conversation can continue for consented participants but no raw training audio is stored.

Every saved utterance has matching WAV, UTF-8 TXT, and Schema v2 JSON metadata. The analyzer measures loudness, clipping, silence ratio, estimated SNR, overlapping speakers, pitch, rate, pauses, energy variation, and conversational style. Rejected clips remain available for inspection but are not uploaded for RVC training. Stopping a session writes a version manifest under `data/voice_samples/<discord-user-id>/versions/`, so each new model can be traced to exact accepted utterance IDs and audio SHA-256 hashes.

## Web command center and social brain

The dashboard at `http://127.0.0.1:3000` exposes every Discord command through guided server, channel, member, voice, consent, capture, training, and persona controls.

For every final transcript from an actively consented participant, the local social brain records evidence and derives:

- display names, nicknames, and how friends address one another;
- relationship interaction counts;
- games, recurring activities, and stated preferences;
- speaking style such as average length, common slang, and frequent short replies.
- acoustic style such as pitch range, speaking rate, pause timing, energy variation, and observed delivery styles.

The canonical local files are `data/brain/brain_state.json` and the append-only `data/brain/observations.jsonl`. An Obsidian-compatible view is generated under `data/brain/vault`. Facts learned from low-confidence STT are excluded; repeated evidence raises confidence, and newer contradictory evidence supersedes an older belief without deleting its audit trail. Relevant summaries are supplied to the local response model; this is inspectable memory learning, not irreversible LLM weight training.

## Verify the checkout

```powershell
npm run verify
npm run benchmark
```

The benchmark reports unavailable model services as `OFFLINE`; it never treats fallback logic as proof of live speech.

## Verification boundary

The TypeScript tests, production build, Python service syntax, CUDA health check, and offline simulations can be verified locally. A real trained voice still requires at least 120 seconds of clean consented audio and an end-to-end Discord voice-channel test.

See `PROJECT_STATUS.md` and `LOCAL_VOICE_GUIDE.md` for details.
