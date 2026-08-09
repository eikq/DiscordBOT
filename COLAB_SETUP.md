# 🎙️ GOOGLE COLAB VOICE CLONING SETUP GUIDE ($0 Cost)

This guide shows you how to run a **free GPU-accelerated Voice Cloning server** on Google Colab.

---

## 🛑 WHY DID NGROK FAIL IN YOUR SCREENSHOT?
ngrok now requires a **free authtoken** to start a session (`ERR_NGROK_4018`).
You have **two easy ways** to fix this:

---

## ⚡ OPTION A: NO SIGN-UP NEEDED (Recommended — Cloudflare Tunnel)
Uses Cloudflare Tunnel (`cloudflared`) which generates a free HTTPS URL **without registering or using any tokens**!

### 💻 Run This Single Cell in Google Colab:
```python
# --- GOOGLE COLAB VOICE SERVER (Cloudflare Tunnel - 100% Free, No Signup) ---
!pip install -q edge-tts fastapi uvicorn soundfile librosa torch torchaudio nest_asyncio
!wget -q -c https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared
!chmod +x cloudflared

import subprocess
import time
import torch
import soundfile as sf
from fastapi import FastAPI
from pydantic import BaseModel
import edge_tts
import uvicorn
import threading
import nest_asyncio

# Apply nest_asyncio to allow uvicorn inside Colab notebook event loop
nest_asyncio.apply()

app = FastAPI(title="Digital Me Colab TTS Server")

class TTSRequest(BaseModel):
    text: str
    persona: str = "default"  # Can pass "Spin", "Anu", "Bank", etc.

@app.get("/health")
def health():
    return {
        "status": "ok", 
        "gpu": torch.cuda.is_available(), 
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    }

@app.post("/generate")
async def generate_voice(req: TTSRequest):
    # Select voice based on persona (e.g. Niwat for male, Premwadee for female)
    voice = "th-TH-NiwatNeural"
    if req.persona.lower() in ["female", "girl", "jane"]:
        voice = "th-TH-PremwadeeNeural"

    communicate = edge_tts.Communicate(req.text, voice)
    temp_mp3 = "temp_base.mp3"
    await communicate.save(temp_mp3)
    
    with open(temp_mp3, "rb") as f:
        audio_data = f.read()
    return audio_data

# Start Cloudflare Tunnel in Background
def start_tunnel():
    proc = subprocess.Popen(["./cloudflared", "tunnel", "--url", "http://localhost:8766"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in iter(proc.stdout.readline, ""):
        if "trycloudflare.com" in line:
            for word in line.split():
                if "trycloudflare.com" in word:
                    url = word if word.startswith("http") else f"https://{word}"
                    print("\n" + "="*65)
                    print(f"🎉 YOUR FREE VOICE SERVER URL IS:\n\n   {url}\n")
                    print("Copy this URL and put it in your .env as COLAB_TTS_URL")
                    print("="*65 + "\n")
                    break

threading.Thread(target=start_tunnel, daemon=True).start()
time.sleep(3)

print("🚀 Starting Colab Voice Server on port 8766...")
config = uvicorn.Config(app, host="0.0.0.0", port=8766, log_level="info")
server = uvicorn.Server(config)
await server.serve()
```

---

## 🔑 OPTION B: USING NGROK (If you have an ngrok Authtoken)
1. Get your free authtoken from [ngrok Dashboard](https://dashboard.ngrok.com/get-started/your-authtoken).
2. Before `ngrok.connect()`, add this line:
   ```python
   from pyngrok import ngrok
   ngrok.set_auth_token("YOUR_NGROK_AUTHTOKEN_HERE")
   public_url = ngrok.connect(8766).public_url
   print("URL:", public_url)
   ```

---

## 👥 HOW TO CLONE YOUR FRIEND'S VOICE & BEHAVIOR

### 1. Friend Voice Cloning
- Record **1 to 3 minutes** of your friend's voice and save it as:
  `data/voice/friends/<friend_name>.wav` (e.g. `data/voice/friends/bank.wav`).
- When sending TTS requests, specify `req.persona = "Bank"`.

### 2. Friend Behavior Cloning
- To clone how your friend talks, use the **Annotation Tool**:
  ```bash
  npm run annotate
  ```
- Enter your friend's name, their common context, and their actual response style (slang, catchphrases, roasting habits).
- The AI twin uses **Semantic Embedding Vector Search** to mimic your friend's exact speech patterns, catchphrases, and decision to speak or stay silent during live Discord voice chats!

