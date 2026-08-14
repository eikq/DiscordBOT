# Digital Me — AI Code Hackathon Submission

## One-line pitch

Digital Me is a Thai-first Discord voice AI that can listen, understand mixed Thai/English conversation, remember social context, and answer in a consented target voice.

## Public links

- Public interactive demo: https://digital-me-thai-voice.piriyapong2551.chatgpt.site
- Source code: https://github.com/eikq/DiscordBOT
- Public demo source: `public-demo/`

## What judges can try

1. Open the public demo.
2. Type or dictate a Thai/English sentence in the sandbox.
3. Inspect the transcript, detected intent, retrieved memory, and generated reply.
4. Switch between Voice and Singing Style to see how the presentation layer changes.
5. Use the architecture and safety sections to inspect how the real Discord/GPU system works.

The public site is a privacy-safe simulation. It intentionally contains no Discord token, private conversation history, trained voice weights, or a friend's recorded audio. The submitted video demonstrates the real local Discord + GPU pipeline with explicit permission.

## AI used in the project

- Thai/English speech-to-text for voice-channel transcription.
- A local language model plus deterministic social rules for meaningful replies.
- An inspectable social-memory layer for names, relationships, activities, and speaking habits.
- JaiTTS/Edge-TTS as source speech and RVC for consented voice conversion.
- Audio-quality analysis for silence, clipping, SNR, overlap, pitch, rate, pauses, and energy variation.

## Why it is different

Most bots treat every voice turn as an isolated command. Digital Me keeps an auditable social context, separates target-only voice training from conversation context, and makes Thai-first voice interaction the main interface.

## Safety boundary

- Only collect or clone a voice with the speaker's informed permission.
- Display an explicit recording/training notice in the Discord channel.
- Keep raw audio, private memory, tokens, and trained weights out of the public repository and public demo.
- Stop capture and future learning when consent is withdrawn.
- Do not present generated audio as the real person.

## Current verification

- Public demo lint, production build, and rendered-HTML smoke test pass.
- The main repository has automated TypeScript and Python verification suites.
- Local GPU voice training and inference are supported; real voice similarity still depends on clean, consented target audio and a listening test.

## Submission package

- `Digital-Me-Hackathon-Pitch.pptx` — presentation deck.
- `DEMO_VIDEO_SCRIPT.md` — 2–3 minute recording script.
- `SHOT_LIST.md` — exact screen-recording sequence.
- `VOICE_CONSENT_RELEASE.md` — simple consent template.
- `EMAIL_DRAFT.txt` — ready-to-send submission email draft.
- `SUBMISSION_CHECKLIST.md` — final preflight checklist.
