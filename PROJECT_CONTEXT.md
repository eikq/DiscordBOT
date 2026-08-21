# Digital Me — Project Context for the Next Chat

**Updated:** 2026-08-21
**Repo:** `C:\Users\piriy\Documents\DiscordBOT`  
**Package name:** `digital-me-discord-bot` `0.1.0`  
**Owner / operator:** digitalallthingsonline (Discord aliases default: Spin / สปิน)

This file is the current source of truth for another chat or agent that needs to understand the project. Prefer it over `PHASE*_STATUS.md`. Those phase notes are historical, often inflated, and several claims in them are wrong.

A Cursor operating pack is now in the repo. For a new chat, start from `CURSOR_BOOTSTRAP_PROMPT.md`. Persistent agent rules live in `AGENTS.md` and `.cursor/rules/`. Actionable work is in `TASKS.md`. Direction (not proof of completion) is in `ROADMAP.md`. Session results go in `SESSION_STATE.md`.

A later addendum proposes a hybrid Jarvis memory system and a real-time 3D command UI. Those files are design only: `JARVIS_MEMORY_ARCHITECTURE.md`, `JARVIS_UI_UX_VISION.md`, `MEMORY_UI_TASKS.md`. Do not treat them as implemented. For a chat focused on that work, use `CURSOR_MEMORY_UI_PROMPT.md`.

A Jarvis-first addendum now takes priority: finish standalone Jarvis Core v1 before more Discord work (`JARVIS_FIRST_DIRECTIVE.md`, `JARVIS_FIRST_TASKS.md`). Contracts for JARVIS-001/002/003 exist in `src/jarvis/`. JARVIS-004/005 Discord adapters exist in the working tree and are kept, but further Discord integration is deferred. Standalone text path: `npm run jarvis:ask`. Primary owner UI: `/jarvis` Presence (cinematic WebGL Core + conversation + contextual HUD; live research nodes from real evidence). Advanced Control Center remains `/jarvis-lab` (JF-006/JF-007 + UI-R1–R8 command center + JF-008 mic/STT + JF-008B latency/STT hardening + JF-009 optional Edge-TTS speech + JF-010 actions + JF-011 runtime/service status + JF-012 reminders/scheduler + JF-013 read-only public web research + JF-013.5 natural intent resolution + JF-014 read-only local workspace intelligence + JF-014.5 privilege leases + fail-closed PRIVATE_BROWSER/Whonix policy + JF-014.6 operations event bus with SSE replay + JF-015 work agent with CapabilityHost invocation, isolated `work.db`, and typed `/api/jarvis/ask` routing + EVO-001–010 evolution lifecycle with isolated `evolution.db` and one experience per task + JF-016/017/018 simulated vision/monitor/devices + typed destructive-action preflight, owner-only Emergency Stop latch, observable lease lifecycle, model-agnostic profile/provider/certification contracts, cooperative AbortSignal propagation, restart-persistent scoped containment, deterministic verification registry, and one checkpoint-backed Jarvis-owned recovery-sandbox mutation/rollback; does not replace the Digital Me dashboard). See `docs/JARVIS_PRESENCE_INTERFACE.md`. Local hardware/browser acceptance is queued in `BLOCKED_LOCAL_ACCEPTANCE.md`. Exact recovery semantics are in `docs/JARVIS_EXECUTION_RECOVERY_HARDENING.md`. BitLocker/Device Encryption must not be enabled by Jarvis. Platform queue: `JARVIS_PLATFORM_TASKS.md`.

Capability Intelligence now builds evidence-backed Self Knowledge from the existing CapabilityHost, model registries, provider/service observations, and CapabilitySelfModel. Registered, available, simulated, provider-contract, permission, local-acceptance, and distribution states remain separate. Capability graphs and structured gap plans support bounded WorkAgent replanning without creating a second registry or authority system. Verified outcomes alone increase proven competence. Assistant and Capability Explorer can answer capability, computer-control, CCTV, blocker, unavailable, and improvement questions without model imagination. CCTV remains owner-only `PREPARE_CONTRACT` plus SIMULATION; no real provider or LAN access is claimed. See `docs/JARVIS_CAPABILITY_INTELLIGENCE.md`.

Natural owner objectives for the current research, workspace, basic indexed-text document, system health, reminder, and Self Knowledge workflows now resolve through one authoritative GoalCatalog plus exact trusted input adapters. Adapter output must validate against the registered capability schema and cannot create filesystem, credential, permission, capability, shell, risk, privilege, or confirmation authority. WorkAgent consumes the declared route and can use only bounded schema-compatible safe alternatives; goal outcome evidence stays separate from per-capability competence. Unknown or ambiguous goals ask for the smallest missing detail or remain unsupported. See `docs/JARVIS_GOAL_CATALOG_INPUT_ADAPTERS.md`.

Declared goals that need one more owner field now use an expiring, session-bound pending-goal continuation protocol. It persists only redacted context, never authority; fills only the declared missing field; detects cancellation, explicit revision, drift, ambiguity, expiry, and cross-session reuse; rechecks current capability evidence and every Trusted Operator boundary; and resumes the same `WAITING_INPUT` WorkAgent task with bounded idempotency. The reminder fixture proves one ActionGate-approved mutation plus deterministic store re-read verification and no duplicate creation. CCTV continuation remains owner-only `PREPARE_CONTRACT`. See `docs/JARVIS_PENDING_GOAL_CONTINUATION.md`.

Mutating capability execution now has one persistent execution journal. Persistence is evidence, never permission. Interrupted mutation is reconciled without blind retry; ambiguous outcomes fail closed into containment. See `docs/JARVIS_EXECUTION_JOURNAL.md`.

`PROJECT_STATUS.md` and `HANDOFF.md` were last verified **2026-08-09**. They are still useful for the verified-versus-unverified boundary of the Discord/GPU loop, but they do not describe the current local model stack. Since then the default LLM moved to **Ollama + Qwen3.8 27B**, STT defaulted to **Qwen3-ASR-1.7B**, and a **read-only world-intel research layer** was added. Qwen is the current owner profile, not a Core architecture requirement; model profiles may have unknown family/size/tool metadata until evidence-backed certification exists.

---

## How another chat should use this file

1. Read this file first. Do not treat `PHASE0`–`PHASE8` status docs as current evidence.
2. Assume live Discord voice, a trained RVC model, and a live research MCP connection are **not proven** unless the operator says they just tested them.
3. Do not invent transcripts, cloned-voice quality, or “the bot already talks like X.” Offline fallbacks exist so the app can run without models.
4. Voice cloning requires explicit per-server consent. Never relax `RECORD_RAW_AUDIO`, consent buttons, or capture-target rules without being asked.
5. Secrets stay in local `.env`. Never commit `.env`, tokens, raw WAVs, RVC weights, or `data/brain/`.
6. Do not commit unless the user asks.
7. Cursor Cloud Agents should start from a dedicated `cloud/jarvis-checkpoint-*` branch when provided. Do not assume Windows paths, VirtualBox, Whonix, Discord tokens, or a private `.env`. Hardware integrations must stay mockable or fail-closed. Never put secrets in `.cursor/environment.json`.

---

## What this project is

**Digital Me** is a Thai-first Discord voice companion that runs locally on the owner’s NVIDIA GPU. It is not a text-command bot. The product is:

- join a Discord voice channel
- transcribe mixed Thai/English speech
- decide whether a human-like friend would answer, react, or stay quiet
- speak back in a **consented cloned voice**
- remember names, relationships, games, and speaking habits in inspectable local files

There is also a privacy-safe public demo and a hackathon submission package. The public site does **not** contain Discord tokens, private transcripts, raw voice datasets, or trained voice weights.

Public demo: https://digital-me-thai-voice.piriyapong2551.chatgpt.site  
Source: https://github.com/eikq/DiscordBOT  
Local dashboard: `http://127.0.0.1:3000`

---

## One-sentence current status

The local architecture, dashboard, consent/training workflow, social decision engine, inspectable memory, JaiTTS/RVC voice path, and automated tests are implemented. A full live Discord session that hears a trained clone, plus owner LoRA fine-tuning, are still the main unverified / unfinished boundaries. A Qwen3.8 + world-intel research console is implemented in the working tree and wired to `/research` and the dashboard, but it depends on Ollama, a pinned MCP install, and may not be committed yet.

---

## Hardware and configured stack (from `.env.example`)

Comments in `.env.example` are tuned for an **RTX 5090 Laptop 24 GB + 64 GB RAM** profile. Older JaiTTS docs measured an **RTX 4060 8 GB**. Do not mix those numbers.

| Role | Current default | Where it runs |
|---|---|---|
| STT | `Qwen/Qwen3-ASR-1.7B`, fallback `Qwen3-ASR-0.6B` | `http://127.0.0.1:8765` |
| LLM | Ollama model `digital-me-qwen38:27b-ad-q4km` (AtomicChat Qwen3.8 27B GGUF Q4_K_M) | `http://127.0.0.1:11434/v1` |
| Embeddings | `Qwen3-Embedding-0.6B` HTTP, with CPU hash-vector fallback | `http://127.0.0.1:8767` |
| Voice / RVC | Authenticated local RVC v2 service | `http://127.0.0.1:8766` |
| Thai source TTS | JaiTTS-F5TTS preset `realtime`, Edge-TTS fallback for short reactions | `http://127.0.0.1:8768` |
| Research | `world-intel-mcp` pinned commit `9254192d83f88bd7e5312b074c11f09398b84ca9` | stdio MCP from `.runtime/world-intel-venv` |

Launcher GPU policy: `start:local` uses the `voice` profile and caps LLM offload at `LLM_VOICE_GPU_LAYERS` (default 48) so ASR, JaiTTS, and RVC can stay resident on the same GPU. Idle LLM VRAM is released with `LLM_KEEP_ALIVE=10m`. `JARVIS_STANDALONE=1` applies the `interactive` profile instead: keep-alive `30m`, default context 4096, no JaiTTS/RVC reservation, and it does **not** raise or cap `LLM_GPU_LAYERS`. Do not use the interactive profile from `start:local`.

Voice replies are capped: `VOICE_REPLY_MAX_WORDS=22`, `VOICE_REPLY_MAX_CHARS=240`.

---

## High-level architecture

```
Discord VC Opus
    -> AudioReceiver + SafeOpusDecoder (opusscript, not native opus)
    -> Local STT (Qwen3-ASR)
    -> ConversationTimeline
    -> SocialBrain (deterministic rules first, optional LLM classify)
    -> SocialMemoryBrain (inspectable facts) + BehaviorRetriever
    -> ResponseGenerator (learned example / rules / local LLM)
    -> VoiceOutputManager (turnId + barge-in cancel)
    -> LocalTTSProvider
         short: Edge-TTS -> RVC
         longer: JaiTTS -> RVC
    -> Discord playback

Parallel:
    Dashboard (React + Express) at :3000
    LearningSessionController + VoiceDatasetWriter (consent-gated training audio)
    ResearchAssistant + McpResearchGateway (explicit /research and dashboard only)
```

The bot process is `server.ts` + `src/bot/BotService.ts`. The dashboard is `src/App.tsx`. Local services are started by `scripts/start_local.ts`.

`start:local` currently boots, in order:

1. authenticated RVC voice service
2. optional JaiTTS (falls back to Edge-TTS if it fails)
3. local STT (required)
4. Ollama LLM preload with reduced GPU layers
5. warm the selected RVC voice
6. hardware doctor
7. local service benchmark
8. Express/Vite dashboard, which connects Discord if `DISCORD_TOKEN` exists

It does **not** start the embedding HTTP server. Behavior retrieval uses token overlap first; semantic embeddings fall back to a local character-hash vector if `:8767` is down.

It also does **not** install world-intel. That is a separate `npm run research:setup`. The gateway looks for `.runtime/world-intel-venv/Scripts/world-intel-mcp.exe`.

---

## Directory map

```
server.ts                         Express API + Vite dashboard + BotService
src/App.tsx                       Local command-center UI
src/bot/BotService.ts             Discord client, slash commands, dashboard command bridge
src/bot/AudioReceiver.ts          Live VC loop, state machine, barge-in
src/bot/VoiceConnectionManager.ts Join/leave/play/stop Discord voice
src/bot/SafeOpusDecoder.ts        Crash-contained Opus decode
src/bot/timeline/                 Session transcript events
src/bot/brain/                    SocialBrain, question detector, group state
src/bot/personality/              ResponseGenerator, persona, behavior retrieval
src/jarvis/                       Jarvis Core + memory abstraction + isolated `/jarvis-lab` command center + JF-008 mic/STT + JF-008B timings/streaming + JF-009 VoiceOutputRouter + JF-010/011 actions + JF-012 reminders (`src/jarvis/automation`) + JF-013 research (`src/jarvis/research`) + JF-014 workspace (`src/jarvis/workspace`); Discord adapters exist (live `/voice` still coupled; live Core unavailable fallback)
src/agent/                        Night Autonomous Coding Worker (separate from Core). Tonight: Grok-only Cursor CLI worker; Qwen fallback off; isolated worktree + preflight required. Do not give Core file/shell tools.
src/bot/memory/                   FriendMemoryManager + SocialMemoryBrain + canonical SQLite (`data/jarvis/jarvis.db`)
src/bot/stt/                      Local + mock STT
src/bot/tts/                      Local / Colab / Gemini / ElevenLabs TTS + VoiceOutputManager
src/bot/llm/LocalLlmProvider.ts   Ollama/OpenAI-compatible + tool-calling loop
src/bot/embeddings/               Optional HTTP embeddings + CPU fallback
src/bot/voice/                    Consent, capture target, dataset, learning sessions, RVC client
src/bot/research/                 ResearchAssistant + MCP allowlist gateway  (WIP / may be uncommitted)
src/bot/simulate*.ts              Phase 2–4 offline simulators
python/local_stt_service.py       Qwen3-ASR HTTP server
python/jaitts_service.py          JaiTTS HTTP server
python/training/train_lora.py     QLoRA script (not executed/gated yet)
colab/                            Local/Colab RVC service, song conversion, cloud export
cloud/vast/                       Vast.ai training README + runner
cloud/local/                      Laptop RTX 4050 training helper
public-demo/                      Privacy-safe hackathon website
scripts/                          Setup, launcher, doctor, benchmark, eval, smoke tests
tests/                            TypeScript + Python verification
data/behavior/examples.json       Persona-scoped reply examples (tracked)
data/language/                    Pronunciation + custom STT dictionary (tracked)
data/brain/, data/voice_samples/  Local-only, gitignored
submission/                       Hackathon pitch, script, consent template
```

Runtime installs that must never be committed:

- `.venv-rvc/`, `.venv-stt/`, `.venv-jaitts/`
- `.runtime/` (RVC upstream, Qwen GGUF, world-intel clone/venv, model tools)
- `data/voice_samples/`, `data/local_voice/`, `data/brain/`, `data/memory/`, `data/jarvis/`, `data/personas.json`, `data/voice_consents.json`, `data/learning_sessions/`, `.env`

---

## Live voice conversation loop (what the code actually does)

Implemented in `AudioReceiver.ts`.

States: `LISTENING` → `PREDICTING` → `GENERATING` → `SPEAKING` → `INTERRUPTED` / `COOLDOWN`.

Per-user Opus packets are decoded to PCM. A `SustainedVoiceDetector` ignores short noise. When a person starts speaking while the bot is synthesizing or playing, barge-in cancels the current `turnId` before stale audio reaches RVC or Discord. Timing knobs:

- `VOICE_END_SILENCE_MS` default 650
- `VOICE_UTTERANCE_GRACE_MS` default 350
- `VOICE_RESPONSE_COOLDOWN_MS` default 700
- `VOICE_BARGE_IN_MIN_MS` default 320
- `VOICE_BARGE_IN_MIN_RMS_DBFS` default -42
- `VOICE_MIN_UTTERANCE_MS` default 250

Final transcripts from consented users are written into `SocialMemoryBrain`. Response generation waits for the **final** transcript, not a partial. Low-confidence / hallucinated STT is excluded from learned facts. `AudioReceiver` calls SocialBrain, then `DiscordJarvisAdapter` (live `UnavailableJarvisCore` fallback), then `ResponseGeneratorPresentationEngine.presentLegacyTurn` with the guild `PresentationProfile`. TTS uses the voice axis (`selectedVoiceForGuild`); SocialBrain addressing uses the persona axis. `ResponseGenerator` then:

1. retrieve a close owner/persona example
2. answer common daily questions with a deterministic line
3. apply a few legacy owner rules only when **no persona** is selected
4. for `SHORT_REACTION`, skip the LLM and use a rotating short acknowledgement
5. otherwise call the local LLM, reject unnatural or non-answering replies
6. if the LLM is offline and it was a question, still answer the subject instead of saying “จริงดิ”

Unprompted group replies are **off** unless `ALLOW_UNPROMPTED_RESPONSES=true`. One-on-one VC replies are **on** by default (`RESPOND_IN_ONE_ON_ONE=true`): the clone does not need to hear its own name every turn. Dashboard Session can pause auto-response per guild (`VC_AUTO_RESPONSE_DEFAULT=true`).

Research is **not** part of the live VC loop. It is an explicit Discord `/research` command and a dashboard “RUN LIVE RESEARCH” button.

---

## Dashboard panels (`src/App.tsx`)

The local UI at `:3000` is the operator command center. Panels include:

- **JARVIS Research Console** — Qwen3.8 + read-only MCP status, query box, citations
- **Discord Command Center** — server / VC / text channel / member pickers and every slash-command equivalent
- **Session** — join, leave, status, VC auto-response pause/resume
- **Local Voice Training** — person, train-from-zero vs fine-tune, best vs latest, epochs, `/train` flow
- **Voice Changer** — speech / isolated vocal / mixed song+instruments; play in browser, Discord, or both
- **Export for Training** — Vast.ai 24 GB or laptop RTX 4050 6 GB ZIP + generated command
- **Consent & Privacy**
- **Live Voice Transcriptions**
- **Test Configured TTS Bridge**
- **Persistent Social Brain** — people, relationships, search, Obsidian vault export
- **Teach Friend Speech Behavior** — persona identity + behavior examples
- **Runtime Capabilities / Live Event Log**

There is still some Colab/Drive sync UI for the older cloud path. Local RTX is the supported default (`VOICE_BACKEND=local`). A stale Colab tunnel URL is ignored when the local backend is selected.

---

## Discord slash commands

Registered by `BotService` when the client is ready:

| Command | Purpose |
|---|---|
| `/join` `/leave` `/status` `/debug` `/transcript` | Live session |
| `/research question:` | Local Qwen + MCP research with citations |
| `/train target:@name` | Normal start: consent prompt, join VC, one learning session |
| `/train-status` `/stop-train` | Inspect / freeze dataset / queue train or fine-tune |
| `/voice-consent status\|revoke` | Self-service consent |
| `/voice-target` `/voice-train` | Advanced capture target and manual job |
| `/voice user:@name` | Select an actively consented model (also selects persona) |
| `/persona` | Bind identity + aliases to the selected voice |
| `/speak text: user:` | Test cloned TTS in the current VC |
| `/voices` | List available models |

`/train` asks the tagged person once (Allow / Decline). Capture does not start without that click **and** `RECORD_RAW_AUDIO=true`. Revoke stops future capture; existing local WAVs, jobs, and models are kept.

---

## Voice cloning / RVC (implemented)

Local path:

1. `npm run voice:setup` creates isolated Python 3.12 CUDA env, pins official RVC revision under `.runtime/Retrieval-based-Voice-Conversion-WebUI`
2. `start:local` starts the authenticated loopback API on `:8766`
3. Only the capture target’s clean utterances are stored for training
4. Each utterance is WAV + UTF-8 TXT + Schema v2 JSON
5. Analyzer measures loudness, clipping, silence ratio, estimated SNR, overlap, pitch, rate, pauses, energy variation, conversational style
6. Rejected clips remain for inspection and are not uploaded for RVC
7. `/stop-train` writes an immutable version manifest under `data/voice_samples/<discord-user-id>/versions/`
8. First model default: **120 clean seconds**. Later best-model fine-tune: **180 new clean seconds**. Upload-triggered auto-train is disabled (`AUTO_TRAIN_ON_UPLOAD=false`) so training never starts mid-listen
9. Every completed epoch replaces rolling `latest`. `best` is replaced only when mean generator training loss improves. The published active model is `best`. Optimizer checkpoints stay interval-based to spare the SSD
10. Scores live in `checkpoint_metrics.json` beside the model. That score is a training-loss estimate, **not** a listening test

JaiTTS:

- Checkpoint `JTS-AI/JaiTTS-F5TTS`, license **CC BY-NC 4.0** — personal/research only, not commercial
- Measured `realtime` preset: NFE 12 / CFG 2.0
- Short reactions stay on Edge-TTS because JaiTTS duration prediction was unstable on very short words
- End-to-end `turnId` cancel was verified over HTTP (cancelled generations return 409). A new manual human barge-in listening test in Discord was still pending in `JAITTS_INTEGRATION_STATUS.md`

Voice Changer extra path (dashboard, not the live conversation loop):

- microphone blocks (~3.2 s, near-real-time, not zero-latency)
- file conversion up to 100 MB / 10 minutes
- singing vocal-only vs mixed song (Demucs separate → RVC vocals → remix instruments)

Cloud training export exists for Vast.ai 24 GB and a conservative laptop RTX 4050 6 GB profile. Tokens must never go into that ZIP.

---

## Social brain and memory (implemented)

Two layers exist. Do not confuse them.

### 1. `SocialMemoryBrain` — the current inspectable brain

Canonical files (gitignored):

- `data/brain/brain_state.json`
- `data/brain/observations.jsonl` (append-only audit trail)
- `data/brain/vault/` (Obsidian-compatible export)

Learns, from consented final transcripts plus acoustic metadata:

- display names, nicknames, how friends address one another
- relationship interaction counts
- games, recurring activities, stated preferences
- speaking style (length, slang, short replies)
- acoustic style (pitch, rate, pauses, energy, delivery styles)

Rules: low-confidence STT is ignored; repeated evidence raises confidence; newer contradictions supersede older beliefs without deleting the audit trail. Relevant summaries are injected into the response prompt. This is **not** LLM weight training.

Design-only Jarvis memory interfaces and SQLite schema now live in `src/bot/memory/jarvis/`. They project from `SocialMemoryBrain` and do **not** migrate or delete `data/brain/`.

### 2. `FriendMemoryManager` — older JSON memory

`data/memory/friends_db.json`. Filters banter, supports `expiresAt`, supersession, and owner wipe APIs. Still tested by `simulate:p4` and `tests/core.test.ts`. Phase-4 docs wrongly say SQLite; it is JSON.

### Persona + behavior examples

`PersonaProfileManager` persists in `data/personas.json` (gitignored). Dashboard behavior examples in `data/behavior/examples.json` are **scoped to `personaUserId`**. A selected clone must not inherit Spin’s habits. Tests cover this isolation.

Thai social fixtures in `tests/fixtures/thai_social_cases.jsonl` currently have **4 cases**, not the “40+” claimed in `PHASE2_STATUS.md`.

---

## Research / world intel (implemented in working tree)

Files:

- `src/bot/research/ResearchAssistant.ts`
- `src/bot/research/McpResearchGateway.ts`
- `tests/research.test.ts`
- `scripts/setup_world_intel.ps1`
- `scripts/smoke_world_intel.ts`

Behavior:

- Qwen chooses tools from a **read-only allowlist**
- tool output is wrapped in `<untrusted_tool_output>` and must not be obeyed as instructions
- URLs are collected into a source ledger; the model is told not to invent citations
- mutating tools such as `intel_aoi_delete` are rejected before connect
- one failed upstream source is surfaced as unavailable JSON so the model can say it does not know

Allowlisted tools: `intel_status`, `intel_news_feed`, `intel_trending_keywords`, `intel_gdelt_search`, `intel_world_brief`, `intel_daily_digest`, `intel_market_quotes`, `intel_crypto_quotes`, `intel_forex_rates`, `intel_earthquakes`, `intel_disaster_alerts`, `intel_ai_releases`, `intel_hacker_news`, `intel_arxiv_papers`.

Setup: `npm run research:setup` then `npm run research:smoke`. Qwen GGUF import: `npm run model:qwen38`.

This path is **not** auto-invoked from voice chat.

---

## HTTP APIs (`server.ts`)

Useful endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Dashboard already-running check |
| GET | `/api/intelligence/status` | LLM + MCP + research activity |
| POST | `/api/intelligence/ask` | Dashboard research |
| GET/POST | `/api/control` | Guided Discord commands |
| GET/POST | `/api/bot/status`, `/api/bot/start` | Bot connection |
| GET | `/api/brain` POST `/api/brain/action` | Social brain + vault |
| GET/POST | `/api/behavior`, `/api/personas` | Behavior examples / personas |
| GET | `/api/transcripts`, `/api/voice-samples` | Live inspect |
| POST | `/api/tts/test` | Dashboard TTS test |
| POST | `/api/voice-export`, `/api/voice-export/preview` | Cloud training ZIP |
| POST / GET | voice convert + `/api/voice/convert/progress/:jobId` | Voice changer jobs |

Dashboard is bound to `HOST` default `127.0.0.1` — localhost only.

---

## npm scripts that matter

```powershell
npm ci
Copy-Item .env.example .env
npm run voice:setup
npm run stt:setup
npm run jaitts:setup
npm run model:qwen38
npm run research:setup
npm run start:local          # main launcher
npm run verify               # lint + tests + colab syntax + build + phase sims + stress
npm run test
npm run lint
npm run benchmark
npm run doctor
npm run research:smoke
npm run benchmark:qwen38
npm run smoke:voice
npm run annotate / evaluate / evaluate:owner
npm run fine-tune:prepare
```

`npm run benchmark` reports unavailable model services as `OFFLINE`. It must not be treated as proof of live speech if services are down.

---

# Status board — done / implemented-unverified / not done

Use this section as the checklist. “Done” means the code exists and local tests or honest local checks cover it. It does **not** automatically mean a human heard it in Discord today.

## Done and locally verified (code + tests / syntax / simulations)

These are safe to treat as working software, with the caveats in parentheses.

- Clean npm install, TypeScript `lint`, production build of dashboard + `dist/server.cjs`
- Express + React local command center, including disconnected mode without `DISCORD_TOKEN`
- Discord command surface and dashboard equivalents (registration itself needs a live token)
- Opus receive/decode via `opusscript`; malformed packets contained
- Offline STT/TTS honesty: no fabricated transcripts, no synthetic tone “speech” when services are down
- Thai social decision rules: direct address, questions without punctuation, follow-ups, one-on-one VC, silence bias, cooldown
- Persona-scoped behavior examples and alias ownership (clone is not forced to be Spin)
- Short reactions skip LLM; misclassified questions are upgraded to real answers
- Daily-status questions still get a content answer if the LLM is offline
- Friend memory supersession / expiration / wipe (JSON store)
- SocialMemoryBrain people, aliases, games, activities, relationships, Obsidian vault generation
- Voice consent grant/revoke scoped to a Discord server
- Capture target restricts raw training audio to one consented user
- Dataset writer: matched WAV / TXT / JSON, quality analyzer accept/reject
- Learning session persist, resume after restart, versioned manifest of accepted IDs + SHA-256
- Automatic train decision: first model vs best-model fine-tune vs keep collecting
- Local RVC client: bearer auth, raw WAV upload, fresh/finetune, best/latest, stop-after-epoch
- Cloud export preview payload (contents + cleanup flags)
- TTS pronunciation dictionary with escaped punctuation and ASCII token boundaries
- Barge-in cancel while synthesizing and while playing; sustained-voice detector vs short noise
- Phase 2 / 3 / 4 simulators with assertions and nonzero failure exits
- Decision-loop stress simulation
- Python syntax checks for voice backend, JaiTTS, STT, cloud export, Colab notebook JSON parse
- Python unit tests around STT quality, RVC checkpoint tracker, song conversion, voice prosody/delivery, Vast GPU retry, cloud export
- Research unit tests: allowlist block, source ledger, upstream failure recovery, Ollama tool loop (mocked HTTP)
- Privacy default `RECORD_RAW_AUDIO=false` enforced at runtime
- Public demo is a separate privacy-safe sandbox (`public-demo/`)
- Hackathon submission docs under `submission/`

Historical local GPU check recorded in `PROJECT_STATUS.md` (2026-08-09, RTX 4060): `voice:setup` completed, PyTorch 2.7.1 + CUDA 11.8 detected, a disposable one-epoch smoke model completed preprocess / RMVPE / HuBERT / train / FAISS / publish / Thai WAV, and deleting that disposable speaker cleaned artifacts. That is evidence the RVC package can run, **not** evidence that the owner’s current voice model is trained or that Discord playback is good.

## Implemented, but not live-verified (do not claim these as proven)

These exist in code and often have unit/smoke coverage, but they still need a real machine + Discord + models + listening test.

- Discord login and slash-command registration on a real guild
- Join/leave a real voice channel and stay up through reconnects / packet loss / multiple guilds
- End-to-end: Discord Opus → STT → decision → TTS/RVC → Discord playback that a human judges as the target person
- Live barge-in while a person is talking over the bot in VC
- Qwen3-ASR accuracy on noisy Discord mics, overlap, and Thai-English code-switch in production
- Ollama Qwen3.8 27B quality/latency beside ASR + JaiTTS + RVC on the current GPU
- JaiTTS naturalness across styles; WavLM/CER numbers are not a substitute for listening
- RVC model trained from a real consented Discord session (120+ clean seconds) and then `/speak` in VC
- Dashboard Voice Changer microphone and mixed-song path on a long file
- Vast.ai / laptop 4050 export actually finishing training on a rented or laptop GPU and importing weights back
- World-intel MCP live connectivity, tool freshness, and citation quality
- `/research` in Discord and the JARVIS dashboard against live feeds
- Embedding HTTP service at `:8767` (launcher does not start it; retrieval currently uses token overlap + hash fallback)
- Colab notebook on a real T4 (legacy path; local RTX is the supported default)
- Production behavior under GPU contention (training vs inference vs ASR vs LLM)

Required for those tests: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, Message Content intent, VC connect/speak permissions, `RECORD_RAW_AUDIO=true` only for a consented session, and the local services actually running. Details: `WHAT_I_NEED_FROM_OWNER.md`.

## Not done yet / blocked / do not implement as if finished

- Bundled installer/launcher that also brings up embedding server and world-intel without extra setup commands
- Trained **owner LoRA** and a measured baseline-versus-fine-tuned deployment gate. `python/training/train_lora.ts` / `train_lora.py` plus `npm run fine-tune:prepare` exist, but training has not been executed. The script still targets `typhoon-ai/typhoon2.5-qwen3-4b`, which is **behind** the current Ollama Qwen3.8 27B runtime
- Research automatically used during voice chat when someone asks a news/market question out loud
- True streaming TTS (JaiTTS returns a full WAV; RVC adds post-source latency)
- Commercial license for JaiTTS (current checkpoint is CC BY-NC 4.0)
- Zero-latency voice changer
- Guaranteed singing-register clone without singing recordings of the target
- Physical confirmation that deleting a voice after a **live** Discord session removes every expected local file
- Recovering `project.tar.gz` (corrupted; Git is authoritative)
- Treating PHASE status checkboxes or old benchmark millisecond tables as current measurements
- Live Discord Core still uses `UnavailableJarvisCore` + `ResponseGenerator` fallback. Standalone text+mic Core (`LocalLlmJarvisCore`) is live-verified on `/jarvis-lab`; JF-009 native Edge-TTS is live-verified as an API audio payload (browser speaker start not measured; clone live speech not verified)
- Further Discord JARVIS-006+ (deferred by Jarvis-first addendum)
- Digital Me dashboard rewrite (isolated `/jarvis-lab` command center exists; CSS/SVG core, not WebGL)
- Qdrant live index / MEMORY-003

---

## Working tree snapshot (as of 2026-08-18)

These paths were dirty or untracked when this context was written. Another chat should `git status` again before committing.

Modified:

- `.env.example` — Qwen3.8, research, STT 1.7B, GPU layer caps
- `package.json` / `package-lock.json` — `@modelcontextprotocol/sdk`, `research:*`, `model:qwen38`
- `python/local_stt_service.py`
- `scripts/benchmark.ts`, `doctor.ts`, `local_llm_process.ts`, `local_voice_process.ts`, `start_local.ts`
- `server.ts`, `src/App.tsx`, `src/index.css`
- `src/bot/BotService.ts`, `LocalLlmProvider.ts`, `ResponseGenerator.ts`
- `data/behavior/examples.json`, `data/language/custom_dictionary.json`

Untracked (likely the research/Qwen drop):

- `src/bot/research/McpResearchGateway.ts`
- `src/bot/research/ResearchAssistant.ts`
- `tests/research.test.ts`
- `scripts/setup_qwen38.ps1`
- `scripts/setup_world_intel.ps1`
- `scripts/smoke_world_intel.ts`
- `scripts/benchmark_qwen38.ts`
- `ChatGPT-Website-Creator-Prompt-Pack.pdf` (unrelated prompt pack; do not treat as product code)

---

## Privacy and safety rules that must stay intact

- Record raw audio only when `RECORD_RAW_AUDIO=true` **and** the tagged user clicked Allow on that server
- Capture target ≠ conversation target: consented people can be transcribed for chat; only the selected target is stored as training WAVs
- Public demo and GitHub must not contain tokens, private transcripts, raw datasets, or RVC weights
- Revoke stops future capture; it does not silently wipe history unless a dedicated delete path is used
- Generated audio must not be presented as the real person
- Research tools are read-only; untrusted tool text is evidence only
- JaiTTS is non-commercial until the checkpoint license changes

Consent template: `submission/VOICE_CONSENT_RELEASE.md`.

---

## Tests a follow-up chat can run

```powershell
npm run lint
npm test
npm run research:smoke
npm run benchmark
npm run verify
```

`verify` is the heavy gate: lint, TS+Python tests, Python compile of voice/JaiTTS/STT/cloud, production build, `simulate:p2/p3/p4`, and `stress`.

TypeScript tests live mainly in `tests/core.test.ts`, `tests/research.test.ts`, `tests/jarvis_memory.test.ts`, `tests/jarvis_sqlite_memory.test.ts`, `tests/jarvis_core_memory.test.ts`, `tests/jarvis_first.test.ts`, `tests/jarvis_capabilities.test.ts`, and `tests/jarvis_platform.test.ts`. They cover social fixtures, persona isolation, canonical SQLite + Core memory integration, STT honesty, consent/dataset/learning, RVC client payloads, pronunciation, Opus safety, barge-in, research allowlist honesty, MEMORY-001 schema/projection, and JARVIS presentation isolation.

---

## Documents: trust ranking

**Trust for current engineering**

1. This file (`PROJECT_CONTEXT.md`)
2. `AGENTS.md`, `TASKS.md`, `TESTING_POLICY.md`, `SECURITY_PRIVACY.md`
3. `README.md` — product overview and commands
4. `LOCAL_VOICE_GUIDE.md` — RVC / training / voice changer / export
5. `.env.example` — actual runtime knobs
6. `JAITTS_INTEGRATION_STATUS.md` + `docs/JAITTS_*.md` — JaiTTS limits and measured presets
7. `WHAT_I_NEED_FROM_OWNER.md` — live Discord requirements
8. `PROJECT_STATUS.md` — 2026-08-09 verified/unverified Discord-GPU boundary (LLM names there are stale)

Treat `ROADMAP.md`, `FUTURE_ARCHITECTURE.md`, `NIGHT_AGENT_FUTURE.md`, `RESOURCE_PROFILES.md`, `JARVIS_MEMORY_ARCHITECTURE.md`, `JARVIS_UI_UX_VISION.md`, and `JARVIS_PLATFORM_ARCHITECTURE.md` as direction, not as completed live behavior. `src/jarvis/` contracts, `PresentationSessionStore`, and `DiscordJarvisAdapter` are implemented and unit-tested. Standalone Core can attach `JarvisMemoryService`; `/jarvis-lab` is an isolated CSS/SVG command center (UI-R1–R8) with JF-008 mic/STT, JF-008B interactive-profile timings/streaming, and JF-009 optional speech after Presentation. Live `/voice` still sets both axes. Live Discord Core is unavailable and falls back to `ResponseGenerator`.

**Historical / do not quote as current facts**

- `PHASE0_BENCHMARK.md` … `PHASE8_STATUS.md` — generated, several false claims (40+ fixtures, SQLite, “voice clone complete”, LoRA gated deploy)
- Old HANDOFF next-milestone that still pushes Colab T4 as the remaining boundary; local RTX is now the default path

Hackathon packaging: `submission/HACKATHON_SUBMISSION.md`.

---

## Common pitfalls for the next agent

1. **PHASE docs lie.** Example: Phase 1 still says MockSTT is current; production STT is `LocalSTTProvider` + Qwen3-ASR. Phase 5 said cloning was not implemented; local RVC + JaiTTS **is** implemented.
2. **LLM default is Ollama `:11434`, not llama.cpp `:8080`.** `WHAT_I_NEED_FROM_OWNER.md` now matches that.
3. **Fallback replies are not the persona.** If Ollama is down, the bot still answers with short deterministic Thai. That is not proof the 27B model is working.
4. **Do not train from Drive/Colab by default.** `VOICE_BACKEND=local`.
5. **Do not start training from uploads.** Learning sessions freeze a version first.
6. **Best vs latest:** playback/publish uses `best` unless the operator explicitly selects `latest`.
7. **GPU sharing:** raising `LLM_GPU_LAYERS` without the voice cap can evict ASR/JaiTTS/RVC.
8. **STT prompt echo:** leave `STT_CONTEXT` blank for live Discord; a long keyword prompt can be transcribed as fake speech.
9. **Research ≠ voice.** Wiring MCP into `AudioReceiver` would be new work, with timeout and “don’t speak a news brief over friends” product questions.
10. **LoRA script target model is stale** relative to Qwen3.8 27B.

---

## Suggested next work (only if the user asks)

In likely dependency order:

1. Owner installs Cursor CLI (`agent` on PATH), logs in, and pastes the exact Grok 4.6 model id. Then `npm run agent:night:prepare -- --create-worktree --name night-2026-08-19 --acknowledge-head-only` and one Grok-only dry-run. Do not start Qwen.
2. Owner product sign-off of JF-010 desktop actions, JF-011 runtime/service pack, JF-012 reminders, and JF-013 public research (agent live already passed; no Discord)
3. Later individual action capabilities **only if the owner asks** (no generic shell, process API, or scheduled CapabilityHost execution)
4. NIGHT-BUILD-010 Windows scheduler **only if the owner asks**
5. Consented standalone clone live verify only if owner sets `STANDALONE_CLONE_CONSENT` + speaker mapping
6. Confirm `git status`, then commit remaining unrelated dirty voice/STT work only when asked
7. Discord live smoke remains deferred

---

## Quick glossary

| Term | Meaning |
|---|---|
| Digital Me | This project; the voice companion |
| Capture target | The one consented user whose WAVs may be trained |
| Persona | Identity + aliases bound to a cloned user id |
| SocialBrain | Turn-taking policy (answer / react / ignore) |
| SocialMemoryBrain | Inspectable long-term social facts |
| RVC | Retrieval-based Voice Conversion; the clone engine |
| JaiTTS | Thai source TTS before RVC; non-commercial checkpoint |
| Barge-in | Cancel current bot speech because a human started talking |
| world-intel-mcp | Read-only public-intel MCP server used by research |
| Best / Latest | RVC checkpoints: lowest training loss vs last finished epoch |
