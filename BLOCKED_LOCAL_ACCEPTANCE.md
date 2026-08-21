# BLOCKED_LOCAL_ACCEPTANCE

Authoritative local-machine queue for work that Cursor Cloud cannot complete.
Cloud may prepare interfaces, diagnostics, UI states, and fail-closed mocks only.

Labels: **BLOCKED_LOCAL_ACCEPTANCE**. Do not mark these LIVE_VERIFIED until the owner
runs them on the physical Windows machine.

Recommended order: LA-015 → LA-001 → LA-016 → LA-002 → LA-008 → LA-003 →
LA-004 → LA-005 → LA-006 → LA-007 → LA-009 → LA-010 → LA-011 → LA-012 →
LA-014 → LA-013.

---

## LA-001 Ollama / Qwen real task path

- Purpose: Prove a normal `/api/jarvis/ask` turn uses local Qwen for conversation
  and informational routes, and that agentic routes still invoke CapabilityHost.
- Preconditions: Ollama reachable; `digital-me-qwen38:27b-ad-q4km` (or current
  `.env` model) pulled; dashboard on loopback; no Discord required.
- Exact verification:
  1. `hello` → conversation, no WorkAgent DAG.
  2. `explain recursion` → informational LLM reply, no work.db task.
  3. `research the latest Qwen documentation` → WorkAgent research path.
  4. A bound capability such as `สถานะระบบ` still uses ActionGate, not a greeting path.
- Expected: replies are model-generated; Command Center shows the real route;
  no fabricated citations.
- Failure evidence: Ollama probe, `/api/jarvis` status, requestId, route JSON,
  work.db task row if any.

## LA-002 Personal AI OS browser / SSE visual QA

- Purpose: Owner visual acceptance of `/jarvis-lab` as the Personal AI operating interface.
- Preconditions: local dashboard; browser; reduced-motion check; EventSource
  supported.
- Exact verification: load `/jarvis-lab`; confirm Home answers core/current work/
  attention/Ask within five seconds; navigate every deep link; use Ctrl/Cmd+K;
  confirm SSE reconnect + replay; run a real task; confirm DAG, Risk Brief,
  permission wait, post-action evidence, empty Fluctlight when no data, and
  SIMULATION labels on demos; no hidden chain-of-thought. Check responsive and
  reduced-motion behavior.
  Activate Emergency Stop with a queued task, a waiting permission, and an
  ACTIVE test lease; confirm the UI shows exact cancellation/lease states,
  refresh/restart preserves the latch, and only owner resume clears it.
- Expected: UI matches real records. Demos stay labeled SIMULATION.
- Failure evidence: screenshots, EventSource console, `/api/jarvis/events`
  after= cursor, `present()` JSON.

## LA-003 Whonix Gateway health

- Purpose: Confirm Gateway VM is up and isolated.
- Preconditions: Official Whonix LXQt Gateway imported; VirtualBox 7.2.x;
  start Gateway alone first.
- Exact verification: `VBoxManage showvminfo`; health snapshot
  `virtualBox/gateway=up`, `isolationOk=true`.
- Expected: Gateway desktop reachable; clipboard/DnD/USB remain off.
- Failure evidence: VBox logs, NIC dump, health JSON.

## LA-004 Whonix Workstation / Tor routing

- Purpose: Confirm Workstation uses Whonix internal NIC only and Tor works.
- Preconditions: Gateway already healthy; start Workstation second.
- Exact verification: Workstation NIC is Internal `Whonix` only; live Tor check
  from the documented health path.
- Expected: `tor=up` only after a real Tor check. Never invent it.
- Failure evidence: NIC machinereadable dump, Tor check stdout, health JSON.

## LA-005 Private Playwright browser

- Purpose: PRIVATE_BROWSER live path through Whonix.
- Preconditions: LA-003/004 pass; Playwright worker only in Workstation.
- Exact verification: lab `/api/jarvis/private-research` stays fail-closed on
  host; guest worker fetch of a public page; no host Chrome/Edge.
- Expected: `available=true` only when Tor + worker are live.
- Failure evidence: `reasonCode`, route health, worker log. Host must stay
  fail-closed if Workstation is down.

## LA-006 Discord text / voice integration

- Purpose: Existing Digital Me Discord path still compiles and behaves.
- Preconditions: owner `.env` token; consent rules unchanged.
- Exact verification: text reply; voice join; IGNORE / REACT / SPEAK timing;
  no new Discord features required.
- Expected: SocialBrain decisions unchanged; no evolution record per message.
- Failure evidence: bot logs, decision traces, no raw audio unless consented.

## LA-007 microphone / STT / TTS / RVC

- Purpose: Standalone lab mic + JF-009 speech + consented clone.
- Preconditions: Qwen3-ASR, JaiTTS/Edge-TTS, RVC services; `RECORD_RAW_AUDIO=false`.
- Exact verification: lab mic transcript; typed Speak default off; clone only
  with standalone consent + mapping.
- Expected: Core stays TTS-free; clone not represented as the real person.
- Failure evidence: STT probe, speech router result, consent store (no WAVs
  committed).

## LA-008 resource priority under voice load

- Purpose: REALTIME_VOICE > OWNER_TASK > BACKGROUND_EVOLUTION.
- Preconditions: voice session active; night cycle eligible.
- Exact verification: start voice; trigger night; night pauses with
  `pausedFor=realtime_voice`; owner task still runs.
- Expected: no night/benchmark steal of GPU during live voice.
- Failure evidence: night report, resource policy snapshot, GPU notes.

## LA-009 real screen capture

- Purpose: JF-016 SEE ≠ CLICK ≠ TYPE ≠ SUBMIT on the owner PC.
- Preconditions: owner screen-capture permission; SensitiveRegionPolicy on.
- Exact verification: capture one window; analyze; attempt click without
  permission must fail.
- Expected: cloud fixtures remain SIMULATION; live capture labeled REAL.
- Failure evidence: permission state, provider health, redacted telemetry.

## LA-010 proactive Windows monitoring

- Purpose: JF-017 real signals with cooldown and quiet hours.
- Preconditions: owner enables proactive alerts; not during quiet hours unless
  critical.
- Exact verification: inject a real warning; confirm notify once; repeat within
  cooldown → ignore.
- Expected: no spam; simulated fixtures stay labeled SIMULATION.
- Failure evidence: monitor decisions, timestamps, preference snapshot.

## LA-011 CCTV provider

- Purpose: JF-018 VIEW must never imply CONTROL/CONFIGURE/ADMIN.
- Preconditions: owner camera credentials stay local; not committed.
- Exact verification: list devices; VIEW works; CONTROL/CONFIGURE denied
  without a separate grant.
- Expected: offline camera is UNAVAILABLE, not fabricated frames.
- Failure evidence: device capability matrix, health, error codes.

## LA-012 phone / device provider

- Purpose: PC / phone / sensor / smart-device contracts on real hardware.
- Preconditions: owner device pairing; VIEW/CONTROL split.
- Exact verification: status VIEW; a CONTROL action requires permission.
- Expected: missing hardware = UNAVAILABLE/BLOCKED, never silent success.
- Failure evidence: provider health, capability class, audit row.

## LA-013 owner visual / UI sign-off

- Purpose: Human acceptance of the Personal AI OS, Trusted Operator UX, and Fluctlight honesty.
- Preconditions: LA-001 and LA-002 done; at least one real task and one empty
  profile.
- Exact verification: owner reviews calm Home, conversation vs agentic routes,
  Task Center, Permission/Risk Brief, Security, Activity, expert disclosure,
  evolution graph (no decorative edges), and SIMULATION vs REAL labels.
- Expected: owner accepts or files specific UI defects. Not claimed by cloud.
- Failure evidence: owner notes, screenshots, rejected states.

## LA-014 privacy-first perceptual memory

- Purpose: Prove any future Personal Digital Memory capture is source-scoped,
  consented, minimized, redacted, retained, and deletable on the owner PC.
- Preconditions: separately reviewed Windows capture provider; Privacy Gate and
  Sensitive Context Filter implemented; capture disabled by default; owner has
  configured private apps/windows and retention.
- Exact verification: password manager, OTP, credential dialog, banking view,
  `.env`, token-like clipboard and owner-private window produce no stored raw
  content; allowed test activity is redacted before SQLite/FTS/blob/model access;
  pause, delete-day, delete-app and delete-all work; filter failure fails closed.
- Expected: observations remain untrusted data with authority=`none`; summaries
  keep provenance and cannot overwrite owner facts or invoke capabilities.
- Failure evidence: redacted policy decision logs, observation IDs, deletion
  verification, storage inspection, performance/retention measurements. Never
  place rejected secret values in logs or screenshots.

---

## LA-015 Trusted Operator runtime on owner Windows

- Purpose: Accept the real execution interlock without pretending to terminate
  processes Jarvis does not own.
- Preconditions: local loopback dashboard; disposable typed test capability;
  one queued task, one waiting approval, and one short-lived test lease.
- Exact verification: activate Emergency Stop; new WorkAgent tasks and
  capability execution fail with `EMERGENCY_STOP_ACTIVE`; pending confirmation
  cannot be reused; test lease becomes REVOKED; cancellation is exactly
  CANCELLED / CANCELLATION_REQUESTED / NOT_CANCELLABLE; reload and restart leave
  the stop active; a model/system request cannot resume; explicit owner RESUME
  does. Inspect redacted Activity events.
- Expected: no new autonomous mutation or lease grant while active; evidence is
  preserved; no claim that an arbitrary external OS process was killed.
- Failure evidence: `/api/jarvis/operator`, event sequence, task/lease ids,
  restart logs, and the typed capability result. Do not include secrets.

## LA-016 Model-agnostic local provider acceptance

- Purpose: Prove current Qwen remains a configuration profile while Core works
  through family-neutral contracts.
- Preconditions: current Ollama/Qwen available; a separately configured
  non-Qwen OpenAI-compatible test model if the owner chooses to test one.
- Exact verification: status returns the configured model/runtime without
  invented family/parameter metadata; uncertified TOOL_SELECTION does not
  route; run certification fixtures; only evidence-backed PASS becomes
  eligible; compare one conversation through each configured provider.
- Expected: no model-family branch changes permission or capability authority.
- Failure evidence: model profile, certification records, provider health, and
  redacted request/result metrics.

## Cloud-prepared but not live

- ScreenCaptureProvider / VisionAnalyzer / VisualContext / SensitiveRegionPolicy
- ProactiveMonitor cooldown + quiet hours
- Device VIEW/CONTROL/CONFIGURE/ADMIN split
- PRIVATE_BROWSER fail-closed host policy
- Night cycle resource pause hooks
- ActionGate confirmation store (in-memory; restart requires re-confirm)
- Personal Digital Memory privacy/provider contract (no capture provider active)
- Security Academy reference/sandbox design (no external project executed)
- Emergency Stop runtime/UI are cloud-tested; owner Windows execution,
  restart, browser, and actual provider cancellation remain LA-015.
