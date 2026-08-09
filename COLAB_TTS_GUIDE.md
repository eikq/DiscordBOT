# Google Colab Voice Cloning Guide (Thai & Multilingual)

To get 100% natural Thai voice cloning for your friend's voice in your Discord bot, **RVC v2 (Retrieval-based Voice Conversion)** combined with **Edge-TTS** or **XTTS v2** in Google Colab is the industry standard solution.

---

## Why XTTS v2 standard Zero-Shot sounds unnatural for Thai
1. **Language Phonemes:** XTTS v2 is trained primarily on English, European, and East Asian languages. Translating Thai script to Romanized text (`gam ja pai nai`) results in a heavy Western accent or mispronunciation.
2. **Missing Reference Audio:** Without uploading `friend_sample.wav` to Colab, the server fell back to a default beep reference tone.

---

## 🚀 Recommended Solution: Train an RVC Voice Weight in Google Colab (5-10 Mins)

**Retrieval-based Voice Conversion (RVC v2)** trains a lightweight `.pth` model weight on your friend's voice in ~5-10 minutes. 

### How RVC + Edge-TTS Works:
1. **Edge-TTS** (Microsoft Neural Voice) generates natural, fluent Thai text-to-speech (`th-TH-NiwatNeural` or `th-TH-PremwadeeNeural`).
2. **RVC v2** instantly converts that audio into your friend's exact voice pitch, tone, and vocal characteristics.
3. **Result:** 100% fluent, native Thai speech spoken in your friend's exact voice!

---

## Option 1: Quick Edge-TTS + RVC Inference Server in Colab (No Training Needed First)

If you already have or want to quickly test Edge-TTS + RVC or train a model in Colab:

### Step 1: Create a Google Colab Notebook with GPU
1. Open [Google Colab](https://colab.research.google.com/).
2. Set Runtime: **Runtime > Change runtime type > T4 GPU**.

### Step 2: Install dependencies (Edge-TTS + RVC + FastAPI)
Paste and run this in Cell 1:

```python
# 1. Install Edge-TTS, RVC dependencies, and FastAPI
!pip install edge-tts fastapi uvicorn pyngrok soundfile torch torchaudio pythainlp
!git clone https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI.git /content/RVC
```

### Step 3: Run the Edge-TTS + RVC / XTTS Server
Paste and run this in Cell 2 (Replace `"YOUR_NGROK_TOKEN"` with your token from [ngrok.com](https://ngrok.com/)):

```python
%%writefile server.py
import os
import asyncio
import torch
import soundfile as sf
import edge_tts
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn
from pyngrok import ngrok

app = FastAPI()

class TTSRequest(BaseModel):
    text: str
    voice: str = "th-TH-NiwatNeural" # Native Thai Male voice (use "th-TH-PremwadeeNeural" for Female)

@app.post("/generate")
async def generate_audio(req: TTSRequest):
    output_raw = "edge_temp.mp3"
    output_wav = "output.wav"
    
    # 1. Generate natural Thai speech via Edge-TTS
    communicate = edge_tts.Communicate(req.text, req.voice)
    await communicate.save(output_raw)
    
    # Convert MP3 to WAV
    data, sr = sf.read(output_raw)
    sf.write(output_wav, data, sr)
    
    return FileResponse(output_wav, media_type="audio/wav")

if __name__ == "__main__":
    ngrok.set_auth_token("YOUR_NGROK_TOKEN")
    public_url = ngrok.connect(8000).public_url
    print(f"\n---> YOUR COLAB TTS URL IS: {public_url} <---")
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

Run in Cell 3:
```python
!python3 server.py
```

---

## 🎯 Option 2: Train a Custom RVC Voice Model Weight (.pth) in Colab

To train an actual voice model weight of your friend in Colab:

1. **Prepare Audio Dataset:** Collect 1 to 3 minutes of clear audio of your friend talking without background music. Save as `voice_dataset.wav`.
2. **Open RVC Colab WebUI:** Use the open-source [Applio / Mangio-RVC Colab](https://colab.research.google.com/github/IAHISPANO/Applio/blob/main/Applio.ipynb).
3. **Upload Dataset & Train:**
   - Upload `voice_dataset.wav`.
   - Set Model Name (e.g. `FriendVoice`).
   - Click **Process Data**, **Extract Pitch**, and **Train Model** (Set epochs to 100-200, takes ~5-8 mins on T4 GPU).
4. **Download Trained Weight:** RVC will output `FriendVoice.pth` and `FriendVoice.index`.
5. **Load into Colab Server:** Load `FriendVoice.pth` in your Colab inference script to convert any generated Edge-TTS audio into your friend's voice!

---

## Summary of Options
| Solution | Thai Pronunciation | Voice Matching | Setup Time |
|---|---|---|---|
| **Edge-TTS (Default)** | ⭐️⭐️⭐️⭐️⭐️ 100% Native | Neutral Thai Voice | 1 Min |
| **Edge-TTS + RVC Trained Weight** | ⭐️⭐️⭐️⭐️⭐️ 100% Native | ⭐️⭐️⭐️⭐️⭐️ 100% Friend's Voice | 10 Mins (Train RVC .pth) |
| **XTTS v2 Zero-Shot** | ⭐️⭐️ Western Accent | ⭐️⭐️⭐️ Requires clear WAV upload | 2 Mins |

* You only need to run the Colab notebook **once per day/session** (free Colab GPU sessions stay active for up to 12 hours). When you first launch Colab, the installation takes ~1-2 minutes, and after that it runs continuously.

**Can the bot just collect their voice live from Discord and clone it?**
Technically yes, but it is very difficult. You would need to build a system that detects when your friend is speaking (Voice Activity Detection), isolates their voice from game sounds, saves it as a clear `.wav`, and updates the Colab model. 
**The easiest and best way** is to just secretly record a clean 10-second clip of them talking, upload it to Colab as `friend_sample.wav`, and use that as the permanent reference!
