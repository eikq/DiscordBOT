# JaiTTS RTX 4060 Benchmark

## Method

- Date: 2026-08-13
- GPU: NVIDIA GeForce RTX 4060, 8,188 MiB
- Driver: 610.47
- PyTorch: 2.7.1+cu118
- CUDA runtime reported by PyTorch: 11.8
- Model: `JTS-AI/JaiTTS-F5TTS`
- Precision: float32 runtime with EMA checkpoint loader
- Speaker: Discord user `897089867752808479` (authorized Gam reference profile)
- Reference selected: `gam-casual-001`
- Fixed seed: 42
- Target: `วันนี้เล่นเกมกันไหม เดี๋ยวกูเข้าไปด้วย`
- Output: mono PCM16 WAV at 24 kHz
- Measurement point: direct persistent JaiTTS HTTP service, before RVC

Full machine-readable results are in `benchmarks/jaitts_nfe_results.json`. Generated listening files are in `benchmarks/jaitts_audio/`. Speaker similarity is WavLM (`microsoft/wavlm-base-plus-sv`) cosine similarity against a centroid of 12 Gam recordings. CER was measured by replaying each output through the local Qwen3-ASR service.

## NFE results (CFG 2.0)

| NFE | HTTP wall time | Model generation | RTF | Peak PyTorch VRAM | Gam similarity | ASR CER |
|---:|---:|---:|---:|---:|---:|---:|
| 8 | 0.595 s | 0.576 s | 0.1512 | 738.8 MB | 0.75703 | 0.2703 |
| 12 | 0.556 s | 0.537 s | 0.1410 | 738.8 MB | **0.85976** | **0.0000** |
| 16 | 0.734 s | 0.728 s | 0.1912 | 738.8 MB | 0.83297 | 0.0000 |
| 24 | 1.107 s | 1.084 s | 0.2846 | 738.3 MB | 0.81348 | 0.0000 |
| 32 | 1.378 s | 1.352 s | 0.3551 | 739.4 MB | 0.82423 | 0.0000 |

All outputs were 3.808 seconds and had zero clipped PCM samples. NFE 8 was rejected because the local ASR measured 27.03% character error. NFE 12 was both fastest in the measured run and had the highest automated speaker-similarity score.

## CFG results (NFE 16)

| CFG | HTTP wall time | RTF | Gam similarity | ASR CER |
|---:|---:|---:|---:|---:|
| 1.5 | 0.749 s | 0.1907 | **0.85321** | 0.0000 |
| 2.0 | 0.779 s | 0.1977 | 0.83297 | 0.0000 |
| 2.5 | 0.682 s | 0.1744 | 0.82781 | 0.0000 |
| 3.0 | 0.765 s | 0.1996 | 0.80210 | 0.0000 |

CFG did not materially change latency. Lower CFG scored better for speaker identity in this one sentence, but this alone does not prove better naturalness or text adherence across all content.

## Presets

- `realtime`: NFE 12, CFG 2.0 — selected for Discord from measured CER, identity, and latency.
- `balanced`: NFE 16, CFG 1.5 — alternate for listening comparison.
- `quality`: NFE 32, CFG 2.5 — upstream-style conservative setting, not assumed superior.
- `default`: explicit `JAITTS_STEPS` and `JAITTS_CFG_STRENGTH` values.

Raw NFE/CFG request overrides are rejected unless the local service is deliberately started with `JAITTS_ALLOW_BENCHMARK_CONTROLS=true`.

## Runtime footprint

The JaiTTS process reported 712.1 MB currently allocated and about 739 MB peak PyTorch allocation per measured request. With JaiTTS, local STT, RVC, the local LLM, desktop applications, and display memory present, `nvidia-smi` reported 5,847 / 8,188 MiB total GPU memory in use. Windows WDDM did not expose reliable per-process VRAM in the CLI output.

Model load time reported by the service was 4.765 seconds with cached assets. The chosen warm request returned the complete 3.808-second WAV in 0.556 seconds. Because inference is not truly streaming, this full-response time is also the direct-service first usable audio time.

## Limits of this benchmark

- Automated speaker similarity is not a human naturalness score.
- The NFE/CFG sweep used one sentence, one style, and one fixed seed.
- It measured JaiTTS before RVC, not Discord playback latency.
- Short reactions remain on the Edge source pending a larger, human-rated JaiTTS short-reaction test.
- A blind comparison with MiniMax/ElevenLabs was not possible because no configured cloned models for those services were available in this runtime.
- The generated WAVs should be listened to before changing `realtime` again.

Re-run with:

```powershell
$env:JAITTS_ALLOW_BENCHMARK_CONTROLS = 'true'
npm run jaitts:benchmark
```
