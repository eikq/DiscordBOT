# JARVIS Community Edition — submission checklist

Do not tick an item without evidence. Evidence is from this packaging branch, not from owner `data/jarvis/`.

- [ ] clean clone startup — **not re-run from an empty clone in this session**. Launcher path (`npm run jarvis:community`, `Start-Jarvis-Community.ps1`) starts from this worktree.
- [ ] dependencies install — **not re-run**. `node_modules` was already present; the launcher refuses to start if it is missing.
- [x] model configuration documented — `.env.community.example`, `COMMUNITY_EDITION.md`. OpenAI-compatible `JARVIS_LLM_*`. No Discord token required.
- [x] `/jarvis` loads — **LIVE_VERIFIED** `http://127.0.0.1:3014/jarvis` and `3015/jarvis` HTTP 200. Discord client not started.
- [x] clean data root — **LIVE_VERIFIED** isolated temp roots created `community.db`, `runtime/`, `obsidian/`, `workspaces/`. No `jarvis.db`, no `builds/`.
- [x] no owner data — **LIVE_VERIFIED** conversation state had no `data/jarvis` / owner model-id leak. Memory note was only the Community preference written in that root.
- [x] build demo — **LIVE_VERIFIED** on `127.0.0.1:3015` with a fresh Community root: `สร้างเว็บ todo แบบ modern ให้ผม` → `software.planBuild` (Todo / React / Vite). Then `เอาตามแผนนี้` → pending proposal. Then `อนุญาตงานนี้` → `data/community`-style `workspaces/todo-modern` with `src/`, `tests/`, `node_modules/`, `dist/`.
- [x] permission demo — **LIVE_VERIFIED** approve produced `pendingConfirmation` / proposal id; grant was scoped. No ADMIN / GLOBAL_FILESYSTEM / UNRESTRICTED_SHELL.
- [x] test/build/preview demo — **LIVE_VERIFIED** preview `http://127.0.0.1:4175` HTTP 200. `รัน test` → `Tests passed for todo-modern`. `ถ้าผ่าน build แล้วเปิด preview` → `project.build` / `Ran build`.
- [x] memory demo — **LIVE_VERIFIED** `จำไว้ว่าผมชอบ UI แบบ clean futuristic` → durable write. `ผมชอบ UI แบบไหน` returned that preference.
- [x] restart demo — **LIVE_VERIFIED** Community 3014 stopped and restarted on the same isolated root. Preference and history recap survived. Owner 3012 left running.
- [x] model offline state — **LIVE_VERIFIED** endpoint `127.0.0.1:9`: Presence-status `MODEL_UNREACHABLE`; generic ask `tell me a joke about cats` → `model_offline` / `LOCAL MODEL OFFLINE. Configure an OpenAI-compatible local model to begin.`
- [x] community exclusions — **LIVE_VERIFIED** status manifest `devices/cctv/cybersecurity/privateBrowser=false`; no `desktop.*` / `cctv.*` / `world-intel` / `privateBrowse` ids. `POST /api/jarvis/private-research` and `/api/jarvis/command-center/night` → 404.
- [x] no secrets — Community artifacts and the commit set do not include `.env`, tokens, or owner DBs. gitleaks is not installed on this machine. Manual scan of new Community files: no live credentials.
- [x] typecheck — `npx tsc --noEmit` pass.
- [x] tests — `tests/jarvis_community_edition.test.ts` 11/11. Affected conversation/semantic tests pass. `npm run test:cloud` **812 pass, 0 fail**.
- [x] build — `npm run build` pass (pre-existing esbuild `import.meta` warning in `schema.ts`).

## Notes

- Community `JARVIS_LLM_MODEL` must match an id from `GET $JARVIS_LLM_BASE_URL/models` for Presence to show **MODEL READY**. A generic `local-model` name against a differently named local server reports `MODEL_NOT_FOUND` even when the endpoint is up. Software plan/build can still run on the deterministic builder path.
- `เพิ่ม dark mode` stayed on `todo-modern` (no slug prompt) and ran `software.applyBuild`. The modern scaffold is already a dark cinematic theme.
- Clean-clone and `npm install` from zero remain for the submitter to tick after a fresh checkout.
