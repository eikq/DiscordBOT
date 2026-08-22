# Cursor Session State

Updated: 2026-08-22
Agent/model: Cursor Grok 4.6 (owner Windows)

## This turn — continuous conversation intelligence live 31–214

Branch: `local/jarvis-continuous-conversation-intelligence-v1-2026-08-22`
from source checkpoint `ec5e1592a15983105b0de54e891195b812ab2798`.
Did not modify `main`. Did not merge, rebase, reset, clean, or push.

Conversation working memory is CONTEXT, not authority. Qwen output is
interpretation only. CLICK / TYPE / SUBMIT remain unavailable.

Live Presence: `http://127.0.0.1:3012/jarvis?contextDebug=1` session
`jarvis-lab`. OWNER turns 31–214 were typed into the real composer
(Playwright into `textarea[aria-label="Talk to Jarvis"]` + `.jp-send`),
not `POST /api/jarvis/ask`. llama.cpp stayed on 8086. Conversation
state was not wiped between blocks.

CHECKPOINT: `15a4d5836cb3a856e6e32ef929f331f5ee976914`
FINAL HEAD: `97705b309aa2a09f31df9a9cedf391550a2a0e3a`

Turns 1–30: previous LIVE/PARTIAL. Turns 31–214: LIVE executed
(184/184 recorded). Strict debug-overlay scoring of 31–214:
GOOD 65 / PARTIAL 85 / DUMB 33 / FAILED 1. Later generalized
fixes are **UNIT_VERIFIED**; those DUMB turns were **not** live-rerun
and are **not** LIVE_VERIFIED as passing.

Verification: `npx tsc --noEmit` PASS; conversation intelligence
**70 / 70** PASS; focused intent/memory/builder/permission
**162 / 162** PASS; `npm run test:cloud` **786 / 786** PASS;
`npm run build` PASS (same Vite/`import.meta` warning). Labels:
**IMPLEMENTED** + **UNIT_VERIFIED** + mixed **LIVE** (not all GOOD).

## Previous — live software builder acceptance

Branch: `local/jarvis-persistent-permission-builder-runtime-v1-2026-08-22`
started at HEAD `bb8ad56861fac10fddd966568ba5fefe6269f841`. Did not
modify `main`. Did not push. Not a new architecture phase.

Live Presence: `http://127.0.0.1:3012/jarvis` session `jarvis-lab`.
`JARVIS_STANDALONE=1` `JARVIS_LIVE_NPM=1`. llama.cpp stayed on
`http://127.0.0.1:8086/v1` model `qwen38-cyber` (`MODEL_READY`).

Canonical live goal “สร้างเว็บ todo แบบ modern ให้ผม”:

- `goalId=BUILD_WEBSITE`
- `planId=plan_d10f1b4c-6d05-46b4-a526-41ecbff3106e`
- `slug=todo-modern`
- workspace `data/jarvis/builds/todo-modern/`
- proposal `ap-17efcac7-e4f5-484d-ad10-6e550b1e41e7`
- lease `lease_b36148ce192d3ed4` THIS_GOAL, revision 2 before and after restart
- SSE `PERMISSION_SNAPSHOT` token hash stable across refresh
- Owner UI grant history: `[อนุญาตงานนี้]` `source=ui_action`

Same-branch live fix: Windows `spawn EINVAL` on `npm.cmd` with `shell:false`.
Typed runner now invokes `node.exe` + `npm-cli.js` (still no shell, no
`npm exec`). Failed install produced `spawn EINVAL`; after the fix,
`npm install` exit 0 (65 packages / 12s), `npm run build` exit 0,
`npm run test` exit 0 (`smoke ok`), preview `http://127.0.0.1:4173`
HTTP 200 title `Todo App`, listen `127.0.0.1` only. Restart emitted
`LEASE_REVALIDATED` for the same lease id. `project.stopDevServer`
stopped `dev_1a028b9829b_4173` with no new permission prompt.

CLICK / TYPE / SUBMIT remain unavailable.

## Previous — persistent permission + typed software builder runtime

Branch: `local/jarvis-persistent-permission-builder-runtime-v1-2026-08-22`
from exact source HEAD `7f7f55b3fcb4d4aeffeef9636a4a972387b45006`
(`local/jarvis-qwen-memory-build-studio-v1-2026-08-22`). Did not modify
`main`. Did not merge, rebase, reset, clean, or push.

Verification: `npx tsc --noEmit` PASS; focused builder/studio/presence/actions/
journal/recovery tests PASS; `npm run test:cloud` **715 / 715** PASS (was 704);
`npm run build` PASS (same Vite/`import.meta` warning). Labels:
**IMPLEMENTED** + **UNIT_VERIFIED**. **LIVE_VERIFIED** is not claimed.
Real `npm install` / `npm run` / localhost preview were skipped in
`NODE_TEST_CONTEXT` unless `JARVIS_LIVE_NPM=1`.

Architecture:

- Canonical permission state: operational SQLite
  `data/jarvis/runtime/permissions.db`. Never `jarvis.db`. Never tokens.
  `PERSISTENCE != AUTHORITY`. Restart revalidates goal/plan, target jail,
  effects, expiry, policy fingerprint, and capability availability before
  `PrivilegeLeaseStore.restoreValidated`. Failures:
  `EXPIRED` / `NEEDS_REAPPROVAL` / `INVALID_AFTER_RESTART`.
- SSE replay: existing ops bus. `GET /api/jarvis/events?stream=1` writes
  `PERMISSION_SNAPSHOT` first. Unused confirmation tokens are reused so a
  refresh does not invalidate the card.
- Owner confirm/deny from voice, text, Presence, and confirm API share history.
  UI buttons: `[อนุญาตงานนี้]` / `[อนุญาตครั้งนี้]` / `[ไม่อนุญาต]`,
  `metadata.source=ui_action`.
- Model identity is registry-derived: Qwen3.8 27B Cyber Abliterated /
  alias `qwen38-cyber`. Qwen cannot author identity fields.
- Typed `ProjectWorkspace` under `data/jarvis/builds/<slug>/`. No raw shell.
  `npm install` / `npm ci` only. Registered scripts only. Dev server
  `127.0.0.1` ports 4173–4299; restart marks unknown process state honestly.
- BuildPlan visual stages: UNDERSTAND…PREVIEW…VERIFY…DONE from real SSE.
  Failure → classify → bounded correction, no blind mutation retry.
- Qwen still has no terminal tool. Model cannot renew/expand a lease.

LIVE acceptance of “สร้างเว็บ todo แบบ modern ให้ผม” was **not** run this
turn. CLICK / TYPE / SUBMIT remain unavailable.

## Previous — live acceptance of qwen-memory-build-studio

Branch: `local/jarvis-qwen-memory-build-studio-v1-2026-08-22`.
Started at HEAD `94740198af05dc4d7c1b2484ab4adfdddb38a686`. Did not
modify `main`. Did not push. Did not start a new feature phase.

Live Presence: `http://127.0.0.1:3011/jarvis` session `jarvis-lab`.
llama.cpp stayed on `http://127.0.0.1:8086/v1` model `qwen38-cyber`.
Port 3000 was left alone.

Verification after live fixes: `npx tsc --noEmit` PASS; focused
studio/presence/intent tests PASS; `npm run test:cloud` **704 / 704**
PASS (was 703); `npm run build` PASS (same Vite/`import.meta` warning).

Live-acceptance fixes on this same branch (not a redesign):

- Presence Build/Plan hydrates from persisted plans + `/api/jarvis/events`
  even when the tab is hidden; HUD z-index sits above WebGL.
- `software.applyBuild` no longer sends `slug` (schema allowlist is
  `brief|planId|goalId`). Confirm copy still names
  `data/jarvis/builds/<slug>/`.
- Write-code / `รัน test` route to `software.applyBuild` (`ASK_PERMISSION`)
  instead of generic conversation. `หาข้อมูล` / documentation uses
  `research.current` (`EXECUTE`).

LIVE evidence (session `jarvis-lab`):

- MODEL: `GET /api/jarvis/status` `llm.health=MODEL_READY`,
  `model=qwen38-cyber`, provider openai-compatible. No `reasoning_content`
  in visible turns or Obsidian.
- HISTORY: SQLite one completed row per visible turn; restart kept the
  conversation. 26 turns after J.
- MEMORY: `owner.pref.reply_style` =
  `ชอบให้ตอบสั้น ตรง และไม่อธิบายยาวเกินจำเป็น` in SQLite +
  `data/jarvis/obsidian/Memory/Owner.md`.
- BUILD: plan `plan_04d722f5-ba88-4351-9d7c-3d8bba355023` COMPLETED
  under `data/jarvis/builds/jarvis-portfolio-modern/` only after grant.
  Same-goal approval kept that planId. J1 created a second review plan
  `plan_d347908e-…` (Todo App) which was not granted.
- PERMISSION: THIS_GOAL proposal, WRITE_PROJECT + RUN_PROJECT_COMMANDS,
  no CLICK/TYPE/SUBMIT/UNRESTRICTED_SHELL/ADMIN/GLOBAL_FILESYSTEM.
  Overlay from HTTP-ask is session-local (`PARTIAL` vs in-page confirm).
- REFUSAL: J1 EXECUTE planBuild; J2/J3 ASK_PERMISSION applyBuild;
  J4 EXECUTE research.current. No generic REFUSE.

CLICK / TYPE / SUBMIT remain `PREPARE_CONTRACT`.

## Previous — Qwen runtime, conversation memory, permission-first build studio

Branch: `local/jarvis-qwen-memory-build-studio-v1-2026-08-22` from exact
perception HEAD `9c5605780124aaccf61d1f692b834bd5624ebcbb`.
Did not modify `main`. Did not push. Cursor remains the development agent;
the local Qwen coding worker was not substituted.

Verification: `npx tsc --noEmit` PASS; focused qwen/memory/build + previously
failing presentation/speech/cinematic tests PASS; `npm run test:cloud`
**703 / 703** PASS (was 695 on the source HEAD); `npm run build` PASS
(same Vite/`import.meta` warnings as before).

Architecture (see `docs/JARVIS_QWEN_MEMORY_BUILD_STUDIO.md`):

- Canonical **Jarvis** runtime is OpenAI-compatible llama.cpp
  `http://127.0.0.1:8086/v1` model alias `qwen38-cyber`, context 32768,
  max output 4096. Auth from `LOCAL_QWEN_API_KEY` /
  `JARVIS_QWEN_API_KEY` / `LLM_API_KEY`. Keys are never logged or stored.
- Discord/Digital Me `new LocalLlmProvider()` still defaults to Ollama
  `http://127.0.0.1:11434/v1` / `digital-me-qwen38:27b-ad-q4km`.
- Health is explicit (`MODEL_READY` / `OFFLINE` / `UNREACHABLE` /
  `NOT_FOUND` / `AUTH_FAILED`). Offline owner copy:
  `Qwen local ยังไม่พร้อม ผมยังไม่ได้เริ่มงานนี้`. No silent model switch.
- `reasoning_content` / `<think>` are stripped from visible answers,
  history, and Obsidian.
- SQLite schema v3: `conversation_sessions`, `conversation_turns`,
  `build_plans`. OWNER turn persists before work; JARVIS completes or
  stays `incomplete` after crash. Obsidian at `data/jarvis/obsidian/`
  is a rebuildable view (`OBSIDIAN != AUTHORITY`).
- ContextBuilder budgets **19000** dynamic tokens of the 32768 window.
- Permission-first outcomes: EXECUTE / ASK_PERMISSION / NEED_INPUT /
  REFUSE last. Goal-scoped leases. Presence card is short Thai +
  `[อนุญาตงานนี้] [ครั้งเดียว] [ไม่]`.
- Goals `BUILD_WEBSITE` / `BUILD_SOFTWARE` plan first (`software.planBuild`);
  files only after plan approval + ActionGate, under
  `data/jarvis/builds/<slug>/`. No unrestricted shell.
- `/jarvis` Presence adds Build/Plan surface, history HUD, Qwen status
  from real SSE events.

CLICK / TYPE / SUBMIT remain `PREPARE_CONTRACT`.

## Previous — Desktop perception and verified managed windows

Branch: `local/jarvis-desktop-perception-v1-2026-08-22` from exact
context-runtime HEAD `081dc82d8acbf358b91dd0095d8457fe8772695e`.
Remote checkpoint already on
`origin/local/jarvis-context-runtime-completion-2026-08-21` @ `081dc82`.
Did not modify `main`. Did not force-push.

Verification: `npx tsc --noEmit` PASS; focused desktop+semantic+context
PASS; `npm run test:cloud` **695 / 695** PASS (was 671);
`npm run build` PASS (same Vite/`import.meta` warnings as before).

Standalone live URL: `http://127.0.0.1:3010` (port 3000 left alone).

Architecture:

- Read-only `DesktopPerceptionProvider` / `WindowsDesktopPerception`
  enumerates displays, top-level windows, foreground, bounds, process,
  and overlap. No continuous screenshot capture. Cached host remains
  `jarvis-desktop-host-v3` (no per-action `Add-Type`).
- `WindowSnapshot` keeps only Windows-observable fields.
- `ManagedWindowRecord` binds a window Jarvis itself opened after
  pre/post discovery. Ambiguous identity returns
  `WINDOW_IDENTITY_AMBIGUOUS` and does not guess.
- Browser OPEN uses allowlisted Chrome/Edge with `--new-window`.
  Existing owner browser windows are not taken over when no new handle
  appears.
- PLACE requires a managed handle for Chrome/Edge. Success is
  `overlap >= 0.55` or (center inside and `overlap >= 0.35`).
  `previousDisplay` updates only after verified placement.
- FOCUS operates only a known managed handle. `SW_RESTORE` is used
  only when the window is iconic; otherwise `SW_SHOW`.
- Confirm `finishActionTurn` writes observed `displayId` /
  `displayFingerprint` into working context. `window:` result targets
  are a scope refinement, not `EFFECT_SCOPE_MISMATCH`.
- CLICK / TYPE / SUBMIT / screen-visual understanding stay
  `PREPARE_CONTRACT`.

Live A–I on this host (2 displays; cachedHost true):

| ID | Result | Honesty |
|---|---|---|
| A | **LIVE_VERIFIED** | DISPLAY1 notebook 1920×1200 at -3840,-6 `MONITOR\BOE0D5B\…\0002`; DISPLAY5 right/primary 1920×1080 at 0,0 `MONITOR\MSI3DA6\…\0004` |
| B | **LIVE_VERIFIED** | “notebook monitor” → BOE `display.fp` key `a4b2e67c0056` |
| C | **LIVE_VERIFIED** | Open Roblox → dedicated `1508918` “Home - Roblox”, notebook, overlap ~0.99. HANDLER_COMPLETE + WINDOW_VERIFIED + DISPLAY_VERIFIED. RESOURCE_URL_UNVERIFIED. Owner Chrome `133304` bounds unchanged |
| D | **LIVE_VERIFIED** | Same handle `1508918` moved to DISPLAY5, overlap ~0.98. Owner `133304` unchanged |
| E | **LIVE_VERIFIED** | Same handle `1508918` back on notebook, overlap ~0.99. `previousDisplay` used the verified right monitor |
| F | **LIVE_VERIFIED** | Distinct YouTube managed window `986218` on notebook. Roblox `1508918` untouched. Owner `133304` untouched |
| G | **HANDLER_COMPLETE / not LIVE_VERIFIED** | First pass: handle `1508918` identified, `FOCUS_UNVERIFIED`; `SW_RESTORE` shrank that window onto DISPLAY5. Retest after iconic-only restore: handler said FOCUS_VERIFIED for `2361430`, later snapshot could not find that handle. Do not claim foreground LIVE_VERIFIED |
| H | **WINDOW_VERIFIED / RESOURCE_URL_UNVERIFIED** | Live Qwen research completed (`docs.qwencloud.com`). Two official sources stayed `AMBIGUOUS_SOURCE`. “Open the QwenCloud source.” → dedicated `2427940` titled “Model releases - QwenCloud”. URL not independently read from Chrome |
| I | **WINDOW_VERIFIED / folder UNVERIFIED** | “Jarvis project” remembered as registered id, no raw path. Cursor window `1902488` title only `Cursor`. Application-level only |

Owner Chrome `133304` was not the placement target in C–F. A later
Roblox re-open changed its bounds transiently (Chrome window manager,
not `placeWindow`).

Four first-pass `EFFECT_SCOPE_MISMATCH` incidents (open/place/focus
reporting `window:{handle}`) were cleared one-by-one via inspect →
“clear this scope”. No global clear. Containment now treats discovered
`window:` handles as refinements of an in-scope URL/app.

Remaining before scoped CLICK/TYPE: reliable FOCUS read-back without
restoring/moving the window; independently readable URL/tab identity;
Cursor workspace-folder proof; no first-window fallback regressions.

## Previous — Context runtime completion

Branch: `local/jarvis-context-runtime-completion-2026-08-21` from semantic
checkpoint HEAD `18b40601433c8fbe14c2f0419a141ad02e057cb2`.
Did not modify `main`. Did not push this branch.

Verification: `npx tsc --noEmit` PASS; focused context+intent **50 / 50**
then context **30 / 30**; `npm run test:cloud` **671 / 671** PASS;
`npm run build` PASS (same Vite/`import.meta` warnings as before).

Standalone live URL: `http://127.0.0.1:3010/jarvis` (port 3000 left alone).

What this branch closed:

- Containment is scoped. No `clearAll`. Expected fail-closed place
  outcomes do not create incidents. Owner “Check it.” / “Yes.” clears
  only the pending incident after read-only reconcile
  (`KEEP_CONTAINED` / `CLEAR_THIS_SCOPE` / `ACCEPT_CURRENT_STATE` /
  `REVERIFY`). `ROLL_BACK` is not implemented.
- Display aliases persist as `display.fp:{…}` (path / name / size), not
  `display.internal`. Ordinal change does not remap. Missing hardware
  returns `KNOWN_ALIAS_TARGET_OFFLINE`.
- Fingerprints survive declared-goal bind and ActionGate last-mile
  alias application. Abstract `role: internal` is dropped when a
  fingerprint is present.
- Working context tracks window handle, current/previous display,
  research sources, and `it` / `there` / `back`. High-risk `it` expires
  in 2 minutes. Previous placement is working context, not owner facts.
- Research “that source” asks when two official sources exist. A unique
  host/label mention can open that source. Workspace paths come from
  the registry only.
- Desktop host C# is compiled once to `%TEMP%\jarvis-desktop-host-v2`.
  Place/open search Chrome then Edge in one PowerShell. Honest limit:
  this host’s default browser is Chrome; Jarvis cannot move a single
  tab.

Live A–K on this host (2 displays; no `Internal` flag):

| ID | Result | Note |
|---|---|---|
| A | **PASS** | Listed 2 displays: DISPLAY1 1920×1200 at -3840,-6 (BOE); DISPLAY5 1920×1080 at 0,0 primary (MSI) |
| B | **PASS** | “Monitor 1 is my notebook monitor.” → `display.fp` BOE path, not `display.internal` |
| C | **PASS** | Alias survived 3010 restart |
| D | **PASS (handler)** | Roblox official scoped open completed after allow-once. Not re-measured after later moves |
| E | **PASS (handler)** | `desktop.placeWindow` completed; trusted browser window, not a Roblox tab |
| F | **PARTIAL** | Handler completed with unverified placement. Post-hoc Chrome was still on DISPLAY5. **Not LIVE_VERIFIED** |
| G | **PASS (handler)** | “Open YouTube there too” routed to last display. Same Chrome process; tab vs window not proven |
| H | **PASS** | Live Qwen research completed; evidence included docs.qwencloud.com |
| I | **PASS** | “Which source is official?” asked; listed QwenCloud + NVIDIA PDF. Did not pick |
| J | **PASS (ask + named)** | “Open that source.” stayed `AMBIGUOUS_SOURCE`. “Open the qwencloud source.” → scoped confirm → handler completed. Window/URL not independently inspected |
| K | **PASS (handler)** | Remembered registry id, no raw path. “Open the project in Cursor.” completed. Folder not independently inspected |

Containment persist `data/jarvis/runtime/recovery/containment.json`:
five historical timeout incidents, all `active: false`. None currently
active. Root cause: place/open PowerShell `Add-Type` timeouts
(`MUTATION_OUTCOME_UNKNOWN`), then empty-target `blocks()` paralysis.

Owner alias in canonical SQLite:
`owner.alias.display.notebook_monitor` active → `display.fp` BOE
`MONITOR\BOE0D5B\…` 1920×1200. Prior `display.internal` is superseded.

Remaining gaps: verified “bring it back” bounds; distinct YouTube
window vs Chrome process; independent Cursor workspace-folder proof;
no `ROLL_BACK`; no click/type/submit.

## Previous — Semantic Intent & Conversational Memory v1

Branch: `local/jarvis-semantic-intent-memory-v1-2026-08-21` from exact V5 HEAD
`947d2b9a15e3c193509d16202938dd4aa2c23cbb`. Did not modify `main`.
Checkpointed on this branch:

- `f2cb004` feat(intent): semantic owner-intent + generic resource resolution
- `d132ed5` feat(memory): bounded conversational + owner semantic memory
- `14f57bf` feat(desktop): display aliases + scoped web resources
- `39e08f1` test(jarvis): semantic intent / context / memory invariants
- this docs commit records maturity and live evidence

Primary URL: `http://127.0.0.1:3000/jarvis`  
Ambient: `http://127.0.0.1:3000/jarvis?mode=ambient`  
Control Center: `http://127.0.0.1:3000/jarvis-lab`

Verification: `npx tsc --noEmit` PASS; focused semantic+V5+speech+intent **70 / 70**
then semantic **26 / 26**; `npm run test:cloud` **641 / 641** PASS; `npm run build`
PASS (same Vite/`import.meta` warnings as V5).

- SemanticIntent is language interpretation only. No brand `if (roblox)`.
- ResourceResolver uses `config/jarvis/web-resources.json` + apps/projects.
  Unknown official sites do not fabricate URLs.
- Non-allowlisted official HTTPS becomes `SCOPED_WEB_OPEN` confirm, not a
  dead-end deny. Session grant after a successful confirm is
  `ALLOW_THIS_DOMAIN_FOR_SESSION`. Permanent trust is still a separate
  owner decision.
- Notebook / laptop / จอโน้ตบุ๊ก resolve to `display.internal` when topology
  marks an internal display. This host did not expose `Internal`; Jarvis
  asked. Owner aliases persist in canonical SQLite facts
  (`owner.alias.display.*`) and survived a live server restart.
- `it` / `back` use InteractionContext. Place is not invoked until the
  referent is actually opened (`openState: intended | opened`).
- Web/tool text cannot write owner memory. Secrets are rejected.
- Existing V5 voice suite is preserved.

Live `/api/jarvis/ask` on this branch (server restarted from this tree):

- A `open roblox website in notebook monitor` → scoped confirm, official
  catalog URL, not “I don’t understand.” After owner-token confirm: open
  **completed**; placement asked because no built-in display evidence
  (`DISPLAY_AMBIGUOUS`).
- B/C `Move it` / `Bring it back` after that confirm resolved to
  `desktop.placeWindow` but were **denied**
  `FAILURE_CONTAINMENT_ACTIVE` (host containment already active / prior
  failed place). Not claimed as place LIVE_VERIFIED.
- D/E monitor alias teach + restart: “notebook monitor” still means
  `display.internal`.
- F mixed Thai/EN Roblox open → same scoped confirm.
- G click-first-game → Gap language, not “I don’t understand.”
- H research “that source” was **not** live-tested.

## Previous — Cinematic Presence v5 + Voice Command Intelligence

Branch: `local/jarvis-cinematic-presence-v5-2026-08-21` from exact
`bdd27eb1f7ee29c3c336788a85402e5c30a774f7` (v4 HEAD). Did not modify `main`.
Checkpointed on this branch.

Primary URL: `http://127.0.0.1:3000/jarvis`  
Ambient: `http://127.0.0.1:3000/jarvis?mode=ambient`  
Control Center: `http://127.0.0.1:3000/jarvis-lab`

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **OWNER_VISUAL_VERIFIED** and
**LIVE_VERIFIED** are not claimed. No live dashboard/TTS/desktop launch was run
this pass.

- Voice is an input method, not authority. Families are cue clusters, not a
  phrase switch. EN/TH equivalents map to the same structured goals.
- Scoped allowlisted OPEN + real monitor topology. Ambiguous geometry asks.
  YouTube allowlist is structured; other domains stay confirm/deny with reason.
- Speech policy is deterministic ALWAYS/OPTIONAL/SILENT. Speech controls never
  change capability authority. Cancel ≠ Emergency Stop.
- Visual: neural cognition + lightning tubes, richer cyan/indigo/violet,
  Thinking camera closer than Researching. Red remains emergency-only.
- Follow-up after explore: conversation `/ask-stream` now synthesizes before
  `final` and attaches `speech` to that payload; Presence/Lab/Operating also
  merge a later `speech` event. Thai `จอ` no longer steals Display Settings
  from “เปิด YouTube ที่จอ 2”.
- Verification: `npx tsc --noEmit` PASS; `npm run test:cloud` **614 / 614**
  before this follow-up; after stream/`จอ` fixes, focused suite
  `jarvis_cinematic_v5` + `jarvis_speech` + `jarvis_intent` + `jarvis_presence`
  **52 / 52**. `npm run build` PASS earlier (same Vite/`import.meta` warnings).

See `docs/JARVIS_CINEMATIC_PRESENCE.md`.

## Previous — Cinematic Presence v4

Branch: `local/jarvis-cinematic-presence-v4-2026-08-21` from exact
`8c938ae40fe3beeb87e6ba4d0bcba9bea9323f59`. Did not modify `main`.

Primary URL: `http://127.0.0.1:3000/jarvis`  
Ambient: `http://127.0.0.1:3000/jarvis?mode=ambient`  
Control Center: `http://127.0.0.1:3000/jarvis-lab`  
Replay: `http://127.0.0.1:3000/jarvis?visualReplay=1`  
Fixture example: `http://127.0.0.1:3000/jarvis?visualScene=research`

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **OWNER_VISUAL_VERIFIED** is not claimed.

- Full-viewport WebGL Core with energy shaders, 3-axis gyros, structured particles, and UnrealBloom.
- Research constellation, activity telemetry, and DEVELOPMENT REPLAY stay query-gated.
- Pointer hover/select is presentation only and cannot grant authority.

See `docs/JARVIS_CINEMATIC_PRESENCE.md`.

## Previous — Cinematic Presence visual system

Branch: `local/jarvis-cinematic-presence-v3-2026-08-21` from exact
`5315ebb0990d32ec40af2519e4eb16f75ff06eb7`. Did not modify `main`.

Primary URL: `http://127.0.0.1:3000/jarvis`  
Ambient: `http://127.0.0.1:3000/jarvis?mode=ambient`  
Control Center: `http://127.0.0.1:3000/jarvis-lab`  
Fixture example: `http://127.0.0.1:3000/jarvis?visualScene=research`

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **OWNER_VISUAL_VERIFIED** is not claimed.

- Structured Presence Core (nucleus/rings/nodes), not the lab particle field.
- Contextual HUD composition with permission and Emergency Stop override.
- Research stages mapped from existing SSE events; leftover sources stay off idle.
- Fixtures require `visualScene` and stay labelled DEVELOPMENT FIXTURE.

See `docs/JARVIS_CINEMATIC_PRESENCE.md`.

## This turn — Presence-first interface

Branch: `local/jarvis-presence-interface-2026-08-21` from exact
`a28265ffcbcf125feb4e6ac38182ddc41e48c86c`. Did not modify `main`.

Primary owner URL: `http://127.0.0.1:3000/jarvis`  
Control Center (preserved): `http://127.0.0.1:3000/jarvis-lab`

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **OWNER_VISUAL_VERIFIED** is not claimed.

- Presence is the default living assistant: Core, operational phase, voice/text, contextual HUD.
- `/jarvis-lab` is the advanced Control Center; Tasks/Security/System/Activity/Evolution remain.
- Yes/Allow Once binds one exact pending confirm or grant. Not a global approval.
- Ambient: `/jarvis?mode=ambient`. `Ctrl+.`. Open Control Center by speech or `Ctrl+Shift+L`.
- OPEN Cursor is allowlisted. SEE/CLICK/TYPE/SUBMIT and CCTV stay PREPARE_CONTRACT.
- Verification: `npx tsc --noEmit` PASS; `npm run test:cloud` **578 / 578**.

See `docs/JARVIS_PRESENCE_INTERFACE.md`.

## This turn — Local acceptance completion

Branch: `local/jarvis-acceptance-completion-2026-08-21` from exact
`0cd7b0da462ae0f5baf083c05db81ea9f94100c0`. Did not modify `main` or rewrite
the journal recovery branch.

Labels: **CODE_FIXED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (HTTP/SSE/goals).
**OWNER_VERIFIED** is not claimed. Dashboard:
`http://127.0.0.1:3000/jarvis-lab`.

- Self Knowledge: setup / unavailable / permission / gap / PowerShell questions
  now answer from Capability Intelligence evidence. Live HTTP confirmed both
  previously failing queries.
- Command Center presents `WAITING_PERMISSION` ahead of `WAITING_INPUT`.
- LA-019 HTTP live turns PASS. Public research executed via `research.current`
  (morning harness had `research: false`).
- LA-020 HTTP continuation + Allow Once via `/api/jarvis/command-center/grant`.
  Windows toast remains **BLOCKED**. Restart/expiry remain unit-only this pass.
- SSE: connect, increment, unique seq, 15s heartbeat, replay/redaction.
- WorldIntel: healthy + bounded `intel_status`. Unit tests keep `worldIntel: false`.
- Verification: `npx tsc --noEmit` PASS; `npm run test:cloud` **571 / 571**;
  `npm run build` PASS.

See `docs/JARVIS_LOCAL_ACCEPTANCE_2026-08-21.md`.

## This turn — Persistent execution journal recovery

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** for the reconstructed journal.
**OWNER_VERIFIED** / **LIVE_VERIFIED** are not claimed.

Starting checkout: `local/jarvis-acceptance-2026-08-20` at
`8aba6b019c436b1e636f32274607015a4dc23e38`, working tree clean. Path B: no
unpublished GPT Work journal existed locally. `origin/work/jarvis-pending-goal-continuation`
matched `38709c4ebe9e34c5aaa38b9cc93f902b75a1e407`. Created
`local/jarvis-journal-recovery-2026-08-21` from that exact SHA.

Local verification on this branch (2026-08-21, owner Windows):

- `npx tsc --noEmit` PASS
- `node --import tsx --test tests/jarvis_execution_journal.test.ts tests/jarvis_execution_recovery.test.ts` 28 then 29/29 after WorkAgent id sanitization
- `npm run test:cloud` **565 / 565 PASS** (previous published baseline was 545; this branch adds journal coverage)
- `npm run build` PASS (known Vite CoreScene chunk warning and esbuild `import.meta` CJS warning; not treated as failure)

Bugs found while verifying:

- `tests/jarvis_intent.test.ts` spawned live WorldIntel MCP from `createStandaloneCapabilityHost()` with default options, which kept the Node test worker alive and hung `npm run test:cloud` on Windows. Isolated the host with `worldIntel: false`.
- WorkAgent `requestId` values contain `:`, which failed journal schema validation and made reminder continuation `FAILED` instead of `COMPLETED`. Journal operation ids are now sanitized.

See `docs/JARVIS_EXECUTION_JOURNAL.md` and
`docs/JARVIS_LOCAL_ACCEPTANCE_2026-08-21.md`.

Local acceptance on this Windows machine used disposable fixtures only:

- LA-015 / LA-017 / Journal C: PASS via real temp-dir persistence (not HTTP UI)
- LA-001 hello / recursion / `สถานะระบบ`: PASS against local Ollama
- Research request routed RESEARCH/agentic but had no verified executable route in the harness
- Self-knowledge CCTV honesty PASS; setup-question classifier FAIL
- `/jarvis-lab` UI/SSE: NOT_RUN

`BLOCKED_LOCAL_ACCEPTANCE.md` is not upgraded to LIVE_VERIFIED for dashboard-complete procedures.

- Added `src/jarvis/executionJournal` with validated transitions, fingerprints,
  SQLite persistence, unique idempotency, checkpoint binding, and fail-closed
  corrupt-schema handling.
- Wired the journal through Trusted Operator, ActionGate, and the recovery
  sandbox. `CHECKPOINTED` no longer auto-mutates after restart.
- Rollback remains a separate journaled operation. Model identity cannot set
  journal state. Journal cannot grant permission or revive leases.

## This turn — Secure pending-goal continuation


Labels: **IMPLEMENTED** + **UNIT_VERIFIED** for cloud-safe declared-goal
continuation. **OWNER_VERIFIED** and live owner-machine/provider verification are
not claimed.

Branch: `work/jarvis-pending-goal-continuation` from exact remote source
`work/jarvis-goal-catalog-input-adapters` at
`a7a11f5e8cafe17f26d1cece7e6f6bb4bad99b03`.

- Added an expiring, scope/session-bound PendingGoal record and optional SQLite
  store. Persisted context is redacted and contains no permission, lease,
  confirmation, credential, or model authority.
- Added typed one-field continuation, cancellation, explicit revision, goal
  drift detection, multi-pending disambiguation, cross-session explicit
  selection, bounded receipt idempotency, and restart-safe context reload.
- WorkAgent now represents `WAITING_INPUT` and `EXPIRED`, preserves the same
  task, and rebuilds a current bounded plan without replaying mutations.
- Resume re-runs GoalCatalog/adapters, capability availability, Gap Resolver,
  Emergency Stop, ActionGate, permission, lease, containment, and verification
  boundaries. An in-process claim serializes concurrent duplicate resumes.
- Reminder creation now has a deterministic registered verifier that re-reads
  the isolated store. The tested continuation waits for Allow Once, creates one
  reminder, verifies its typed state, and does not duplicate on retry.
- Home and Task Center show the human waiting question; IDs, missing fields,
  adapter/route evidence, and expiry stay in Expert Details.

Verification: focused goal/continuation suite **39/39**;
`npx tsc --noEmit` PASS; `npm run test:cloud` **545/545**; production client and
server build PASS with the pre-existing CoreScene chunk and CJS `import.meta`
warnings. Windows, owner files, actual reminder delivery, browser visuals,
CCTV/RTSP/ONVIF, Ollama/GPU, phone/screen/voice, and Whonix remain
`BLOCKED_LOCAL_ACCEPTANCE`.

## This turn — Authoritative Goal Catalog and typed input adapters

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** for existing cloud-safe workflows.
**OWNER_VERIFIED** and live owner-machine/provider verification are not claimed.

Branch: `work/jarvis-goal-catalog-input-adapters` from exact remote source
`work/jarvis-capability-intelligence` at
`deab0bb96a02ab0465171221b97c0be0e8b58ca8`.

- Added one authoritative GoalCatalog for research, workspace, basic indexed
  documents, Jarvis/system health, reminder creation, capability Self Knowledge,
  gap explanation, and honest owner-only CCTV preparation.
- Added capability-bound trusted input adapters and JSON-schema validation.
  Adapters cannot add paths, credentials, capability IDs, permissions,
  confirmation, shell/command, risk, privilege, or admin authority.
- Intent resolution preserves existing fast-path behavior while attaching goal,
  route, typed input, rejected alternative, permission, and verification
  evidence. Unknown/ambiguous objectives do not become supported.
- WorkAgent consumes the declared route and can try a bounded compatible safe
  alternative. Higher-risk/private routes stop for owner decision.
- Goal outcome evidence is separate from capability competence. A failed first
  capability remains a failure even when an alternate route completes the goal.
- Self Knowledge and System/Task Center expose end-to-end goal readiness and
  adapter evidence with technical IDs under Expert Details.

Verification: focused goal/intent/capability/runtime suite **65/65**;
`npx tsc --noEmit` PASS; `npm run test:cloud` **517/517**; production client and
server build PASS with the pre-existing CoreScene chunk and CJS `import.meta`
warnings. Windows, owner filesystem, actual reminder delivery, Ollama/GPU,
browser visuals, CCTV/RTSP/ONVIF, phone/screen/voice, and Whonix remain
`BLOCKED_LOCAL_ACCEPTANCE`.

## This turn — Capability Intelligence and Self Knowledge

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** for cloud-safe Core paths.
**OWNER_VERIFIED** and live provider/hardware verification are not claimed.

Branch: `work/jarvis-capability-intelligence` from exact remote source
`work/jarvis-execution-recovery-hardening` at
`2d72ef59c95ac3b64a6fd30d7594ac66a783aac5`.

- Added evidence-backed Self Knowledge over the existing CapabilityHost,
  CapabilitySelfModel, model profiles/certifications, and provider/service state.
- Added Capability Graph, structured GapResolutionPlan, bounded WorkAgent
  blocker/replan integration, and human-readable Assistant/Task/System views.
- Competence now distinguishes verified and unverified success; repeated
  blockers produce weakness signals and Night Cycle requires VERIFIED success
  for skill distillation.
- Capability candidate lifecycle separates discover/review/test/security review/
  verify/owner approve/install/register/enable. It cannot self-promote.
- Prepared owner-only CCTV RTSP/ONVIF/vendor contracts with opaque local secret
  references, strict credential-bearing URL/path rejection, and no LAN scanning.
- Community Edition, setup/model installer, distribution filtering, real CCTV,
  and broad device control remain out of scope.

Verification: focused capability/evolution/WorkAgent/runtime suite **71/71**;
`npx tsc --noEmit` PASS; `npm run test:cloud` **506/506**; production build
PASS with the pre-existing large CoreScene chunk and CJS `import.meta` warnings.
Windows, CCTV/RTSP/ONVIF/NVR, owner LAN, Ollama/GPU, screen/phone, voice,
browser visuals, and Whonix remain `BLOCKED_LOCAL_ACCEPTANCE`.

## This turn — cloud finalization wiring (memory, stream, depth, night resume, grant)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **LIVE_VERIFIED** not claimed. Hardware/browser/Ollama remain **BLOCKED_LOCAL_ACCEPTANCE**. No merge to main. No Discord features. No secrets committed.

Branch: `cursor/jarvis-cloud-finalization-4838` from `6ba63bd` (`cursor/jarvis-runtime-integration-4838`).

Follow-up after the ask-router / ActionGate pass (`8945da3`):

- Experience writes validate actor + secrets + Discord social filter **before** idempotent id reuse. Duplicate `exp_task_*` ids cannot smuggle `DISCORD_TOKEN=…` or webpage actors.
- Default lab memory store attaches to Command Center so a real WorkAgent outcome writes one canonical `jarvis.db` episode (`trustedSemanticWrite: false`).
- `askStream` uses the same typed router as `ask` (research/work no longer fall through to LLM-only).
- Owner `researchDepth` is forwarded into `research.search` / `research.current`. Depth `none` performs no web fetch.
- Night Cycle `run()` continues from the paused stage; HTTP accepts `action: resume`.
- Command Center client snapshot now includes `permission.taskId/stepId/proposalId` and registry-only model-adaptation counts. Grant once posts those ids. SSE skips `seq <= lastSeq`.
- Affect may suppress casual slang when formal; it cannot authorize and cannot drop immutable facts.

Verification this turn: targeted suite **119/119**; `npx tsc --noEmit` PASS; `npm run test:cloud` **457/457**. Browser visual QA not run (no browser MCP).

## Previous — cloud finalization (ask router, ActionGate handshake, one evolution loop)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **LIVE_VERIFIED** not claimed.

- P0 router: `routeJarvisRequest` → CONVERSATION / INFORMATION / RESEARCH / WORK / CAPABILITY with IGNORE/REACT/SPEAK. `hello` / `how are you?` / `explain recursion` stay off WorkAgent. Research/work/unbound capability go through `/api/jarvis/ask` → WorkAgent.
- P0 permission: `grantPermission` no longer marks gated steps done. Owner lease is bound to task/step/capability/scope/risk/expiry. Same step resumes through CapabilityHost. Jarvis/system cannot self-approve. Tokens are stripped from `work.db`. Denial stays denied.
- P0 synthesis + evolution: user-facing SUCCESS/PARTIAL/BLOCKED/FAILED/CANCELLED/DEGRADED. One experience id `exp_task_<taskId>`. Duplicate observers are no-ops. Failure still cannot mint a trusted skill.
- P0 memory: optional canonical episode write via `writeExperienceEpisode`. Research/untrusted tool output cannot become owner-trusted semantic memory.
- P1: failure-adaptive retry bounds, trusted-only skill retrieval, night BENCHMARK stage, Command Center route/permission/benchmarks/honest empty Fluctlight, affect style metadata only.
- P2: vision health + SEE≠CLICK, monitor simulation helper, VIEW≠CONFIGURE preserved. Authoritative queue: `BLOCKED_LOCAL_ACCEPTANCE.md` LA-001–LA-013.

## Previous — runtime integration (CapabilityHost, persistence, night cycle)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **LIVE_VERIFIED** not claimed. Hardware paths remain **BLOCKED_LOCAL_ACCEPTANCE**. No merge to main. No Discord features. No secrets committed.

Branch: `cursor/jarvis-runtime-integration-4838` from `e9403bb`.

Maturity audit (code, not class-exists):

- JF-014.6: FUNCTIONAL_CORE. Event bus + SSE replay exist. Browser SSE QA still **BLOCKED_LOCAL_ACCEPTANCE**.
- JF-015: INTEGRATED + UNIT_VERIFIED. `createCapabilityWorkInvoker` calls CapabilityHost. Isolated `work.db`. Restart/resume tested. Unrestricted shell denied.
- EVO-001–010: INTEGRATED + UNIT_VERIFIED for the outcome → experience → reflection → candidate path. Durable `evolution.db`. Night cycle writes reflections and success-only skill candidates. Still no auto-promote. Affect cannot authorize.
- JF-016/017/018: SIMULATION_ONLY + **BLOCKED_LOCAL_ACCEPTANCE**.
- Command Center: FUNCTIONAL_CORE. Real `runObjective` / night endpoints + lab host attach. Simulation stays labeled. Not **OWNER_VERIFIED**. No browser MCP in this cloud.

Verification this turn: targeted integration tests **9/9**; work/evolution/command-center/lab-ui/night **50/50**; `npx tsc --noEmit` PASS; `npm run test:cloud` **436/436**. The two prior Night Agent Linux failures are classified TEST_PORTABILITY_BUG and fixed without weakening assertions (`path.win32` for Windows fixtures; Cursor launch accepts `node` or `node.exe`).

## Previous — cloud-safe Jarvis roadmap (JF-014.6 / JF-015 / EVO / Command Center)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **LIVE_VERIFIED** not claimed. Hardware paths are **BLOCKED_LOCAL_ACCEPTANCE**. No merge to main. No Discord features. No secrets committed.

The previous cloud pass wrote work-agent / evolution / ops libraries and then stopped before SSE APIs, lab UI wiring, docs, commit, and PR. This turn finished that wiring.

- JF-014.6: event `id`/`seq`, bounded buffer, SSE `id:` + `after=`/`Last-Event-ID` replay, heartbeat comments, visual-state mapping. `/jarvis-lab` EventSource reconnects. Browser SSE QA not run in cloud.
- JF-015: DAG work agent with cancel/pause/resume, permission wait, stale-terminal write guard, simulated demos via `CommandCenterRuntime`.
- EVO-001–010: claims, retrieval rank, structured reflection (failure cannot mint trusted skills), skill lifecycle, failure ledger, self-model `INSUFFICIENT DATA` until n≥3, growth planner cap 3, practice/benchmarks, night cycle pause on `realtime_voice`, affect cannot authorize, identity overlay, journal, candidate manager (no auto-promote), LoRA registry only (`trained: false`).
- JF-016/017/018: simulated vision (see ≠ click/type/submit), proactive monitor, VIEW-only devices, owner autonomy 0–5 (Jarvis cannot raise max).
- Lab: `/api/jarvis/command-center` GET + demo/control/cancel/grant POSTs (loopback + mutation guard). Simulation banner, live ops steps, evolution rail, source graph, devices.
- Verification this turn: targeted Jarvis tests **48/48** pass; `npx tsc --noEmit` PASS; `npm run test:cloud` **425/427** pass. The two failures are pre-existing `night_agent_grok_only` Windows-path assertions on Linux (`path.basename` of `C:\\...` and `node.exe` vs `node`). Not claimed as this change. Browser SSE / Ollama / Whonix / mic / CCTV remain **BLOCKED_LOCAL_ACCEPTANCE**.

## This turn — cloud-safe Jarvis checkpoint for Cursor Cloud Agents

Labels: **OFFLINE_VERIFIED** for a dedicated checkpoint branch. No merge, no PR into main, no reset/clean, no push to `main`/`master` or `feature/jarvis-platform-contracts`.

- Original local branch was `feature/jarvis-platform-contracts` at `3d32cb4`. Created `cloud/jarvis-checkpoint-2026-08-19` without discarding the dirty tree.
- Remote is GitHub `https://github.com/eikq/DiscordBOT.git`. Cursor Cloud Agents can use this when the owner’s GitHub account is connected.
- Cloud prep: `.cursor/environment.json` + Debian `node:22-bookworm` Dockerfile (no project COPY, no secrets), `npm run test:cloud`, AGENTS.md §13. Windows/VBox/Whonix stay mockable or fail-closed.
- Deliberately excluded: `.env`, `.runtime/` (OVA, Gitleaks binary, screenshots), VirtualBox VM disks, `data/brain|memory|jarvis|voice*`, `night-agent.config.json`, cookies/browser auth, root PNG/ZIP/PDF dumps, `.cursor/mcp.json`.
- Gitleaks v8.30.1 is re-run on the working tree, staged files, and git history before push. Findings that are confirmed test fixtures/placeholders are documented in the owner report. Any possible real credential stops the push.

## Previous — Whonix black-screen diagnosis (NEM / dual-start)

Labels: **LIVE_VERIFIED** for Gateway-alone desktop after dual-start hang. **LIVE_TESTED** not claimed for Tor or PRIVATE_BROWSER. Workstation not restarted. No VBS/HVCI change. No graphics/firmware/network change. No commit/push/reset/clean.

- Both VMs used NEM snail mode: `HM: Attempting fall back to NEM: VT-x is not available` and `NEMR3Init: Snail execution mode is active!`
- Dual-start hang: kernel reached GIM/KVM (~20s) then stalled. Gateway NAT `e1000#0` RX/TX stayed **0 bytes**. ACPI ignored. Guest Additions runlevel 0.
- Official match: Whonix forum 23292 + Kicksecure Green Turtle (`only launch 1 VM at a time` while keeping VBS).
- After Workstation hard power-off + Gateway restart **alone**: LXQt desktop visible; `updatecheck` 48 packages; VBoxService 7.2.12; NAT RX ~22 MB / TX ~1.8 MB. Workstation left off.
- PRIVATE_BROWSER: `available=false`, `Workstation=down`.

## Previous — official Whonix import + fail-closed live health

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** (security tests **20/20**, `tsc --noEmit` PASS). Host VirtualBox/Whonix import is **OFFLINE_VERIFIED** (hash + OpenPGP + NIC/isolation). Live Tor / guest Playwright are **not** LIVE_TESTED. First-boot legal/security acknowledgement is **OWNER_ACTION_REQUIRED**. Encryption unchanged. No BitLocker/Device Encryption enable. No Windows security weakening. No UAC bypass. No owner Chrome/Edge. No commit, push, reset, or clean.

- `VBoxManage --version` = `7.2.16r174877`. Existing VMs before import: none.
- Official OVA already on disk (2,791,580,160 bytes). SHA512 matched official sums. Official signing key fingerprint `916B 8D99 C38E AF5E 8ADC 7A2A 8D66 066A 2EEA CCDA`. `gpg --verify` = Good signature on OVA and sha512sums; `file@name` notations match. Signify not installed on Windows; OVA OpenPGP is the stronger official check.
- Imported only `Whonix-Gateway-LXQt` + `Whonix-Workstation-LXQt`. Official NICs preserved: Gateway NAT+Internal `Whonix`; Workstation Internal `Whonix` only.
- Isolation applied: clipboard/DnD off, shared folders none, USB controllers off, mic/capture off, host camera not attached.
- Started Gateway, then Workstation (`--type gui`). VBox `screenshotpng` stayed black (VMSVGA). Gateway CPU ~8% — likely sitting at a guest first-boot dialog. I did not send keys or accept any guest legal text.
- Live host health: `virtualBox/gateway/workstation=up`, `isolationOk=true`, `tor=unknown`, `available=false`, `LIVE_TOR_CHECK_REQUIRED`.
- Health checker now inspects Workstation NICs by default (VirtualBox 7.2 `Attachment:` format + machinereadable `nicN=`), finds `VBoxManage` under Program Files, and will not set `available=true` without a live Tor check.

## Previous — security-first continuation (JF-014.5 / 014.55 / 014.6)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** for privilege leases, fail-closed PRIVATE_BROWSER policy, SSRF/injection, telemetry bus, evolution primitives. **LIVE_TESTED** not claimed for VirtualBox/Whonix/Playwright guest. Encryption classified **UNKNOWN** (WMI/`manage-bde` unavailable); **not** enabled or modified. No commit, push, reset, or clean.

- Owner override: do not enable BitLocker/Device Encryption. Host protections stay on. No UAC bypass.
- Official versions (2026-08-19): VirtualBox **7.2.16-174877** from virtualbox.org; Whonix **LXQt 18.2.1.9 Intel/AMD64** from download.whonix.org (wiki short OVA name 404s); Playwright via official npm, worker only in Whonix; Gitleaks **8.30.1** official GitHub zip.
- Detected: Node v22.23.2; VirtualBox **missing**; Whonix **missing**; Playwright **not a repo dependency**; Gitleaks **missing**; session is **standard user** (Medium IL).
- Host registry (read-only): Firewall ON; UAC ON; Tamper Protection ON; HVCI ON; VBS ON; Secure Boot ON; Defender not disabled. PassiveMode=2 reported, not changed.
- New code: `src/jarvis/security/*`, `src/jarvis/research/private/*`, `src/jarvis/evolution/*`, worker package, provision scripts, lab `/api/jarvis/events|security|private-research`.
- Docs: host/privilege/Whonix/private-research/browser/threat/telemetry/evolution + `JARVIS_SECURITY_STATUS.md` / `JARVIS_MASTER_STATUS.md` + ADR-021.

## This turn — JF-014 safe local workspace intelligence

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (in-process real `jarvis-project` A–F, H, I). **HUMAN_QUALITY_VERIFIED** not claimed. 27B was not required for deterministic search/symbol/compare. HTTP Command Center Workspace rail was not separately live-QA'd this turn. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center redesign. JF-010/011/012/013/013.5 authority unchanged. JF-SKILLS-001 still `scriptsAllowed=false`. Historical CCTV id remains `JF-014-CCTV`.

- Host-owned `config/jarvis/workspaces.json` → `jarvis-project`. Model authority is `workspaceId` / `documentId` / query. Argument `path` stays forbidden.
- PathPolicy fail-closed: absolute, `..`, UNC, ADS, drive switch, symlink/junction escape, `.env`, credentials, operational DBs, `data/**`.
- Isolated index `data/jarvis/workspace/workspace.db` (FTS5 + symbols). Incremental mtime/size/hash. First live index **945–1036ms / 356 files** after wrapping refresh in a SQLite transaction (was ~72s without it). Symbol lookup **20–22ms**.
- READ_ONLY capabilities: list/search/get/excerpt/findSymbol/compare/metadata/current/refreshIndex. No write/delete/rename/exec/readPath. `workspace.openDocument` skipped.
- JF-013.5: “หาไฟล์ memory”, “CapabilityHost อยู่ตรงไหน” resolve to workspace. “read credentials” stays conversation. “อ่าน .env” / absolute hosts stay forbidden. “แก้ PROJECT_CONTEXT.md” unsupported.
- Interaction context: เปิดอันแรก / สรุปไฟล์นี้ / hybrid web. Local `documentRefs` ≠ web `sourceRefs`. Document text is data; injection fixture cannot invoke tools or write memory.
- Lab: compact Workspace block after Sources; excerpts as text; refresh `{ workspaceId }` only; `GET /api/jarvis/workspace` rejects `?path`.
- Tests: `jarvis_workspace` **21/21**; JF-010–014 set **157/157**; full `tests/*.test.ts` **379/379**; Python 35 ran / 8 skipped; `tsc --noEmit` PASS; `npm run build` PASS (existing `import.meta` warning).
- Docs: `docs/JF014_SAFE_LOCAL_WORKSPACE.md`, ADR-020.

## This turn — JF-013.5 natural intent + conversational recovery

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (in-process `createJarvisLabRuntime` A–J on this machine). **HUMAN_QUALITY_VERIFIED** not claimed. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center redesign. JF-010/011/012/013 authority unchanged. JF-SKILLS-001 still `scriptsAllowed=false`. JF-014 not started.

- Root cause: unmatched natural Thai/English fell through to Qwen, which refused to invent tools (“ไม่มีสิทธิ์ / I cannot access”) even when a registered capability existed. Leftover noise (`ช่วย`, `ให้หน่อย`) also kept `consumed=false`. Any PowerShell mention was treated as `BLOCKED_SHELL`.
- New `src/jarvis/intent/*`: classify → fast path → context/heuristic → optional catalog-only semantic JSON → conversation. Schema rejects unknown ids/fields and permission/executable keys. Interaction context is 10-minute TTL, not personal memory.
- Fast paths kept. Talk-about ≠ request. Clarification/unsupported/unavailable/forbidden stay distinct. Spotify-not-installed offers web alternative without auto-open. YouTube uses `desktop.openTrustedUrl` + JF-010 confirm.
- Live A–J in-process, then HTTP on restarted `http://127.0.0.1:3010` (`JARVIS_STANDALONE=1`): YouTube `confirmation_required` (not opened); RTX/NVIDIA research completed; ASR health then “รีสตาร์ตมัน” → confirm `qwen-asr` (not executed); Spotify vague → clarification; `เปิด Spotify` → `NOT_INSTALLED` + web offer; “PowerShell คืออะไร” → Qwen explanation (~11.8s), not blocked; “รัน PowerShell” → `BLOCKED_SHELL`; “ช่วยทำหน่อย” → ask-what-task.
- Tests: `jarvis_intent` **20/20**; JF-010–013 + skills/core set **149/149**; full `tests/*.test.ts` **357/357**; `tsc --noEmit` PASS; `npm run build` PASS (existing `import.meta` warning).
- Docs: `docs/JF013_5_INTENT_RESOLUTION.md`, ADR-019.

## This turn — JF-013 safe web research + source intelligence

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (in-process public HTTP + lab `/api/jarvis/ask` A–F + Command Center Sources rail). **HUMAN_QUALITY_VERIFIED** not claimed. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center visual redesign. JF-010/011/012 left intact. JF-SKILLS-001 still `scriptsAllowed=false`. Historical proactive-events id remains `JF-013-PROACTIVE`.

- Extends CapabilityHost; does not replace Discord `ResearchAssistant` / world-intel MCP. New `src/jarvis/research/*` with `research.search|fetchSource|getSource|compareSources|current` (READ_ONLY).
- SSRF: http(s) public only; localhost/127/::1/RFC1918/link-local/metadata/file/javascript/data/credentials blocked; redirects re-validated. Schema rejects `method|headers|body|cookie`. GET only. No JS. PDF → `UNSUPPORTED_CONTENT_TYPE`.
- Store: `data/jarvis/research/research.db` (`node:sqlite`). Refuses `jarvis.db` / `automation.db` / `data/brain`. Research does not write canonical memory. “ค้นทุกชั่วโมง” → `SCHEDULED_RESEARCH_UNSUPPORTED`.
- Citations lifted into `verifiedFacts` with `immutableForPresentation: true`. Webpage text is data (`untrustedOutput`).
- Live lab on `http://127.0.0.1:3010` (`JARVIS_STANDALONE=1`): RTX 5090 → 6 sources / 11 evidence / nvidia.com OFFICIAL first (19.1s uncached); official-only 3 NVIDIA hosts; compare-last 4 sources (561ms); freshness 18ms published-unknown vs fetched; w3.org PDF unsupported; `http://127.0.0.1:3010` denied `BLOCKED_LOOPBACK` before fetch; `สวัสดีครับ` 860ms no research action. UI: SEARCH/FETCH/COMPARE/SYNTHESIS + nvidia.com source chips + inspector URL (no page execution).
- Live bugs found and fixed: `facebook.com` was treated as IPv6 (`fc` prefix); WordPress matched `/press/` as OFFICIAL; “เทียบข้อมูลจากหลายแหล่ง” searched leftover topic instead of last session. Body cap raised to 2.5MB after Wikipedia/NVIDIA HTML exceeded 400KB.
- Tests: `jarvis_research` **20/20**; with JF-010/011/012 **116/116**; full `tests/*.test.ts` **338/338**; Python 35 ran / 8 skipped; `tsc --noEmit` PASS; `npm run build` PASS (existing esbuild `import.meta` warning).
- Docs: `docs/JF013_SAFE_WEB_RESEARCH.md`, ADR-018.

## This turn — JF-012 reminders + scheduler / automation kernel

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (in-process A–G + lab HTTP/UI). **HUMAN_QUALITY_VERIFIED** not claimed. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center visual redesign. JF-010/011 left intact. Historical queue id “JF-012 Qdrant” remains FUTURE as `JF-012-QDRANT`.

- Dedicated operational SQLite `data/jarvis/automation.db` (not `jarvis.db`, not Night Agent). Timezone `Asia/Bangkok` persisted. Occurrence uniqueness `reminderId + scheduledAt` in `BEGIN IMMEDIATE`.
- Thai/English parser; bare hour → `AMBIGUOUS_TIME`; past one-time → `PAST_TIME`. Recurring downtime skips backlog.
- Capabilities `reminders.*` through ActionGate. Reminder text is data. `อีก 1 นาทีรัน cmd.exe` → `SCHEDULED_ACTION_UNSUPPORTED`. Skills still `scriptsAllowed=false`.
- Lab: right-rail Reminders + due card (Done / Dismiss / Snooze 10m). `GET /api/jarvis/reminders`, `POST /api/jarvis/reminders/ack` with JF-011 mutation guard. Cross-origin ack → 403 `INVALID_ORIGIN`.
- In-process live (real clock): A 45s fire skew **69ms**, create **7ms**; B recover+fire once; C daily 20:00 next `2026-08-19T13:00:00.000Z`; D list **2ms**; E cancel; F pause/resume; G 0 launches.
- Lab live on `http://127.0.0.1:3010` (`JARVIS_STANDALONE=1`): 70s reminder survived process restart and fired `on_time` at 17:37; 45s “เช็ก Jarvis” fired; due card + rail `scheduler healthy · next 08:00 PM`; TTS offline, notification still delivered. Live leftovers cancelled.
- Live bugs found and fixed (unit-tested): create phrase containing `ยกเลิก` was stolen as cancel; English daypart `night` ate “Night Agent” titles.
- Tests: `jarvis_reminders` **46/46**; with JF-010/011 **96/96**; `jarvis_*` files 240 tests included in full suite; full `tests/*.test.ts` **318/318**; Python 35 ran / 8 skipped; `tsc --noEmit` PASS; `npm run build` PASS (existing esbuild `import.meta` warning).
- Docs: `docs/JF012_REMINDERS_SCHEDULER.md`, ADR-017.

## This turn — JF-011 runtime + system capability pack

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (in-process A–J). **HUMAN_QUALITY_VERIFIED** not claimed. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center visual redesign. JF-010 left intact.

- Loopback mutation guard: Host, Origin/Referer, `Sec-Fetch-Site: cross-site`, `application/json`, 16 KB body, no confirm tokens in query. `JARVIS_STANDALONE=1` refuses `0.0.0.0`.
- Registry (ids only): `ollama`, `qwen-asr`, `jarvis-tts`, `rvc`, health-only `embedding` + `jarvis-lab`. Stop/restart confirm. Owned-child stop only (`NOT_OWNED` otherwise). No generic PID/process API.
- Read-only: runtime/system/battery/network/allowlisted apps. Battery on this machine: WMIC missing → honest `unavailable`.
- Live: Qwen healthy; ASR/TTS/RVC/embeddings offline; Chrome installed; Bluetooth settings opened; start ollama → `ALREADY_RUNNING` (2ms); stop/restart → confirmation, not executed; `chrome.exe` / `cmd.exe` blocked.
- Fast path: runtimeStatus 29ms; start already-running 2ms; no 27B wake.
- Tests: `jarvis_actions` 28/28; `jarvis_runtime` 22/22; `jarvis_*` 194/194; full `tests/*.test.ts` 272/272; Python 35 ran / 8 skipped; `tsc --noEmit` PASS; `npm run build` PASS.
- Docs: `docs/JF011_RUNTIME_SYSTEM_CAPABILITIES.md`, ADR-016.
- Skills still instruction/reference only (`scriptsAllowed=false`).

## This turn — JF-010 safe permissions + actions

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (safe lab A–F after Thai-intent fix + server restart). **HUMAN_QUALITY_VERIFIED** not claimed. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center visual redesign.

- Deterministic `ActionGate` + `PermissionPolicy` wrap the standalone CapabilityHost. The LLM never receives a shell.
- Capabilities: `desktop.openApplication`, `desktop.openProject`, `desktop.openTrustedUrl`, `system.status`.
- Confirmation tokens are proposal-bound, hashed, one-use, 120s TTL. UI: Deny / Allow once. Live reuse of the same token returned `CONFIRMATION_REUSED` and did not execute again.
- Thai intent uses `includes()` for Thai verbs (`เปิด`, `สถานะระบบ`); JS `\b` is Latin-only and missed those phrases before the fix.
- Audit JSONL at `data/jarvis/audit/actions.jsonl` (no tokens, prompts, or executable paths).
- Skills still cannot execute scripts or elevate permission. Persona cannot mutate `ActionResult`.
- Live A–F on `http://127.0.0.1:3010` (`JARVIS_STANDALONE=1`): status completed; Notepad launched; Spotify `NOT_INSTALLED`; PowerShell `BLOCKED_SHELL`; `javascript:` `BLOCKED_URL_SCHEME`; `https://example.com` required Allow once then completed.
- Tests: `tests/jarvis_actions.test.ts` **28/28**. `tests/jarvis_*.test.ts` **172/172**. Full `tests/*.test.ts` **250/250**. Python 35 ran / 8 skipped. `tsc --noEmit` PASS. `npm run build` PASS (existing esbuild `import.meta` warning).
- Docs: `docs/JF010_SAFE_ACTIONS.md`, ADR-015.

## This turn — visual course correction (owner rejected Blender-heavy iris)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (1920×1080 A/B/FINAL screenshots). **HUMAN_QUALITY_VERIFIED** still pending owner sign-off. Visual-only. No commit, push, reset, or clean. JF-SKILLS-001 / Core contracts / memory semantics / skills were not touched.

- Rejected silhouette causes: HUD/cage/radial GLBs are full rings (~14–17 unit radius) around the origin; additive hologram materials stacked to white posts; a bright inner nucleus + oval wash read as a white eye/pupil.
- Correction: keep the GLB pipeline, but present Blender as sparse off-core fragments (scanner upper-left, HUD lower-right, cage rear, radial front-left) with **NormalBlending**; Core scale 1.52; broken procedural orbits; 6 offset cyan cognition clusters; inner white seed/pupil mesh removed.
- Screenshot sequence at 1920×1080, rails open: `.runtime/COURSE_CORRECTION_BEFORE.png` (rejected), `COURSE_CORRECTION_A.png` (stale Vite — nearly identical to BEFORE; not used as the correction), `COURSE_CORRECTION_B.png` (first real correction after Vite restart), `COURSE_CORRECTION_FINAL.png` (brighter organic volume, still 0 center white pixels vs BEFORE 359).
- Pixel evidence FINAL vs BEFORE: mean channel-sum diff 74.84, 52% sampled pixels changed; center RGB 11,36,52 vs 77,116,135; white-hot center samples 0/17956 vs 359/17956.
- Targeted tests: `npx tsx --test tests/jarvis_lab_scene.test.ts tests/jarvis_lab_graph.test.ts` **19/19**. Screenshot FPS remains ~143 in the live GPU tab path; headless capture is not performance evidence.
- Dev server: `http://127.0.0.1:3010/jarvis-lab` (`JARVIS_STANDALONE=1`). Vite required a process restart to pick up CoreScene transforms (Windows watch cache).

## This turn — Master Prompt continuation (skills, Blender GLB, 1920 QA, regression)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (1920×1080 composition screenshots + GPU FPS). **HUMAN_QUALITY_VERIFIED** still pending owner sign-off. No commit, push, reset, or clean.

- Original Definition of Done re-audited against repo/runtime/MCP evidence (PASS/PARTIAL/NOT DONE/BLOCKED in the owner report).
- Curated Cursor skills verified with `npx.cmd skills list --json` (project scope, `.agents/skills/` copies). Custom `.cursor/skills/{jarvis-first-invariants,jarvis-lab-visual-qa,jarvis-night-agent-safety}` do not replace that phase.
- Community Three.js/R3F audit: OpenAEC/Impertio-Studio MIT LICENSE confirmed on `master`; `threejs-impl-react-three-fiber` + `threejs-errors-performance` installed as REVIEWED_COMMUNITY. EnzeD/r3f-skills and CloudAI-X remain not installed.
- Live Blender MCP scene `assets/jarvis/blender/source/jarvis_command_center_mcp.blend`: volumetric posts/fins/clamps added; four GLBs re-exported and loaded by `CoreScene.tsx` via `GLTFLoader` (also hashed into `dist/assets/*.glb` by `npm run build`).
- 1920×1080 three-pass screenshots (distinct files): `.runtime/jarvis-master-pass-a.png`, `pass-b.png`, `pass-c.png`. Headless Edge reports ~1 FPS and is not performance evidence. Cursor GPU tab at quality high: **144 fps** (`innerWidth` 1078 collapsed rails; 1920 shots have rails open).
- Idle SQLite graph remains **2 nodes / 1 real edge** (`entity:sys` → `fact:architecture.memory_backend`); layout now uses a tight halo. No fabricated edges.
- JF-SKILLS-001 still instruction/reference only. No JF-010. `tests/jarvis_skills.test.ts` 14 safety tests included in full TS suite.
- Verification this turn: `npx tsx --test tests/*.test.ts` **221/221**; `python -m unittest discover -s tests -p test_*.py` **35 ran, 8 skipped, OK**; `npx tsc --noEmit` PASS; `npm run build` PASS (GLBs in dist). Existing esbuild `import.meta` warning unchanged.
- Dev server: `http://127.0.0.1:3010/jarvis-lab` (`JARVIS_STANDALONE=1`).

## This turn — reference HUD alignment + JF-SKILLS-001

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE browser QA** (owner visual sign-off still pending). No commit/push. Dirty/untracked owner files were left in place.

- Applied the owner's four cinematic HUD references as visual language only (no Stark/SAO branding): cyan core light, sparse magenta HUD accents, dark navy grid, glass rails, trapezoid stage frame, scanline vignette.
- 3D Core remains the hero: closer default camera, magenta spark particles, quieter rings, brighter idle nucleus. Architecture, graph system, and Core contracts were not rewritten.
- Live QA at `http://127.0.0.1:3010/jarvis-lab`: WebGL canvas mounted (no 2D fallback), Auto/High **~144 FPS**, IDLE status readable, Persona/Voice still independent. Headless Edge screenshots report 0 FPS and are not used as performance evidence.
- JF-SKILLS-001: instruction/reference-only Jarvis skill runtime (`src/jarvis/skills/*`) with allowlist, path/symlink rejection, no script execution, host-policy wrapper, Core `skillRefs` provenance. Lab attaches it via `attachDefaultSkills`. Default skills: `jarvis-memory-safety`, `jarvis-runtime-qa`.
- Project Cursor skills (no scripts): `.cursor/skills/jarvis-first-invariants`, `jarvis-lab-visual-qa`, `jarvis-night-agent-safety`.
- Verification: targeted TS tests **69/69** plus `jarvis_first` Discord-free walk including `src/jarvis/skills`; `npx tsc --noEmit` PASS. Skill runtime has no `child_process`/`eval` and does not import Discord.

## This turn — UI-R9 focused visual refinement

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE browser QA**. Architecture was owner-accepted before this pass; final owner visual acceptance is still pending.

- Preserved the existing frontend architecture, Jarvis Core, memory graph adapter/layout, state/data APIs, and all current lab controls.
- Reworked only the WebGL presentation: layered seed/inner shell/plasma shell/particle volume/transparent cognition shell, interior-biased particles, shorter and substantially fewer depth-faded neural filaments, moving energy bands, and restrained local flashes.
- Increased default Core dominance through luminance layering and a closer default camera while keeping its geometry/state contract unchanged; the compact camera now pulls back/raises the Core so the state HUD remains below the nucleus on narrow screens.
- Rebuilt orbit appearance as broken instrument arcs with varied opacity, instanced ticks, radial marks, and counter-moving indicators; inactive tool labels now reveal only on hover/activity/failure.
- Reduced graph noise: default labels require importance, selection, or search; inactive edges/nodes recede while selected/path relationships brighten.
- Added selective sprite glow only to the nucleus, selected graph node, active tool nodes, and real transient streams; no full-screen bloom/postprocess was added.
- Added fog, near/far dust, depth fading, stage vignette, richer translucent panel materials, and a clean `IDLE` / `Awaiting a request` Core HUD.
- Refined observable state motion: quieter idle/listening, stronger thinking contraction/turbulence, memory/tool event emphasis, layered response/speech pulses, and subtle violet Night Agent mode.
- Browser QA completed as three screenshot passes: A (Core volume/depth), B (graph noise/orbit machinery), C (lighting/panels/spacing/composition), plus narrow-view correction. A redundant oversized nucleus glow sprite was removed and shell tessellation reduced after profiling transparent overdraw; final Auto/High with all layers reached about **144 FPS** in the single emulated 1920×1080 QA tab and remained about **72 FPS** while concurrent browser automation was active.
- Verification: targeted lab tests **22/22**, full TypeScript tests **203/203**, Python tests **38 passed / 7 skipped**, `npx tsc --noEmit` PASS, production build PASS (existing CJS `import.meta` warning and large lazy Three.js chunk warning remain).
- Dev server remains available at `http://127.0.0.1:3010/jarvis-lab`.

## This turn — UI-R9 Jarvis Command Center (WebGL redesign of /jarvis-lab)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** (203/203 TS tests) + **LIVE browser QA** on this machine (dev server 3010, emulated 1920×1080 + native narrow). Owner visual acceptance pending.

- Real Three.js core: `src/jarvis/ui/three/CoreScene.tsx` (nucleus, GPU particle sphere, filaments, rings with ticks, tool orbit nodes from the real capability registry, space dust, ripple pulses, pooled memory streams/tool arcs)
- Pure logic split for tests: `three/quality.ts` (auto/high/balanced/minimal/2d, FPS stepping, DPR caps), `three/sceneState.ts` (phase→mood), `three/pulseBus.ts`, `graph/graphLayout.ts` (deterministic clustered layout, BFS path), `graph/graphTypes.ts`
- Interactive knowledge graph from the real SQLite store via new read-only `src/jarvis/memory/graphAdapter.ts` + `/api/jarvis/memory/graph` + `/api/jarvis/memory/node`; secret privacy labels redacted; no invented edges
- Ops data: `src/jarvis/standalone/labSystem.ts` + `/api/jarvis/system` (CPU/RAM/disk real, GPU via nvidia-smi cached, unknowns shown as unknown) and `/api/jarvis/night` (reads real night-agent state; showed 6/6 PASS run)
- Page recomposed (`JarvisLabPage.tsx` + `jarvis-lab.css`): translucent left memory/context/inspector rail, right operations rail, floating evidence/tool/task panels, REQUEST→…→PRESENTATION→SPEECH pipeline, floating dock with circular mic; existing ask/stream/mic/speech/persona/voice logic unchanged
- Live QA: real ask answered "Jarvis uses a SQLite memory backend." with memory evidence `fact:architecture.memory_backend`; node select/inspector/relations verified; drag-orbit verified; 2D↔auto quality roundtrip verified (fixed false context-lost on intentional unmount); ~144 fps at high
- Fixes found by QA: filament antipodal spike through core, polar cluster edge through nucleus (band layout + curved edges), Ripples material leak, hidden floats in a11y tree, narrow screens default-collapse rails
- Fallbacks kept: `JarvisCoreVisual` CSS core renders for 2D mode, missing WebGL, or lost context; reduced motion freezes to demand rendering; hidden tab stops the frameloop
- Dev server for viewing: `$env:PORT='3010'; $env:JARVIS_STANDALONE='1'; npm run dev` (left running)
- Not started: owner HUMAN_QUALITY pass, Discord work (none), Jarvis Core changes (none — adapters only)

## This turn — Grok-only tonight is startable

Labels:

- **IMPLEMENTED** + **UNIT_VERIFIED** Cursor CLI provider: official `%LOCALAPPDATA%\cursor-agent` lookup, Windows `node.exe`+`index.js` launch (avoids `agent.cmd` `EINVAL`), exact model `cursor-grok-4.6-xhigh-fast`, no Auto / no `cursor-grok-4.6-high-fast`, Qwen/Codex fallback off
- **LIVE_VERIFIED** isolated worktree `C:\Users\piriy\Documents\DiscordBOT-night-2026-08-19` from HEAD `3d32cb4e9309115b648bccd33f7d5abd39b7e983`
- **LIVE_VERIFIED** synthetic dry-run `NIGHT-DRYRUN-001` **PASS** via `cursor-grok` / `Cursor Grok 4.6 Extra High Fast`; NightToolHost ran `npx tsx --test tests/grok_dryrun_marker.test.ts` exit 0; Local Qwen attempts 0
- Primary repo project code was not written by Grok (marker files exist only in the night worktree)
- Windows Cursor CLI cannot `--sandbox enabled`; argv uses `--sandbox disabled` plus project `.cursor/cli.json` deny Shell/WebFetch/MCP and orchestrator scopeGuard
- Project `cli.json` is permissions-only (installed CLI rejects `version` on project files)
- Overnight run **LIVE_VERIFIED completed**: NIGHT-001..006 all PASS on first Grok attempt; Qwen attempts 0; no provider failures; no push/commit/merge. Report: `C:\Users\piriy\Documents\DiscordBOT-night-2026-08-19\.agent\night\reports\NIGHT_REPORT-2026-08-19.md`

### Owner start (do not run until they ask)

```powershell
npm run agent:night
```

Morning:

```powershell
npm run agent:night:status
npm run agent:night:report
```

## Git state

- Branch: `feature/jarvis-platform-contracts` (tracking origin)
- Unrelated dirty/untracked files left untouched
- No commit or push

## Earlier this calendar day — Grok-only zip landed (superseded)

Zip parked at `.runtime/addenda/night-agent-grok-only-tonight-fix/`. The PATH/auth/model blockers below are **superseded** by the live dry-run in the section above.

### What the zip required

1. Real Cursor CLI worker (fresh process, `--print`, `stream-json`, `--workspace`, exact `--model`, sandbox; `--force` only in isolated worktree)
2. Grok is a patch worker only (deny Shell / WebFetch / MCP / private paths); NightToolHost runs acceptance
3. Controller (dirty primary) vs clean isolated night worktree; create only with `--create-worktree --name`
4. On quota/auth/model/provider failure: record, mark `BLOCKED_PROVIDER`, write report, STOP; do not start Qwen
5. Never guess the model id; never auto-commit/push/reset/clean/delete worktrees

### Owner blockers (exact actions)

1. Install official Cursor CLI in PowerShell: `irm 'https://cursor.com/install?win32=true' | iex`
2. Open a **new** PowerShell, then: `agent --version` ; `agent login` ; `agent models`
3. Put the exact Grok 4.6 id into `night-agent.grok-only.example.json` as `cursorModel` / provider `model` (copy that file to `night-agent.config.json`)
4. Create the isolated worktree: `npm run agent:night:prepare -- --create-worktree --name night-2026-08-19 --acknowledge-head-only` (HEAD-only; dirty primary files are **not** included)
5. Set `workspaceRoot` to the printed path, then run one synthetic NIGHT_SAFE dry-run before an unattended queue

### Tests

- `npx tsc --noEmit` PASS
- `npx tsx --test tests/night_agent.test.ts` **13/13**
- `npx tsx --test tests/night_agent_grok_only.test.ts` **15/15**

## Previous turn — Night Agent NIGHT-BUILD-001 through 009

Labels:

- **IMPLEMENTED** + **UNIT_VERIFIED** for the separate `src/agent/` overnight coding worker (orchestrator, policy, NightToolHost, Qwen adapter, reports, CLI)
- **LIVE_VERIFIED** DEV_NIGHT Qwen context benchmark on this machine with Discord/ASR/JaiTTS/RVC off
- **LIVE_VERIFIED** synthetic sandbox dry run: 3 Qwen NIGHT_SAFE tasks PASS + 1 simulated fail BLOCKED with escalation
- **Not** a real overnight run on this dirty primary worktree
- **Not** Windows Task Scheduler (NIGHT-BUILD-010 not started)
- **Not** JF-010
- Discord client was not started
- Cursor `agent` CLI was not on PATH; v1 does not spawn it

### Architecture

Deterministic `NightOrchestrator` owns task selection, NIGHT_SAFE checks, file/command policy, attempts, time limits, acceptance tests, PASS/BLOCKED, escalation, and reporting.

`LocalQwenCodingAgent` is a development-only worker. Jarvis Core / `/jarvis-lab` do not receive coding/file/shell tools.

### npm commands

- `npm run agent:night:prepare`
- `npm run agent:night`
- `npm run agent:night:status`
- `npm run agent:night:report`

### DEV_NIGHT Qwen benchmark (voice services stopped)

Idle after ASR/JaiTTS/RVC stop: **1251 / 24463 MiB**. RAM 64956 MB total, 36644 MB free. Model `digital-me-qwen38:27b-ad-q4km` (`/api/ps` still labels quant Q8_0).

| num_ctx | GPU after (MiB) | cold load | warm prompt tok/s | warm gen tok/s |
|---|---|---|---|---|
| 16384 | 18181 / 24463 | 6.39 s | 1258 | 51 |
| 32768 | 19220 / 24463 | 7.37 s | 1369 | 57 |
| 49152 | 20250 / 24463 | 7.33 s | 1286 | 50 |

Recommended stable coding context: **32768**. 48K fits but leaves less headroom. Largest is not assumed best.

### Sandbox dry run

Temp git workspace. Qwen ctx 32768. 10 context resets.

| Task | Result | Attempts | Files |
|---|---|---|---|
| SANDBOX-001 unit test | PASS | 1 / 11852 ms | tests/add.test.ts |
| SANDBOX-002 type fix | PASS | 1 / 8420 ms | src/typo.ts |
| SANDBOX-003 README | PASS | 1 / 11071 ms | README.md |
| SANDBOX-FAIL | BLOCKED | 3 | escalation packet |

Cloud/Codex disabled: local packet saved, independent tasks continued.

First dry-run attempt failed acceptance with Windows `spawn EINVAL` on `npx.cmd`. Allowlisted `tsx --test` / `tsc --noEmit` now run through `process.execPath`. Re-run passed.

### Tests / lint / build

- `npx tsx --test tests/night_agent.test.ts` **13/13**
- `npx tsc --noEmit` PASS
- `npm run build` PASS (known SQLite `import.meta` CJS warning)

## Previous turn — JF-009 standalone speech output

**IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** typed `/jarvis-lab` speak. Native Edge-TTS. Not HUMAN_QUALITY_VERIFIED. JF-009 is accepted; JF-010 was not started.

## Next READY

- Owner command to start the seeded overnight queue: `npm run agent:night` (do not start until asked)
- `JF-010` permission/action policy — **do not start unless the owner asks**
- NIGHT-BUILD-010 Windows scheduler — **do not start unless the owner asks**
- `UI-R9` WebGL core — **do not start unless the owner asks**

## Blocked / stopped

- Stopped before Windows automatic scheduling
- Stopped before JF-010
- Qdrant / MEMORY-003
- Discord JARVIS-006+
- Digital Me dashboard rewrite
