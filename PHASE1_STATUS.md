# PHASE 1 STATUS

**Status:** Completed Scaffolding for Phase 1.

## What Works
- Bot architecture created and initialized (`server.ts`, `BotService.ts`).
- `VoiceConnectionManager` implemented using `@discordjs/voice`.
- `AudioReceiver` implemented to capture incoming Opus packets from individual Discord users.
- `SpeechToTextProvider` interface created with a `MockSTTProvider`.
- `ConversationTimeline` implemented to store and format realtime transcription events.
- Express web server providing bot status.
- Commands implemented: `/join`, `/leave`, `/status`, `/debug`, `/transcript`.
- Simulator implemented (`npm run simulate`) to verify Thai transcription logic and timeline formatting.

## What is Unverified
- Real Google Cloud STT / Whisper API integration (Requires API Keys).
- Real voice decoding from Opus to PCM using `prism-media` (Requires testing in a real Discord Voice Channel).

## Discord Library Versions
- `discord.js`: ^14.27.0
- `@discordjs/voice`: ^0.19.2

## STT Provider / Model
- Currently using `MockSTTProvider` as a placeholder for architectural verification. 

## Known Problems
- The Bot requires a `DISCORD_TOKEN` to be set in the `.env` file to fully connect to Discord.
- Actual PCM decoding for the Voice API requires `prism-media` and `ffmpeg`, which is configured but untested on this infrastructure.
