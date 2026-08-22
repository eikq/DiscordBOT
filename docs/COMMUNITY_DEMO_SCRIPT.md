# JARVIS Community Edition — 3–5 minute demo

Target: a deterministic local demo. Start Community on a **fresh** `data/community/` root. Do not use owner `data/jarvis/`.

## Before recording

1. `Copy-Item .env.community.example .env.community`
2. Point `JARVIS_LLM_BASE_URL` / `JARVIS_LLM_MODEL` at a running OpenAI-compatible local server.
3. `npm run jarvis:community`
4. Confirm Presence shows **MODEL READY**.

## Script

1. Open `http://127.0.0.1:3012/jarvis`.
   Show the Community welcome. Mention local-first, loopback-only.

2. Ask: `ตอนนี้คุณทำอะไรได้บ้าง`
   Expect a short Community summary: conversation, research, memory/history, software plan/build, test/build/preview.
   Do not tour CCTV or cyber screens.

3. Ask: `สร้างเว็บ todo แบบ modern ให้ผม`
   Show the visual BuildPlan. No files yet.

4. Say: `เอาตามแผนนี้`
   Same plan stays pinned.

5. When permission appears, say: `อนุญาตงานนี้`
   Show the bounded grant, not admin/shell.

6. Watch realtime stages: scaffold, install, build, test, localhost preview.

7. Say: `เพิ่ม dark mode`
   Same project continues. No slug request.

8. Ask: `เมื่อกี้เราทำอะไรไปบ้าง`
   Show Community history / context only.

9. Close with: local-first, permission-first, isolated Community data, no private owner memory.

Keep the clip under five minutes. If a step waits on install, leave it running rather than skipping to a prebuilt owner project.
