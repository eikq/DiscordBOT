# Google Colab RVC Voice Service

> Legacy compatibility only. Colab-managed runtimes can terminate long-running tunneled web services. The supported setup for this project is now [LOCAL_VOICE_GUIDE.md](LOCAL_VOICE_GUIDE.md), using the local NVIDIA GPU without a public tunnel.

The supported setup is [colab/DigitalMe_RVC_Colab.ipynb](colab/DigitalMe_RVC_Colab.ipynb). Old generated Edge-TTS snippets were removed because they stored files but never trained or ran a voice-clone model.

## What is real-time

- Discord captures each opted-in user's completed utterances while VC is active.
- The bot immediately saves a WAV locally and uploads it to the authenticated Colab service.
- Colab persists the sample under `MyDrive/DigitalMeVoice/speakers/<discord-user-id>/samples`.
- Uploading continues while a queued RVC job is waiting or training.

RVC training itself is a batch GPU job, not an incremental update on each audio frame. The service debounces jobs so a new multi-minute training process is not launched for every sentence.

## Setup

1. Open the notebook in Google Colab.
2. Choose a T4 GPU runtime.
3. Run every cell and authorize Google Drive.
4. Enter a strong shared API token or let the notebook create one.
5. Copy the printed values into the bot's `.env`:

```dotenv
COLAB_VOICE_URL="https://example.trycloudflare.com"
COLAB_API_TOKEN="the-same-long-random-secret"
OWNER_DISCORD_USER_ID="your-numeric-discord-user-id"
RECORD_RAW_AUDIO=true
```

6. Restart the bot, join VC, run `/train target:@name`, and have the tagged participant click **Allow recording and training**.

## Training thresholds

- `/voice-train start`: at least `MIN_TRAIN_SECONDS` (default 120 seconds).
- First automatic job: `AUTO_TRAIN_MIN_SECONDS` (default 120 seconds locally).
- Automatic retrain: at least `RETRAIN_NEW_SECONDS` (default 180 new seconds after the published model).

Override these as Colab environment variables before starting `voice_service.py`. Lower thresholds are useful for plumbing tests but usually reduce voice quality.

## Storage and interruption behavior

Samples, published `.pth` weights, `.index` files, and training logs live in Google Drive. Temporary preprocessing files live on the Colab VM. If Colab disconnects during training, the job is marked failed on the next start and the user runs `/voice-train start` again; existing Drive samples remain.

The Cloudflare quick-tunnel URL is temporary. Paste the new URL into the dashboard or `.env` after every Colab restart. Never expose `COLAB_API_TOKEN` in Discord or commit it to Git.

## Data control

- `grant`: allows future raw sample capture in that server.
- `revoke`: stops future capture; existing data remains.
- `delete`: revokes, deletes local samples, and deletes the user's Drive speaker directory through the authenticated service.

The bot rejects selecting a Discord user's voice unless that user still has active consent.

## Troubleshooting

- `401 invalid bearer token`: the bot and notebook tokens differ.
- `409 Need ... clean audio`: collect more consented speech before manual training.
- `503 GPU is currently training`: recording/upload still works; cloned inference resumes after training.
- `model is not trained yet`: check `/voice-train status` and wait for `model ready: yes`.
- Colab bootstrap error: confirm the runtime uses Python 3.12 and an NVIDIA GPU, then rerun the install cell.
