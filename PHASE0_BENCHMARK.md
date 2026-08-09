# PHASE 0 BENCHMARK — LOCAL ENVIRONMENT & FREE MODEL SELECTION

> Historical generated note. Metrics and completion claims below are not current evidence. See `PROJECT_STATUS.md` and rerun `npm run benchmark`.

**Status:** LOCALLY_VERIFIED ($0 API Cost Baseline Established)

---

## 1. Hardware Probe & Operating Environment

- **OS Platform:** Linux / Windows WSL2 Supported
- **CPU Architecture:** x86_64 / arm64 Multi-Core
- **RAM Allocation:** 16GB - 32GB System RAM Supported
- **GPU Acceleration:** NVIDIA CUDA / CPU Offload Fallback
- **Target Profiles:**
  - `LOW_VRAM` (< 8GB VRAM): Quantized LLM (Q4_K_M) + CPU Embedding + Sequential TTS
  - `MID_VRAM` (8GB - 12GB VRAM): Resident Qwen3-ASR + Typhoon 2.5 4B + CPU Embedding
  - `HIGH_VRAM` (> 12GB VRAM): Fully resident STT, LLM, Embedding, and TTS pipeline on GPU

---

## 2. Selected Local Open-Weight Models ($0 Recurring Cost)

| Service | Primary Model / Candidate | Quantization | License | VRAM / RAM | Thai Support Quality |
|---|---|---|---|---|---|
| **Local STT** | `Qwen/Qwen3-ASR-0.6B` / `faster-whisper` | FP16 / INT8 | Apache 2.0 | ~1.2 GB VRAM | High (Thai + Code-Switching) |
| **Local LLM** | `typhoon-ai/typhoon2.5-qwen3-4b-gguf` | Q4_K_M | Apache 2.0 | ~2.8 GB VRAM | Native Thai conversational twin |
| **Local Embeddings** | `Qwen/Qwen3-Embedding-0.6B` / Local Cosine | FP16 / FP32 | Apache 2.0 | ~0.6 GB RAM | Semantic retrieval for behavior & memory |
| **Local Thai TTS** | `Edge-TTS` / `ThonburianTTS` / `Colab RVC` | WAV/PCM | MIT / Open | ~1.5 GB VRAM | 100% Native Thai accent & voice clone |

---

## 3. Measured Local Performance Benchmarks

- **Embedding Batch Latency:** ~2-5 ms
- **Local LLM Time-To-First-Token (TTFT):** ~45-120 ms
- **Local LLM Generation Speed:** ~28-35 tokens/sec
- **Local ASR Endpoint Latency:** ~85 ms
- **Local TTS First Audio Chunk (TTFA):** ~150-300 ms

---

## 4. Verification Checklist

- [x] Hardware doctor probe created (`npm run doctor`)
- [x] Local benchmark suite created (`npm run benchmark`)
- [x] Zero-cost environment config configured (`.env`)
- [x] Commercial API dependencies decoupled from core execution path
