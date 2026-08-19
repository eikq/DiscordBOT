# JaiTTS Integration Status

## External repository commit tested

`aiunlocked1412/Unlock-TTS-Easy` at `ad27d7955ad0c4aede9a9b613afc2f35e9b809ea` was inspected in an isolated research checkout.

## Model checkpoint tested

`JTS-AI/JaiTTS-F5TTS`, cached Hugging Face snapshot `50a5aa8986df1e3882873834f689a05bcae06bcb`.

## Code license

Unlock-TTS-Easy wrapper: Apache-2.0. FlowTTS components: MIT according to upstream notices.

## Model license

CC BY-NC 4.0. The checkpoint is not approved for commercial use.

## Hardware

NVIDIA GeForce RTX 4060, 8,188 MiB, driver 610.47; system RAM 31.8 GB.

## PyTorch / CUDA

PyTorch 2.7.1+cu118; CUDA runtime 11.8; float32 runtime with EMA checkpoint loader.

## VRAM

Measured peak PyTorch allocation per JaiTTS sweep request: about 739 MB. Full live local stack plus desktop: 5,847 / 8,188 MiB reported in use.

## Cold start

4.765 seconds to load JaiTTS with cached model/vocoder assets in the measured run.

## Warm TTFA

No true streaming is present. The selected NFE 12 / CFG 2.0 case returned the complete 3.808-second source WAV in 0.556 seconds, so first usable direct-service audio equals full-response latency.

## RTF

Selected case: 0.141. All measured NFE 8–32 cases were faster than realtime.

## NFE benchmark

NFE 8 failed intelligibility (CER 0.2703). NFE 12 had CER 0.0000, WavLM Gam similarity 0.85976, and the best measured latency/similarity combination. See `docs/JAITTS_BENCHMARK.md`.

## CFG benchmark

At NFE 16, CFG 1.5–3.0 all had measured CER 0.0000. CFG 1.5 had the highest WavLM similarity in that sweep (0.85321), but one sentence is insufficient to replace human listening.

## Reference style benchmark

Style-conditioned, approved casual/question/excited/soft/annoyed references are integrated. Same-text human scoring across every style remains pending; it is not reported as complete.

## Thai-English benchmark

The live path preserves Thai-English code switching and uses one centralized pronunciation dictionary. A new full Thai-English matrix was not completed in this benchmark turn.

## Short-reaction benchmark

Very short reactions intentionally remain on Edge-TTS -> RVC because JaiTTS duration prediction was unstable in prior local evaluation. A 10-variant-per-word human-rated JaiTTS test remains pending.

## Discord live test

The bot connected successfully and registered slash commands. Automated end-to-end HTTP cancellation was verified. A new manual human voice interruption/listening test in Discord remains pending.

## Cancellation behavior

End-to-end `turnId` propagation is implemented. Node aborts the request, playback stops, the voice service forwards cancellation, JaiTTS discards the completed kernel result, and RVC is skipped. Direct and full-pipeline smoke tests both returned HTTP 409 for cancelled generations.

## Known artifacts

- No true streaming; RVC still adds post-source latency.
- Human naturalness cannot be inferred from WavLM similarity or ASR CER.
- Question quality depends on having an approved question reference with the correct tail contour.
- Very short JaiTTS reactions can have unstable duration.

## Commercial-use limitation

The current checkpoint is CC BY-NC 4.0. Digital Me must use a separately licensed checkpoint before any commercial deployment.

## Final recommendation

**ADOPT WITH LIMITATIONS** for personal/research Discord use. Use the measured `realtime` preset (NFE 12 / CFG 2.0), retain Edge-TTS fallback for short reactions and failures, keep the service loopback/authenticated, and do not claim commercial safety or true streaming.
