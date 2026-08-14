# Digital Me — Verified Project Status

Last verified: 2026-08-09

The earlier Gemini handoff described all eight phases as complete. That was not accurate. This file records only behavior reproduced from the current checkout.

## Verified now

- `npm install` completes without peer-dependency flags and the npm audit reports zero known vulnerabilities.
- `npm run lint` passes TypeScript checking.
- `npm test` covers Thai social decisions, owner-behavior retrieval, memory supersession, offline STT/TTS behavior, safe Opus decoding, and barge-in cancellation.
- `npm run build` produces the dashboard and production server bundle.
- Phase 2, 3, and 4 simulations complete with real assertions and nonzero failure exits.
- The decision-loop stress simulation completes with asserted actions.
- The development dashboard and its read APIs respond locally without a Discord token.
- Raw voice recording is disabled by default and is now enforced at runtime.
- Voice recording requires both `RECORD_RAW_AUDIO=true` and a server-scoped Allow click from the tagged user on the `/train` prompt.
- The Discord bot uploads WAV samples with bearer authentication, exposes self-service training/status/deletion commands, and routes cloned TTS by Discord user ID.
- The local voice package contains a pinned RVC v2 training runner, authenticated loopback API, local model/index publishing, and cached inference path.
- Windows setup and launch commands create an isolated Python 3.12 CUDA environment and start the voice service before the Discord bot.
- `npm run voice:setup` completes on this machine; PyTorch 2.7.1 + CUDA 11.8 detects the NVIDIA GeForce RTX 4060.
- A disposable one-epoch smoke model completed preprocessing, RMVPE extraction, HuBERT extraction, CUDA training, FAISS indexing, publishing, and authenticated Thai WAV generation.
- Deleting the disposable speaker removed its service dataset, failed-job work folders, experiment logs, and model artifacts.

## Implemented but not live-verified

- Discord login and slash-command registration.
- Joining/leaving Discord voice channels.
- Receiving real Discord Opus packets over a sustained session.
- End-to-end Discord audio -> STT -> decision -> TTS -> Discord playback.
- Local LLM, STT, embeddings, and TTS HTTP provider integrations.
- Production behavior under reconnects, packet loss, and multiple guilds.
- Completing a real RVC training job from Discord-collected audio and hearing the result in Discord.

These require a Discord bot token, running model services, and a real voice-channel test. Editor/simulation checks do not prove them.

## Not implemented yet

- A bundled installer/launcher for the local LLM, STT, embedding, and TTS model servers.
- A trained owner LoRA and a measured baseline-versus-fine-tuned evaluation gate.
- Physical confirmation that deleting a voice removes the expected local dataset and model files after a live Discord session.

## Current machine status

The local RVC environment is installed and starts on demand with `npm run start:local`. The configured LLM and STT endpoints still require their own local services. Deterministic social and response fallbacks continue to work when those endpoints are offline.

## Commands

```bash
npm install
npm run voice:setup
npm run verify
npm run benchmark
npm run start:local
```

The dashboard opens at `http://localhost:3000`. Without `DISCORD_TOKEN`, it runs in disconnected management mode. The local RVC service can be CUDA-verified independently, but a cloned voice cannot be called live-verified until enough consented speech is collected, trained, and played in Discord VC.
