# Digital Me

Thai-first Discord voice bot with live transcription, social response logic, barge-in cancellation, and consent-gated RVC voice cloning through Google Colab and Google Drive.

## Quick start

Requirements: Node.js 18 or newer.

```powershell
npm ci
Copy-Item .env.example .env
npm run start:local
```

Open `http://localhost:3000`. Live Discord voice also needs the values described in `WHAT_I_NEED_FROM_OWNER.md`.

## Colab voice cloning

Use [colab/DigitalMe_RVC_Colab.ipynb](colab/DigitalMe_RVC_Colab.ipynb). It:

- mounts Google Drive and persists consented WAV samples there;
- installs a pinned official RVC revision and required model assets;
- accepts authenticated sample uploads while Discord voice chat is active;
- queues preprocessing, RMVPE/HubERT extraction, RVC v2 training, and index training;
- converts Thai base TTS into the selected trained voice at `/v1/generate`.

Copy the notebook's `COLAB_VOICE_URL` and `COLAB_API_TOKEN` into `.env`, set `RECORD_RAW_AUDIO=true`, and restart the bot. The URL changes after a Colab/tunnel restart; the token should remain secret.

Recording is live; GPU training is asynchronous. Manual experimental training is allowed after 120 seconds by default. Automatic first training waits for 600 seconds of clean speech because more data generally gives a better model.

## Discord commands

- `/voice-consent grant|status|revoke|delete` controls only the invoking user's voice.
- `/voice-train start|status` controls only the invoking user's model.
- `/voice user:@name` selects an actively consented model.
- `/speak text:... user:@name` tests it in the voice channel.
- `/join`, `/leave`, `/status`, `/transcript`, and `/debug` manage the live bot.

`revoke` stops future capture. `delete` also removes local WAVs and asks the authenticated Colab service to delete that user's Drive samples and models.

## Verify the checkout

```powershell
npm run verify
npm run benchmark
```

The benchmark reports unavailable model services as `OFFLINE`; it never treats fallback logic as proof of live speech.

## Verification boundary

The local TypeScript tests, production build, Colab Python syntax, and notebook JSON can be verified without secrets. A real trained voice still requires a Colab GPU session, consented audio, Google Drive, a Discord bot token, and an end-to-end voice-channel test.

See `PROJECT_STATUS.md` and `COLAB_TTS_GUIDE.md` for details.
