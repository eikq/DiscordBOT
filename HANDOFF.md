# Hand-off Documentation: Digital Me

**Thai-First Real-Time Discord Digital Twin**

---

## 📌 Executive Summary

Digital Me is a real-time AI Discord Digital Twin bot and dashboard engineered for zero-latency Thai voice and text interaction. It integrates Discord voice connection handling, Opus audio decoding, real-time speech processing, and web-based management tools.

---

## 🛠️ Key Technical Fixes & Enhancements

### 1. Opus Decoder Assertion & Crash Fix
- **Issue**: `Fatal (internal) error in src/opus_decoder.c, line 492: assertion failed: (opus_custom_decoder_ctl(celt_dec, 10012, ...)) == OPUS_OK` caused Node process crashes during stream decoding.
- **Root Cause**: Native WebAssembly/C Opus decoders (`@discordjs/opus` / native `libopus`) abort when encountering malformed or unaligned Discord audio packets.
- **Solution**: Built `SafeOpusDecoder` powered by JS asm.js (`OpusScript` with `{ wasm: false }`), which catches and isolates packet errors without aborting C memory allocations or terminating the process.

### 2. Voice Distortion & Audio Crackle Elimination
- **Issue**: Recorded voice audio suffered from crackling, pitch distortion, or choppy output.
- **Root Cause**:
  1. Discord injects 1-byte (`0xBEDE`) or 2-byte (`0x1000..0x100F`) RTP extension headers into Opus packets. Feeding raw extension bytes into the Opus decoder causes corrupted output or invalid packet errors.
  2. Mid-stream decoder state resets on corrupted packets caused phase mismatches between adjacent 20ms audio frames.
- **Solution**:
  - Implemented automated RTP header extension stripping in `SafeOpusDecoder.ts`.
  - Added RFC 3551 / Opus Packet Loss Concealment (PLC) using standard silence frames (`0xf8, 0xff, 0xfe`) upon packet loss or corrupt byte detection, preserving continuous sample rate and decoder memory state.

---

## 🏗️ Core Architecture & File Map

```
├── src/
│   ├── bot/
│   │   ├── SafeOpusDecoder.ts   # Stream transform removing RTP headers & executing PLC Opus decoding
│   │   ├── AudioReceiver.ts     # Handles incoming Discord user voice streams
│   │   └── stt/
│   │       └── LocalSTTProvider.ts  # Speech-To-Text pipeline
│   ├── App.tsx                  # Web management dashboard UI
│   ├── main.tsx                 # Client entry point
│   └── types.ts                 # TypeScript type definitions
├── server.ts                    # Full-Stack Express + Vite dev/production server
├── metadata.json                # Platform applet configuration
├── HANDOFF.md                   # Project handoff documentation
└── project.tar.gz               # Compressed export archive
```

---

## 🚀 Setup & Execution Guide

### Prerequisites
- Node.js 18 or higher
- Discord Bot Token & Client Credentials

### Environment Configuration
Create a `.env` file in the root directory:
```env
DISCORD_TOKEN=your_discord_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### Running in Development
```bash
npm run dev
```

### Production Build & Execution
```bash
npm run build
npm start
```

---

## 📦 Project Download & Export

1. **Local Archive**: The project files have been packaged into `project.tar.gz` in the root workspace directory. You can extract it using:
   ```bash
   tar -xzf project.tar.gz
   ```
2. **AI Studio UI Export**: Click **Settings** (top right menu) -> **Export Project as ZIP** or **Push to GitHub** to export directly.
