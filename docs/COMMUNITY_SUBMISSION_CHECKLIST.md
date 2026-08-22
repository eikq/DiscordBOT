# JARVIS Community Edition — submission checklist

Do not tick an item without evidence. Evidence is from this packaging branch, not from owner `data/jarvis/`.

Release gate date: 2026-08-23. Source branch `release/jarvis-community-edition-v1-2026-08-23`. Starting HEAD `b22ee95`. Live acceptance ran in a disposable clone, not the dirty owner worktree.

- [x] clean clone — **LIVE_VERIFIED**. `git clone --no-local` of this repo into `%TEMP%\jarvis-community-release-check`. Clone HEAD at acceptance: `aaeca0c`. `git status --short` was clean. No owner `data/jarvis`, no owner `.env`, no `.runtime`, no copied `node_modules`.
- [x] fresh dependency install — **LIVE_VERIFIED** in the clone. `npm ci` exit 0, ~18s, 368 packages, 0 vulnerabilities. Did not copy owner `node_modules`.
- [x] Community standalone start — **LIVE_VERIFIED**. Clone used `npm run jarvis:community` (`JARVIS_EDITION=community`). Bound `127.0.0.1:3013` because owner 3012 was already up. Discord client not started.
- [x] offline model state — **LIVE_VERIFIED**. First start with no working model (`JARVIS_LLM_BASE_URL=http://127.0.0.1:9/v1`). `/api/health` 200. `llm.health=MODEL_UNREACHABLE`. Ask `tell me a joke about cats` → `answerIntent=model_offline` / `LOCAL MODEL OFFLINE. Configure an OpenAI-compatible local model to begin.` No crash. No invented LLM answer.
- [x] model ready — **LIVE_VERIFIED**. Second start injected local llama.cpp through process environment only. Advertised model id from `GET http://127.0.0.1:8086/v1/models`: `qwen38-cyber`. `llm.health=MODEL_READY`. API key was not written into the clone `.env.community`.
- [x] `/jarvis` — **LIVE_VERIFIED** `http://127.0.0.1:3013/jarvis` HTTP 200. Presence is the product surface.
- [x] Community data isolation — **LIVE_VERIFIED**. Clone data root `...\jarvis-community-release-check\data\community` with `community.db`, `runtime/`, `obsidian/`, `workspaces/`. Clone `data/jarvis` absent. Owner `data/jarvis` never loaded.
- [x] private provider not spawned — **LIVE_VERIFIED** + **UNIT_VERIFIED**. Startup log `privateProviders=disabled publicResearch=community`. Community-spawned WorldIntel: NO. Discord start: NO. Night Agent / private-browser / CCTV / device / desktop constructors not invoked. `JARVIS_COMMUNITY_PROVIDER_LOCK=1` throws if those constructors run.
- [x] build demo — **LIVE_VERIFIED** through real `/api/jarvis/ask` in the clone. `สร้างเว็บ todo แบบ modern ให้ผม` → visual BuildPlan, slug `todo-modern`, React/Vite, no files yet. `เอาตามแผนนี้` kept the same plan.
- [x] permission — **LIVE_VERIFIED**. `อนุญาตงานนี้` → bounded grant `WRITE_PROJECT`, `INSTALL_PROJECT_DEPENDENCIES`, `RUN_PROJECT_COMMANDS`, `START_DEV_SERVER`. Lease `LEASE_ACTIVE`. No ADMIN / GLOBAL_FILESYSTEM / UNRESTRICTED_SHELL.
- [x] real test — **LIVE_VERIFIED**. Workspace `data/community/workspaces/todo-modern`. `node tests/smoke.test.mjs` → `smoke ok`. Follow-up `รัน test` → `Tests passed for todo-modern`.
- [x] real build — **LIVE_VERIFIED**. Apply ran `npm install` (exit 0) and `vite build` (exit 0). Follow-up `ถ้าผ่าน build แล้วเปิด preview` requested `project.build` + `project.startDevServer` on the same slug.
- [x] preview — **LIVE_VERIFIED**. `http://127.0.0.1:4177` host `127.0.0.1` only, HTTP 200.
- [x] memory — **LIVE_VERIFIED**. `จำไว้ว่าผมชอบ UI แบบ clean futuristic` → durable Community write. After restart, `ผมชอบ UI แบบไหน` returned that preference (`owner.pref._ui_clean_futuristic`).
- [x] restart — **LIVE_VERIFIED**. Community 3013 stopped and restarted on the same clone data root. Preference and `เมื่อกี้เราทำอะไรไปบ้าง` recap survived (Todo App / Ran build / UI pref). Owner 3012 and llama 8086 left running.
- [x] no owner data — **LIVE_VERIFIED**. Owner project inventory (including portfolio) did not appear. Isolation leak count for owner files/DBs: 0. Residual stale `data/jarvis/builds` **string** existed only in the first pre-path-fix persisted plan; actual files landed under `data/community/workspaces/todo-modern`. Later commits advertise Community paths.
- [x] no exposed private capabilities — **LIVE_VERIFIED**. Registered private capability IDs: 0. HTTP 404: `/api/intelligence/status`, `/api/jarvis/night`, `/api/jarvis/private-research`, `/api/jarvis/command-center/night`, `/api/bot/status`, `/api/control`. Command-center devices: 0.
- [x] tracked-content secret audit — **PASS**. `gitleaks` is not installed; no random global install. Tracked tree at `008885f` (972 files) scanned with `git grep` / `git log -S`. Hits were empty `.env*.example` fields, test fixtures, docs, or owner-path documentation. No Discord-token shape, no PEM private keys, no live `sk-live` / `sk-proj` in current tree. Untracked owner `.env` was not opened. No credential values printed.
- [x] typecheck — `npx tsc --noEmit` pass on the source repo after the release-fix commits.
- [x] tests — `tests/jarvis_community_edition.test.ts` 13/13. Affected conversation tests pass. `npm run test:cloud` **814 pass, 0 fail**.
- [x] production build — `npm run build` pass (pre-existing esbuild `import.meta` warning in `schema.ts`).

## Notes

- Community `JARVIS_LLM_MODEL` must match an id from `GET $JARVIS_LLM_BASE_URL/models` for Presence to show **MODEL READY**.
- The clean-clone proof used Git objects only. Do not package the owner worktree or generated `data/community/` from acceptance.
- If a ZIP is required later, build it from the clean clone or `git archive`. Exclude `.git`, `node_modules`, generated `data/community`, `data/jarvis`, `.runtime`, credentialed `.env.community`, owner `.env`, DBs, and logs.
- Owner `SESSION_STATE.md` in the source worktree is intentionally dirty and was not staged.
