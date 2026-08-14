# Inputs Needed for Live Discord Verification

The offline codebase is stabilized, but a live voice session cannot be verified without owner-controlled credentials and services.

## 1. Discord bot configuration

Create a local `.env` from `.env.example` and set:

```env
DISCORD_TOKEN="your token"
OWNER_DISCORD_USER_ID="your Discord user ID"
OWNER_ALIASES="Spin,สปิน"
```

Enable the bot's Message Content intent and invite it with permission to view/connect/speak in the test voice channel. Keep the token in `.env`; do not paste it into source control or chat.

## 2. Speech and model services

For the real voice loop, start compatible services for:

- STT at `STT_BASE_URL` (default `http://127.0.0.1:8765`)
- LLM at `LLM_BASE_URL` (default `http://127.0.0.1:8080/v1`)
- the local RTX RVC service installed with `npm run voice:setup`

Run `npm run benchmark` and confirm that the services you need are no longer reported as unavailable.

## 3. Recording consent

`RECORD_RAW_AUDIO=false` is the safe default. Set it to `true` only for a consented test. `/train target:@name` presents the tagged person with an Allow/Decline button before capture can start. They can later use `/voice-consent action:revoke` to stop future capture.

## 4. Local RVC service

Run `npm run voice:setup` once, then use `npm run start:local`. A first experimental model needs at least 120 seconds of clean consented speech. Substantially more clean audio generally improves quality.

## 5. Live smoke test

```bash
npm run start:local
```

Then grant consent, use `/join`, collect enough clean speech, run `/voice-train start`, wait for `/voice-train status` to report a ready model, select it with `/voice`, test `/speak`, interrupt playback, and finish with `/leave`.
