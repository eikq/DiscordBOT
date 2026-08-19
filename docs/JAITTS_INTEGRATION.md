# JaiTTS Integration Guide

## Live path

```text
Discord response text + prosody + turnId
  -> LocalTTSProvider (pronunciation-only ttsText)
  -> authenticated voice service on 127.0.0.1:8766
  -> approved style reference selection
  -> persistent JaiTTS on 127.0.0.1:8768
  -> selected Best/Latest RVC model
  -> output smoothing
  -> Discord playback
```

Very short reactions use the stable Edge-TTS source before RVC. Longer Thai and Thai-English responses use JaiTTS when an approved speaker reference exists. If JaiTTS is unavailable, the voice service falls back to Edge-TTS instead of crashing the bot.

## Start normally

Use one visible terminal from the project folder:

```powershell
npm run start:local
```

The launcher starts the RVC service, persistent JaiTTS, local STT, local LLM, dashboard, and Discord bot. JaiTTS binds only to `127.0.0.1` and shares the local voice API bearer token.

The measured production setting is:

```dotenv
JAITTS_ENABLED=true
JAITTS_PRESET="realtime"
JAITTS_ALLOW_BENCHMARK_CONTROLS=false
```

Available presets are `realtime`, `balanced`, `quality`, and `default`. `default` uses `JAITTS_STEPS` and `JAITTS_CFG_STRENGTH`.

## Health and metrics

- `GET http://127.0.0.1:8768/health` is unauthenticated loopback readiness information.
- `GET /metrics` requires the bearer token and reports request totals, cancellations, model load time, generation time, RTF, active turn, and PyTorch VRAM.
- `POST /v1/cancel/{turnId}` requires the bearer token.

The voice service exposes its own `/health`, `/v1/generate`, and `/v1/cancel/{turnId}` endpoints on port 8766.

## Prosody and references

Reference manifests live under:

```text
data/local_voice/speakers/<discord-user-id>/tts_references.json
```

Only enable a reference after listening to the clip and verifying its transcript exactly. Supported style routing includes casual, question, excited, soft/tired, and annoyed. The selected reference, speed, and seed are returned in diagnostic response headers.

Pronunciation overrides live in:

```text
data/language/pronunciation_dict.json
```

Display text remains unchanged. TTS replacements are regex-escaped, longest-first, and use ASCII token boundaries so a short key such as `AI` does not alter a larger word such as `SAINT`.

## Barge-in behavior

When a human speaks over the bot:

1. Discord playback stops immediately if it has begun.
2. The Node HTTP request is aborted.
3. The voice service marks the turn stale and forwards cancellation to JaiTTS.
4. If a CUDA kernel is already running, it is allowed to finish safely.
5. Its result is discarded and RVC is skipped.
6. The stale audio can never resume later.

This is deliberate cancellation granularity; it does not claim unsafe CUDA kernel preemption.

## Benchmarking

Benchmark controls are disabled in normal use. To make a controlled sweep:

1. Stop the current server.
2. In a PowerShell terminal set `JAITTS_ALLOW_BENCHMARK_CONTROLS=true`.
3. Start the local system.
4. Run `npm run jaitts:benchmark` in another terminal.
5. Listen to files under `benchmarks/jaitts_audio/`.
6. Restart normally so benchmark overrides are disabled.

Do not select a preset from latency alone. Use intelligibility, speaker similarity, clipping, and human listening.

## Known limitations

- The JaiTTS checkpoint is non-commercial (CC BY-NC 4.0).
- There is no true incremental JaiTTS streaming in the inspected runtime.
- The RVC step remains file-oriented and adds latency after source generation.
- Short reaction quality needs a larger human-rated variant bank before switching those words from Edge-TTS.
- Voice cloning and recording should only be used with informed authorization and clear disclosure in the Discord server.
