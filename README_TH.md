# Digital Me / Jarvis — Cursor Handoff Pack

แพ็กนี้ถูกสร้างมาเพื่อให้ Cursor รับช่วงพัฒนาโปรเจกต์ `Digital Me` ต่อจากสถานะปัจจุบันอย่างปลอดภัย โดยไม่ต้องพึ่ง chat history ของ Codex เป็นหลัก

## วิธีใช้

1. แตก ZIP
2. คัดลอกไฟล์ทั้งหมดในโฟลเดอร์นี้ไปไว้ที่ root ของ repo: `C:\Users\piriy\Documents\DiscordBOT`
3. **อย่าทับ `PROJECT_CONTEXT.md` ถ้าใน repo มีเวอร์ชันที่ใหม่กว่า**
4. เปิด Cursor ที่ repo นี้
5. เริ่ม chat ใหม่ด้วย prompt ใน `CURSOR_BOOTSTRAP_PROMPT.md`
6. ให้ Cursor อ่าน `PROJECT_CONTEXT.md`, `AGENTS.md`, `TASKS.md`, `ROADMAP.md` ก่อนแก้โค้ด
7. ในรอบแรกให้ Cursor **audit + verify** ก่อน ไม่ต้อง refactor ใหญ่ทันที

## สิ่งที่ Cursor ต้องถือเป็นความจริง

ลำดับความน่าเชื่อถือ:

1. **โค้ดและ test ใน working tree ปัจจุบัน**
2. `PROJECT_CONTEXT.md`
3. เอกสารที่ถูกสร้างจากการตรวจ repo ใน session ปัจจุบัน
4. `README.md`, `.env.example`, integration docs
5. `PROJECT_STATUS.md` / `HANDOFF.md`
6. `PHASE*_STATUS.md` ใช้เป็นประวัติเท่านั้น

หากเอกสารขัดกับโค้ด ให้ตรวจโค้ดและ test ก่อน แล้วบันทึกความไม่ตรงกัน

## เป้าหมายของ Cursor ตอนนี้

Cursor เป็น **Primary Builder** ของโปรเจกต์จนกว่า usage จะลดลงมาก โดยควร:

- เดินงานตาม `TASKS.md`
- สำรวจ repo ก่อนแก้
- ทำงานทีละ task ที่มี acceptance criteria ชัดเจน
- รัน test ที่เกี่ยวข้องหลังแก้
- ไม่ทำลาย dirty working tree เดิม
- ไม่ commit/push จนกว่าผู้ใช้สั่ง
- อัปเดต `SESSION_STATE.md` เมื่อจบช่วงงานใหญ่
- ถ้าติด blocker ที่ต้องใช้ hardware / secret / human listening test ให้บันทึก blocker แล้วไป task อื่นที่ไม่ blocked

## เป้าหมายระยะยาว

Digital Me จะค่อย ๆ พัฒนาเป็น Jarvis ที่มี:

- Discord voice companion
- Thai/English STT
- social/personality memory
- local Qwen brain
- consented voice clone
- MCP tools / live research
- CCTV perception + anomaly events
- desktop / Android / IoT clients
- automation
- local autonomous coding worker สำหรับทำงานข้ามคืน

ไฟล์ `ROADMAP.md` แยกสิ่งที่ "มีอยู่แล้ว", "ต้อง verify", และ "แผนอนาคต" ให้ชัดเจน
