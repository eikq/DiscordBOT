<div align="center">

# 🤖 JARVIS Community Edition

### From conversation to verified action.
### จากการสนทนา สู่การลงมือทำที่ตรวจสอบได้

**Local-first Personal AI Operating Interface**

AI ส่วนตัวแบบ Local-first ที่สามารถเข้าใจบริบท วางแผน ขอสิทธิ์ ลงมือทำ ตรวจสอบผล และจดจำ

[🚀 Quick Start](#-quick-start) ·
[🇹🇭 ภาษาไทย](#-ภาษาไทย) ·
[🇬🇧 English](#-english) ·
[📦 Latest Release](https://github.com/eikq/DiscordBOT/releases/tag/jarvis-community-v0.1.0)

</div>

---

## 🇹🇭 ภาษาไทย

**JARVIS Community Edition** คือ AI ส่วนตัวแบบ **Local-first** ที่ออกแบบมาให้ทำได้มากกว่า chatbot ทั่วไป

JARVIS ไม่ได้เพียงตอบข้อความทีละคำถาม แต่สามารถ:

- 🧠 เข้าใจบทสนทนาแบบต่อเนื่อง
- 💾 จดจำ History และ Memory
- 📋 วางแผนก่อนลงมือทำ
- 🔐 ขอ Permission สำหรับงานที่มีผลต่อระบบ
- 🛠️ สร้างและแก้ไขโปรเจกต์ซอฟต์แวร์ใน sandbox
- 🧪 รัน Test จริง
- 🏗️ Build จริง
- 🌐 เปิด Localhost Preview
- ✅ ตรวจสอบผลลัพธ์หลังทำงาน
- 🔄 จดจำข้อมูลสำคัญหลัง restart

แนวคิดหลักคือ:

```text
พูดคุย
   ↓
เข้าใจ
   ↓
วางแผน
   ↓
ขอสิทธิ์
   ↓
ลงมือทำ
   ↓
ตรวจสอบ
   ↓
จดจำ
```

โมเดล AI เสนอสิ่งที่ต้องทำได้ แต่ไม่ได้รับสิทธิ์ควบคุมระบบโดยตรง และไม่สามารถอนุมัติสิทธิ์ให้ตัวเองได้

Community Edition **ไม่รวม** CCTV, ควบคุมอุปกรณ์, desktop automation, private browser / Whonix, Night Agent, Discord, voice cloning หรือระบบ cybersecurity แบบส่วนตัว

---

## 🇬🇧 English

**JARVIS Community Edition** is a **local-first** personal AI operating interface. It is more than a chatbot that answers one message at a time.

JARVIS keeps conversational context, remembers important facts, shows a plan before acting, asks for job-scoped permission, executes through bounded capabilities, and verifies real results.

The core loop is:

```text
Talk → Understand → Plan → Ask permission → Act → Verify → Remember
```

The model can propose work. It cannot approve, grant, or expand its own permission. Community does not expose unrestricted shell, Administrator authority, global filesystem access, or desktop CLICK / TYPE / SUBMIT.

Private device, CCTV, desktop automation, private-browser / Whonix, Night Agent, Discord, voice cloning, and private cybersecurity subsystems are not registered, started, or spawned.

---

## 🚀 Quick Start

```powershell
git clone https://github.com/eikq/DiscordBOT.git
cd DiscordBOT
npm ci
Copy-Item .env.community.example .env.community
```

Point `.env.community` at any OpenAI-compatible local model:

```
JARVIS_LLM_BASE_URL=http://127.0.0.1:8086/v1
JARVIS_LLM_MODEL=<id from GET /v1/models>
JARVIS_LLM_API_KEY=
```

Then:

```powershell
npm run jarvis:community
```

or `.\Start-Jarvis-Community.ps1`

Open http://127.0.0.1:3012/jarvis (or `3013` if `3012` is busy). Community binds `127.0.0.1` only. Start the local model separately.

If no model is running, Presence stays usable and shows **LOCAL MODEL OFFLINE**. It does not invent answers.

Full guide: [`COMMUNITY_EDITION.md`](COMMUNITY_EDITION.md) · architecture: [`docs/COMMUNITY_ARCHITECTURE.md`](docs/COMMUNITY_ARCHITECTURE.md) · demo: [`docs/COMMUNITY_DEMO_SCRIPT.md`](docs/COMMUNITY_DEMO_SCRIPT.md)

---

## 🛠️ Software Builder

Ask:

> `สร้างเว็บ todo แบบ modern ให้ผม`

JARVIS can **Understand → Plan → Review → Permission → Scaffold → Install → Test → Build → Preview → Verify**.

Follow-ups such as `เพิ่ม dark mode`, `รัน test`, and `ถ้าผ่าน build แล้วเปิด preview` continue the same project when context is clear. You do not need to repeat a slug or internal ID.

Remember with `จำไว้ว่าผมชอบ UI แบบ clean futuristic`, then after restart ask `ผมชอบ UI แบบไหน`.

---

## 📦 Release

**v0.1.0** · tag `jarvis-community-v0.1.0` · commit `0d8eec176aa4ebd04914ef54eac57df4c19e0f18`

[GitHub Release](https://github.com/eikq/DiscordBOT/releases/tag/jarvis-community-v0.1.0)
