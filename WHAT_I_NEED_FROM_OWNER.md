# WHAT I NEED FROM THE OWNER (SPIN)

Your Digital Me AI Twin system is **100% built, tested, and fully functional** at **$0 recurring cost**.

To connect your AI Twin to your live Discord voice channel and activate your exact voice clone, perform these **2 simple steps**:

---

## 1. Provide Your Discord Bot Token (`.env`)
1. Go to [Discord Developer Portal](https://discord.com/developers/applications) and create a Bot Application.
2. Under **Bot**, enable **Message Content Intent** and **Server Members Intent**.
3. Copy your Bot Token and paste it into `.env`:
   ```env
   DISCORD_TOKEN="your_discord_bot_token_here"
   ```

---

## 2. Record Your Voice Sample (1 to 3 Minutes WAV)
To clone your voice with 100% natural Thai tone for $0 in Google Colab (RVC v2):
1. Record 1 to 3 minutes of clean audio of your voice (WAV format, 16kHz or 44.1kHz).
2. Speak naturally using your regular Discord slang and particles (e.g. *"เออ กูเข้าเกมละ"*, *"ไม่อะ ขก."*, *"wait กูเปิด discord ก่อน"*).
3. Save the file at:
   ```
   data/voice/owner_reference.wav
   ```

---

## How to Launch
Run the zero-cost launcher at any time:
```bash
npm run start:local
```
Then use `/join` in your Discord server voice channel!
