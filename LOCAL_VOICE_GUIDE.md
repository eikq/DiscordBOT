# Local RTX RVC Voice Service

The Discord bot records only users who personally grant consent. The configured owner can select one of those users as the active capture target. Completed utterances are stored locally and sent over loopback to the authenticated RVC service.

## One-time setup

Requirements: Windows, Git, FFmpeg, an NVIDIA GPU, and Node.js 18 or newer. The setup command uses 64-bit Python 3.12 and installs an isolated CUDA environment.

```powershell
npm run voice:setup
```

The first setup downloads several gigabytes. Generated environments, upstream RVC code, samples, jobs, and models are excluded from Git.

## Start everything

```powershell
npm run start:local
```

This starts the local voice API at `http://127.0.0.1:8766` before starting the dashboard and Discord bot. No Cloudflare tunnel or public port is used.

For service-only troubleshooting:

```powershell
npm run voice:start
```

## Discord flow

1. The owner and target join the same Discord voice channel.
2. The owner runs `/train target:@Target`.
3. The target clicks **Allow recording and training**. The bot joins automatically and posts a public recording notice.
4. The target speaks clearly. Each utterance becomes a matched WAV, UTF-8 TXT, and JSON record; local training queues automatically after 120 seconds of clean audio.
5. Set the cloned identity with `/persona user:@Target name:Gam aliases:Gam,แกม,แก้ม`. Selecting a voice now selects that persona too.
6. Advanced status and testing remain available through `/voice-train action:status`, `/voice user:@Target`, and `/speak text:ทดสอบเสียง user:@Target`.

Training is a background batch job, not frame-by-frame learning. New samples continue to be captured while a job is queued. RVC inference waits while the GPU is actively training, preventing both workloads from exhausting VRAM.

## Dashboard training menu

The **Local Voice Training** panel provides four controls:

1. **Person** chooses the consented Discord member and their isolated dataset.
2. **Train from zero** starts from the generic RVC v2 40k base. **Fine-tune** warm-starts from that person's published model.
3. **Best model** or **Latest (last epoch)** selects the fine-tune starting weights.
4. **Epochs** accepts a whole number from 1 to 1200 and applies only to the submitted job.

Fine-tuning merges the selected voice weights into a complete pretrained generator, resets the optimizer and discriminator, and uses the reduced `RVC_FINETUNE_LR_SCALE` learning rate. The existing active voice remains stored until the new job completes successfully.

Every completed epoch replaces the rolling `latest_model.pth`. If that epoch has the lowest mean generator training loss seen in the run, it also replaces `best_model.pth`. The best model is published as the active `model.pth`, while both best and latest plus `checkpoint_metrics.json` are retained in the job's model directory. Full optimizer checkpoints remain interval-based because writing the generator/discriminator pair every epoch would add heavy disk I/O.

## Optional training export

Open **Export for Training** below the local training panel. Choose either **Vast.ai - RTX 3090/4090 24 GB** or **My laptop - i5-13500HX / RTX 4050 6 GB / 16 GB RAM**, then choose whether to train a new model or fine-tune an existing one, which Best/Latest checkpoint to use, and the epoch count. Choose the archive contents, keep safe cleanup and basic quality filtering enabled, then run **Check Export Readiness** before downloading.

The laptop profile creates a Windows PowerShell launcher. It starts at batch size 2, automatically retries at batch 1 after a CUDA out-of-memory error, uses 2 data-loader workers, and limits auxiliary CPU math to 6 threads. Keep the laptop plugged in, use its performance/cooling mode, stop the bot and GPU-heavy apps, and keep at least 20 GB free. The launcher reuses the existing `Documents\DiscordBOT` RVC environment when it is available.

Cleanup never edits the local recordings. It creates mono 40 kHz copies, trims excess edge silence, removes DC and low-frequency rumble, normalizes volume conservatively, limits peaks, and skips clearly unusable audio. `audio_quality_report.json` inside the ZIP records every kept or excluded clip and its measurements.

The ZIP contains `START_HERE.txt`, a target-specific README, and a plan-specific command such as `RUN_FINETUNE_BEST_30_EPOCHS.sh`, `RUN_TRAIN_NEW_100_EPOCHS.sh`, or `RUN_FINETUNE_BEST_30_EPOCHS_LAPTOP_4050.ps1`. After the export downloads, the dashboard displays one exact block to copy into Vast.ai or Windows PowerShell. Both targets produce `DOWNLOAD_ME_*.zip` containing Best, Latest, the RVC index, metrics, and logs. Never upload `.env` or Discord/API tokens, and destroy a rented instance only after confirming the result archive is back on this PC.

The capture target controls only raw training files. All actively consented participants can still be transcribed for conversation. Clearing the capture target disables raw training capture rather than recording everyone.

## Voice Changer

Open **Voice Changer** under the Local Voice Training panel. Choose the consented member whose model you want, select Best or Latest, and leave pitch correction at 0 for the first test.

Choose **This browser only**, **Discord VC through bot**, or **Browser + Discord VC** as the playback destination. Discord output makes the bot join the Voice Channel selected at the top of the dashboard and uses a bounded ordered playback queue, so it does not require a virtual audio cable.

- **Low-latency Microphone** continuously captures 3.2-second blocks. Browser-only playback uses 180 ms overlap and crossfade; Discord output uses non-overlapping blocks in a short ordered bot queue. Use headphones when browser playback is enabled. The current file-based RVC engine is near-real-time, normally several seconds behind the microphone, rather than zero-latency.
- **Convert an Audio File** accepts WAV, MP3, FLAC, M4A/AAC, OGG/Opus, and WebM up to 100 MB or 10 minutes. It returns a WAV that can be heard and downloaded from the dashboard.
- **Speech / microphone** is tuned for talking and the live microphone.
- **Singing vocal only** is the best-quality path for an acapella or isolated vocal. It preserves source duration and singing dynamics, applies the singing identity profile, and peak-limits the result without hard normalization.
- **Mixed song + instruments** first separates vocals with Demucs, converts only the vocal through RVC, then restores the untouched stereo accompaniment. It is slower and separation artifacts are still possible, so use the isolated-vocal option whenever that file exists.

Keep **Global pitch shift at 0** for a mixed song. A non-zero shift changes only the converted vocal while the accompaniment stays in its original key, which makes the result sound out of tune. Lowering pitch also cannot repair a model that has not learned the target person's high singing register; that requires clean recordings of the target singing and a separate singing model.

Use **Vocal volume over music** to change only the converted singer's remix level. The default is `+3 dB`; use `+4.5` or `+6 dB` when a dense instrumental masks the voice. The final mix is peak-limited, but extreme boosts can still sound compressed, so increase it in small steps.

Song outputs use separate RVC settings (`SONG_RVC_INDEX_RATE`, `SONG_RVC_RMS_MIX_RATE`, and `SONG_RVC_PROTECT`) calibrated for stronger Gam identity while retaining the source melody. The final limiter prevents digital clipping, and the output is padded/trimmed to exactly the source duration so the ending is not lost.

Voice-changing bypasses TTS: the original words, pauses, emphasis, and melody are the RVC source. The endpoint remains private behind the loopback dashboard and authenticated voice service. Training and conversion share one GPU and therefore do not run at the same time.

## Natural conversation and expression

After every launcher restart, choose the voice channel and click **Join & Listen** in the dashboard (or run `/join`). If the channel contains one human plus the bot, normal speech is treated as a one-on-one conversation and does not require repeating the persona name. In a group VC, say one of the selected persona's aliases such as `Gam` or `แก้ม` when addressing the bot so it does not interrupt unrelated conversation.

The source TTS applies subtle Thai conversational pauses plus question, excitement, frustration, and soft-speech rate/pitch/volume changes before RVC converts the timbre. Defaults are controlled by `EDGE_TTS_VOICE`, `EDGE_TTS_RATE`, `EDGE_TTS_PITCH`, and `EDGE_TTS_VOLUME`. RVC preserves source prosody; it cannot recreate every emotion present in the recorded dataset by itself.

`EDGE_TTS_REFERENCE_PITCH_HZ` is the measured neutral pitch baseline of the selected Edge voice, not the cloned speaker's pitch. The service estimates each speaker's neutral median from accepted non-excited clips and converts that difference into the RVC F0 shift. `EDGE_TTS_LEARN_RATE` stays off by default because Thai ASR word segmentation and imperfect transcripts make aggregate words-per-second unsafe for automatic timing; use the calibrated `EDGE_TTS_RATE` baseline until sentence-level prosody transfer is available.

## Local storage

- Captured WAV catalog: `data/voice_samples`
- Service samples and published models: `data/local_voice`
- Pinned upstream RVC and temporary jobs: `.runtime`
- Isolated Python/CUDA packages: `.venv-rvc`

`/voice-consent action:revoke` stops future capture for the invoking user while retaining existing local samples and models.

## Conservative RTX 4060 defaults

- CUDA build: PyTorch 2.7.1 + CUDA 11.8
- Batch size: 4
- Training epochs: 100
- Manual minimum: 120 seconds
- Automatic first training: 600 seconds

The RTX 4060 default is `RVC_BATCH_SIZE=2` so Qwen3-ASR and RVC can share the 8 GB GPU safely.
