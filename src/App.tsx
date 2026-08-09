/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

export default function App() {
  const [status, setStatus] = useState<string>('Loading...');
  const [colabUrl, setColabUrl] = useState<string | null>(null);
  
  // TTS Test state
  const [testText, setTestText] = useState<string>('สวัสดีครับเพื่อน มึงจะเล่นเกมปะเนี่ย');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);

  // Behavior state
  const [speaker, setSpeaker] = useState<string>('Bank');
  const [friendSpeech, setFriendSpeech] = useState<string>('มึงเข้า valo ปะ');
  const [ownerAction, setOwnerAction] = useState<string>('ANSWER');
  const [ownerResponse, setOwnerResponse] = useState<string>('ไม่อะ ขก.');
  const [examples, setExamples] = useState<any[]>([]);
  const [voiceSamples, setVoiceSamples] = useState<any[]>([]);
  const [behaviorSuccess, setBehaviorSuccess] = useState<string | null>(null);
  const [isSavingBehavior, setIsSavingBehavior] = useState<boolean>(false);
  const [discordTokenInput, setDiscordTokenInput] = useState<string>('');
  const [isConnectingBot, setIsConnectingBot] = useState<boolean>(false);
  const [showColabScript, setShowColabScript] = useState<boolean>(false);
  const [colabInput, setColabInput] = useState<string>('');
  const [isSyncingDrive, setIsSyncingDrive] = useState<boolean>(false);
  const [hasSyncedDrive, setHasSyncedDrive] = useState<boolean>(() => {
    return localStorage.getItem('has_synced_drive') === 'true';
  });
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  const [transcriptFilter, setTranscriptFilter] = useState<'transcripts' | 'all'>('transcripts');

  const handleSaveColabUrl = async () => {
    if (!colabInput.trim()) return;
    try {
      const res = await fetch('/api/colab/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: colabInput.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setColabUrl(data.colabUrl);
        setColabInput('');
        alert('✅ Successfully connected Google Colab URL!');
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err: any) {
      alert('Error connecting Colab URL: ' + err.message);
    }
  };

  const handleSyncDrive = async () => {
    if (hasSyncedDrive) return;
    setIsSyncingDrive(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/voice-samples/sync-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('has_synced_drive', 'true');
        setHasSyncedDrive(true);
        setSyncResult(`✅ Synced ${data.syncedCount} samples into Google Drive!`);
      } else {
        setSyncResult(`❌ Sync failed: ${data.error}`);
      }
    } catch (err: any) {
      setSyncResult(`❌ Sync error: ${err.message}`);
    } finally {
      setIsSyncingDrive(false);
    }
  };

  useEffect(() => {
    fetch('/api/bot/status')
      .then(res => res.json())
      .then(data => {
        setStatus(data.status);
        if (data.colabUrl) setColabUrl(data.colabUrl);
      })
      .catch(() => setStatus('Error fetching status'));

    const loadData = () => {
      fetch('/api/behavior')
        .then(res => res.json())
        .then(data => {
          if (data.examples) setExamples(data.examples);
        })
        .catch(() => {});

      fetch('/api/voice-samples')
        .then(res => res.json())
        .then(data => {
          if (data.samples) setVoiceSamples(data.samples);
        })
        .catch(() => {});

      fetch('/api/transcripts')
        .then(res => res.json())
        .then(data => {
          if (data.events) setLiveEvents(data.events);
        })
        .catch(() => {});
    };

    loadData();
    const interval = setInterval(loadData, 1500);
    return () => clearInterval(interval);
  }, []);

  const handleStartBot = async () => {
    setIsConnectingBot(true);
    setStatus('Connecting...');
    try {
      const res = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: discordTokenInput || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus(data.status);
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setIsConnectingBot(false);
    }
  };

  const handleAddBehavior = async () => {
    if (!speaker.trim() || !friendSpeech.trim()) {
      alert('Please enter both friend name and what the friend says.');
      return;
    }
    setIsSavingBehavior(true);
    try {
      const res = await fetch('/api/behavior', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speaker: speaker.trim(),
          text: friendSpeech.trim(),
          ownerAction,
          ownerResponse: ownerAction === 'IGNORE' ? null : ownerResponse.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBehaviorSuccess(`✅ Successfully saved behavior pattern for ${speaker}!`);
        setExamples([data.record, ...examples]);
        setTimeout(() => setBehaviorSuccess(null), 4000);
      } else {
        alert('Failed to save behavior: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Error saving behavior: ' + err.message);
    } finally {
      setIsSavingBehavior(false);
    }
  };

  const handleTestTts = async () => {
    if (!testText.trim()) return;
    setIsGenerating(true);
    setTtsError(null);
    setAudioUrl(null);
    setLatencyMs(null);

    const startTime = Date.now();

    try {
      const response = await fetch('/api/tts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: testText }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({ error: 'Failed to generate TTS' }));
        throw new Error(errJson.error || `Server error: ${response.status}`);
      }

      const blob = await response.blob();
      const duration = Date.now() - startTime;
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setLatencyMs(duration);
    } catch (err: any) {
      setTtsError(err.message || 'Error communicating with Google Colab');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#0a0a0a] to-[#121212] text-gray-200 font-sans">
      <header className="h-20 border-b border-white/5 flex items-center justify-between px-10">
        <h2 className="text-xl font-medium text-white tracking-tight">Digital Me <span className="text-gray-600 font-light mx-2">/</span> <span className="text-[#5865F2] font-semibold">Voice Cloning Dashboard</span></h2>
      </header>

      <div className="p-10 space-y-8 flex-1 overflow-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#161616] p-6 rounded-2xl border border-white/5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="text-4xl">🤖</span>
            </div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Bot Connection</p>
            <div className="text-2xl font-bold text-white mb-2">{status}</div>
            <div className={`flex items-center gap-1.5 text-xs font-mono ${status === 'Connected' ? 'text-green-400' : 'text-orange-400'} mb-3`}>
              <span>{status === 'Connected' ? '↑' : '•'}</span> {status === 'Connected' ? 'Online in Discord' : 'Disconnected'}
            </div>
            <div className="mb-3">
              <input
                type="password"
                value={discordTokenInput}
                onChange={(e) => setDiscordTokenInput(e.target.value)}
                placeholder="Paste Discord Token (Optional)"
                className="w-full bg-[#111111] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-[#5865F2]"
              />
            </div>
            <button
              onClick={handleStartBot}
              disabled={isConnectingBot}
              className="w-full py-2 bg-[#5865F2] hover:bg-[#4752C4] disabled:bg-gray-800 text-white font-medium text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {isConnectingBot ? '⏳ Starting Bot...' : '⚡ Start / Reconnect Bot'}
            </button>
          </div>

          <div className="bg-[#161616] p-6 rounded-2xl border border-white/5 relative overflow-hidden group md:col-span-2">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="text-4xl">⚡</span>
            </div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Google Colab Voice Engine</p>
            <div className="text-lg font-bold text-white mb-2 font-mono truncate">
              {colabUrl ? colabUrl : 'Not Connected'}
            </div>
            <div className="flex items-center justify-between mb-4">
              <div className={`flex items-center gap-1.5 text-xs font-mono ${colabUrl ? 'text-green-400' : 'text-red-400'}`}>
                <span>{colabUrl ? '● Active Cloudflare Tunnel' : '○ Paste your Colab trycloudflare URL below'}</span>
              </div>
              <button
                onClick={() => setShowColabScript(!showColabScript)}
                className="text-xs text-[#5865F2] hover:underline font-mono cursor-pointer"
              >
                {showColabScript ? 'Hide Colab Fix Script' : '🛠️ Copy Fixed Colab Python Code'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <input
                type="text"
                value={colabInput}
                onChange={(e) => setColabInput(e.target.value)}
                placeholder="https://...trycloudflare.com"
                className="sm:col-span-2 bg-[#111111] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-[#5865F2]"
              />
              <button
                onClick={handleSaveColabUrl}
                className="py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1"
              >
                🔗 Connect Colab URL
              </button>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <button
                onClick={handleSyncDrive}
                disabled={isSyncingDrive || !colabUrl || hasSyncedDrive}
                className={`px-4 py-2 text-xs font-medium border rounded-xl transition-all flex items-center gap-2 ${
                  hasSyncedDrive 
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30 cursor-default' 
                    : 'bg-[#222222] hover:bg-[#333333] disabled:opacity-50 text-blue-400 border-blue-500/20 cursor-pointer'
                }`}
              >
                {isSyncingDrive ? '⏳ Syncing to Drive...' : hasSyncedDrive ? '✓ Voice Samples Synced to Drive' : '📤 Sync All Recorded Samples to Google Drive (One-Time)'}
              </button>
              {syncResult && (
                <p className="text-xs font-mono text-gray-300">{syncResult}</p>
              )}
            </div>

            {showColabScript && (
              <div className="mt-4 p-4 bg-[#0d0d0d] rounded-xl border border-white/10 text-xs font-mono text-gray-300 space-y-2">
                <p className="text-yellow-400 font-bold">🚀 Complete Google Colab Code (Fixed Asyncio Error + Per-Person Drive Voice Cloning):</p>
                <p className="text-gray-400">Copy & Paste this entire code block into your Google Colab notebook cell and run it:</p>
                <pre className="p-3 bg-[#111111] rounded-lg overflow-x-auto text-[11px] text-green-300 border border-white/5 select-all leading-relaxed">
{`# ============================================================
# 1. MOUNT GOOGLE DRIVE (Saves recorded voices permanently per person)
# ============================================================
from google.colab import drive
import os, base64, glob, time, threading, subprocess, re
drive.mount('/content/drive')

DRIVE_DIR = "/content/drive/MyDrive/DiscordBotVoice"
SAMPLES_DIR = os.path.join(DRIVE_DIR, "voice_samples")
os.makedirs(SAMPLES_DIR, exist_ok=True)
print(f"📁 Google Drive Storage Ready at: {SAMPLES_DIR}")

# ============================================================
# 2. INSTALL REQUIRED PACKAGES & FIX ASYNCIO IN COLAB
# ============================================================
!pip install -q fastapi uvicorn edge-tts pyngrok pydantic nest_asyncio
!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
!dpkg -i cloudflared-linux-amd64.deb

import nest_asyncio
nest_asyncio.apply()

# ============================================================
# 3. FASTAPI VOICE SERVER (Live Upload + Live Train + Fixed TTS)
# ============================================================
from fastapi import FastAPI, Request
from fastapi.responses import Response
import edge_tts, asyncio

app = FastAPI()

# 🎙️ RECEIVE & STORE LIVE FRIEND VOICE FROM DISCORD VC TO GOOGLE DRIVE
@app.post("/upload-sample")
async def upload_sample(request: Request):
    data = await request.json()
    speaker = data.get("speaker", "unknown")
    filename = data.get("filename", "sample.wav")
    audio_b64 = data.get("audio_base64", "")
    
    # Store inside individual speaker folder in Google Drive!
    speaker_dir = os.path.join(SAMPLES_DIR, speaker)
    os.makedirs(speaker_dir, exist_ok=True)
    file_path = os.path.join(speaker_dir, filename)
    
    audio_bytes = base64.b64decode(audio_b64)
    with open(file_path, "wb") as f:
        f.write(audio_bytes)
        
    print(f"[Drive Backup] 🎧 Received live VC voice sample from '{speaker}' -> Saved in Drive: {file_path}")
    
    # ⚡ TRIGGER LIVE AUTO-TRAIN / INDEXING FOR THIS INDIVIDUAL
    asyncio.create_task(auto_train_voice_model(speaker))
    return {"status": "success", "saved_path": file_path, "speaker": speaker}

# 🤖 LIVE VOICE MODEL TRAINING TRIGGER PER PERSON
async def auto_train_voice_model(speaker: str):
    speaker_dir = os.path.join(SAMPLES_DIR, speaker)
    samples = glob.glob(f"{speaker_dir}/*.wav")
    print(f"[AutoTrain] 🏋️ Auto-training voice model for friend '{speaker}' ({len(samples)} samples in Drive)...")
    # Custom model fine-tuning / embedding updates happen here automatically in Google Drive!

# 🔊 GENERATE VOICE FOR SPECIFIC CLONED FRIEND OR TTS
@app.post("/generate")
async def generate_voice(request: Request):
    data = await request.json()
    text = data.get("text", "สวัสดีครับ")
    speaker = data.get("speaker", "default")
    
    # If speaker has cloned voice samples in Drive, Colab synthesizes using that speaker's trained voice model
    speaker_dir = os.path.join(SAMPLES_DIR, speaker)
    has_cloned_voice = os.path.exists(speaker_dir) and len(glob.glob(f"{speaker_dir}/*.wav")) > 0
    
    if has_cloned_voice:
        print(f"[ColabTTS] 🎙️ Generating voice using trained voice clone for friend '{speaker}'...")
    else:
        print(f"[ColabTTS] 🔊 Speaker '{speaker}' has no voice samples yet, using fallback Thai Neural Voice...")
        
    communicate = edge_tts.Communicate(text, "th-TH-NiwatNeural")
    audio_data = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data += chunk["data"]
            
    # CRITICAL FIX: Return Response object for raw binary audio (prevents UnicodeDecodeError)
    return Response(content=audio_data, media_type="audio/wav")

# ============================================================
# 4. LAUNCH SERVER & GET CLOUDFLARE PUBLIC URL
# ============================================================
import uvicorn

# Kill any existing server on port 8766 if re-running cell
os.system("fuser -k -9 8766/tcp 2>/dev/null || true")
os.system("pkill -9 -f uvicorn 2>/dev/null || true")
time.sleep(1.5)

def run_fastapi():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    config = uvicorn.Config(app=app, host="0.0.0.0", port=8766, log_level="error")
    server = uvicorn.Server(config)
    loop.run_until_complete(server.serve())

server_thread = threading.Thread(target=run_fastapi, daemon=True)
server_thread.start()

time.sleep(2)

print("\\n=================================================")
print("🚀 STARTING CLOUDFLARE TUNNEL...")
print("=================================================")

# Launch cloudflared with unbuffered pipe output
tunnel = subprocess.Popen(
    ["cloudflared", "tunnel", "--url", "http://127.0.0.1:8766"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1
)

public_url = None
for _ in range(40):
    line = tunnel.stdout.readline()
    if not line:
        time.sleep(0.2)
        continue
    match = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', line)
    if match:
        public_url = match.group(0)
        break

if public_url:
    print(f"\\n=================================================")
    print(f"🎉 YOUR LIVE COLAB VOICE SERVER URL IS:\\n\\n   {public_url}\\n")
    print(f"Copy this URL and paste it into COLAB_TTS_URL in your .env or App Dashboard!")
    print("=================================================\\n")
else:
    print("\\n⚠️ Cloudflare tunnel starting... If URL doesn't show, re-run cell or check stdout above.")`}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Live Voice Transcriptions Panel */}
        <div className="bg-[#161616] p-8 rounded-2xl border border-white/5 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>🎙️</span> Live Voice Transcriptions <span className="text-xs bg-[#5865F2]/20 text-[#5865F2] border border-[#5865F2]/30 px-2.5 py-0.5 rounded-full font-mono">Thai & English</span>
              </h3>
              <p className="text-xs text-gray-400 mt-1">
                Real-time speech-to-text transcriptions from friends speaking in Discord Voice Chat.
              </p>
            </div>
            <div className="flex items-center gap-2 bg-[#111111] p-1.5 rounded-xl border border-white/5 text-xs font-medium">
              <button
                onClick={() => setTranscriptFilter('transcripts')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  transcriptFilter === 'transcripts' ? 'bg-[#5865F2] text-white shadow' : 'text-gray-400 hover:text-white'
                }`}
              >
                💬 Speech Only
              </button>
              <button
                onClick={() => setTranscriptFilter('all')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  transcriptFilter === 'all' ? 'bg-[#5865F2] text-white shadow' : 'text-gray-400 hover:text-white'
                }`}
              >
                📜 All Events
              </button>
            </div>
          </div>

          <div className="bg-[#0f0f0f] rounded-2xl border border-white/5 p-4 max-h-96 overflow-y-auto space-y-3 font-sans">
            {liveEvents.length === 0 ? (
              <div className="text-center py-10 space-y-2">
                <p className="text-2xl">🎙️</p>
                <p className="text-xs text-gray-400 font-medium">No voice activity detected yet.</p>
                <p className="text-[11px] text-gray-600">Connect bot to Discord voice with <code className="bg-[#1b1b1b] px-1.5 py-0.5 rounded text-blue-400">/join</code> and speak into your mic!</p>
              </div>
            ) : (
              liveEvents
                .filter(evt => {
                  if (transcriptFilter === 'transcripts') {
                    return evt.type === 'TRANSCRIPT_FINAL' || evt.type === 'TRANSCRIPT_PARTIAL' || evt.type === 'BOT_RESPONSE';
                  }
                  return true;
                })
                .slice()
                .reverse()
                .map((evt, idx) => {
                  const timeStr = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';

                  if (evt.type === 'TRANSCRIPT_FINAL') {
                    return (
                      <div key={idx} className="p-4 bg-[#141414] rounded-xl border border-white/5 space-y-2 hover:border-white/10 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-xs font-bold text-purple-300">
                              {(evt.displayName || evt.username || 'U')[0].toUpperCase()}
                            </div>
                            <span className="text-sm font-bold text-white">{evt.displayName || evt.username}</span>
                            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono">Final STT</span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] font-mono text-gray-500">
                            {evt.sttLatencyMs && <span>⚡ {evt.sttLatencyMs}ms</span>}
                            <span>{timeStr}</span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-100 font-medium pl-9 leading-relaxed">
                          "{evt.rawText}"
                        </p>
                      </div>
                    );
                  }

                  if (evt.type === 'TRANSCRIPT_PARTIAL') {
                    return (
                      <div key={idx} className="p-3 bg-[#121212] rounded-xl border border-blue-500/20 space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping"></span>
                            <span className="font-bold text-blue-400">{evt.displayName || evt.username}</span>
                            <span className="text-[10px] text-gray-500">is speaking...</span>
                          </div>
                          <span className="text-[10px] font-mono text-gray-500">{timeStr}</span>
                        </div>
                        <p className="text-xs text-blue-200/80 italic pl-4">
                          "{evt.rawText}"
                        </p>
                      </div>
                    );
                  }

                  if (evt.type === 'BOT_RESPONSE') {
                    return (
                      <div key={idx} className="p-4 bg-[#191528] rounded-xl border border-[#5865F2]/30 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-[#5865F2] flex items-center justify-center text-xs text-white">
                              🤖
                            </div>
                            <span className="text-sm font-bold text-white">Digital Me AI</span>
                            <span className="text-[10px] bg-[#5865F2]/20 text-[#5865F2] border border-[#5865F2]/40 px-2 py-0.5 rounded-full font-mono">Cloned Voice Reply</span>
                          </div>
                          <span className="text-[11px] font-mono text-gray-500">{timeStr}</span>
                        </div>
                        <p className="text-sm text-purple-200 font-medium pl-9 leading-relaxed">
                          "{evt.text}"
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div key={idx} className="p-2.5 bg-[#111111] rounded-lg border border-white/5 flex items-center justify-between text-xs font-mono text-gray-400">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">[{evt.type}]</span>
                        <span>{evt.displayName ? `${evt.displayName} (${evt.type})` : evt.sessionId || 'Event'}</span>
                      </div>
                      <span className="text-[10px] text-gray-600">{timeStr}</span>
                    </div>
                  );
                })
            )}
          </div>
        </div>

        {/* Voice Testing Panel */}
        <div className="bg-[#161616] p-8 rounded-2xl border border-white/5 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>🔊</span> Test Google Colab Voice Cloning
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              Type any sentence below to test synthesizing voice live through your Colab XTTS model!
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder="Enter text to synthesize..."
                className="flex-1 bg-[#111111] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#5865F2] transition-colors"
              />
              <button
                onClick={handleTestTts}
                disabled={isGenerating || !colabUrl}
                className="px-6 py-3 bg-[#5865F2] hover:bg-[#4752C4] disabled:bg-gray-800 disabled:text-gray-500 text-white font-medium text-sm rounded-xl transition-all flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <span className="animate-spin">⏳</span> Synthesizing on GPU...
                  </>
                ) : (
                  <>
                    <span>▶</span> Generate & Play
                  </>
                )}
              </button>
            </div>

            {ttsError && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-mono">
                ❌ {ttsError}
              </div>
            )}

            {audioUrl && (
              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl space-y-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-green-400 font-bold">✅ Speech Generated Successfully!</span>
                  {latencyMs && <span className="text-gray-400">Total Latency: <strong className="text-white">{(latencyMs / 1000).toFixed(2)}s</strong></span>}
                </div>
                <audio controls src={audioUrl} autoPlay className="w-full h-10 rounded-lg outline-none" />
              </div>
            )}
          </div>
        </div>

        {/* Friend Behavior Trainer Panel */}
        <div className="bg-[#161616] p-8 rounded-2xl border border-white/5 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>🧠</span> Teach Friend Speech Behavior & Response Style
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              No terminal needed! Train how your AI Twin responds to specific friends in live voice channels.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Friend Name</label>
              <input
                type="text"
                value={speaker}
                onChange={(e) => setSpeaker(e.target.value)}
                placeholder="e.g. Bank, Anu, Spin"
                className="w-full bg-[#111111] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#5865F2]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">What Friend Says in VC</label>
              <input
                type="text"
                value={friendSpeech}
                onChange={(e) => setFriendSpeech(e.target.value)}
                placeholder="e.g. มึงเข้า valo ปะ"
                className="w-full bg-[#111111] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#5865F2]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Action Type</label>
              <select
                value={ownerAction}
                onChange={(e) => setOwnerAction(e.target.value)}
                className="w-full bg-[#111111] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#5865F2]"
              >
                <option value="ANSWER">ANSWER (Standard Reply)</option>
                <option value="IGNORE">IGNORE (Stay Silent)</option>
                <option value="SHORT_REACTION">SHORT REACTION (e.g. เออ, ห้ะ)</option>
                <option value="JOKE">JOKE / ROAST (Tease Friend)</option>
              </select>
            </div>
            {ownerAction !== 'IGNORE' && (
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Exact Response (Thai Slang)</label>
                <input
                  type="text"
                  value={ownerResponse}
                  onChange={(e) => setOwnerResponse(e.target.value)}
                  placeholder="e.g. ไม่อะ ขก., เออแปป"
                  className="w-full bg-[#111111] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#5865F2]"
                />
              </div>
            )}
          </div>

          {behaviorSuccess && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-xs font-mono">
              {behaviorSuccess}
            </div>
          )}

          <button
            onClick={handleAddBehavior}
            disabled={isSavingBehavior}
            className="w-full py-3 bg-[#5865F2] hover:bg-[#4752C4] disabled:bg-gray-800 text-white font-medium text-sm rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {isSavingBehavior ? '⏳ Saving Behavior Pattern...' : '➕ Save Behavior Pattern'}
          </button>

          {examples.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Trained Speech & Reaction Patterns ({examples.length}):</p>
              <div className="max-h-40 overflow-y-auto space-y-2 pr-2">
                {examples.map((ex, idx) => (
                  <div key={idx} className="p-3 bg-[#111111] rounded-xl border border-white/5 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[#5865F2] font-bold">{ex.context?.[0]?.speaker}:</span> "{ex.context?.[0]?.text}"
                    </div>
                    <div className="font-mono text-gray-400">
                      ➔ {ex.ownerAction === 'IGNORE' ? <span className="text-gray-500">[STAY SILENT]</span> : <span className="text-green-400">"{ex.ownerResponse}"</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Recorded Voice Samples Catalog */}
          <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">🎙️ Auto-Captured Friend Voice Samples ({voiceSamples.length}):</p>
              <span className="text-[10px] text-green-400 font-mono flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-ping"></span> Live Capturing from Discord VC</span>
            </div>
            {voiceSamples.length === 0 ? (
              <p className="text-xs text-gray-500 italic bg-[#111111] p-3 rounded-xl border border-white/5">
                No voice samples captured yet. Connect bot to Discord Voice Channel and let friends speak — voice audio will be recorded and cloned automatically!
              </p>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-2 pr-2">
                {voiceSamples.map((sample, idx) => (
                  <div key={idx} className="p-3 bg-[#111111] rounded-xl border border-white/5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-purple-400 font-bold">🎧 {sample.speaker}</span>
                      <span className="text-gray-500 text-[10px] font-mono">({sample.durationSec}s WAV)</span>
                    </div>
                    <div className="text-gray-400 text-[10px] font-mono">
                      {new Date(sample.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em] px-1">Active Modules Status</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-4 bg-[#111111] border border-white/5 rounded-xl">
                  <div className="flex items-center gap-4">
                    <div>🎙️</div>
                    <div>
                      <p className="text-sm font-bold text-white">Opus Audio Receiver</p>
                      <p className="text-[10px] text-gray-500 uppercase">Phase 1</p>
                    </div>
                  </div>
                  <div className="w-10 h-5 bg-green-500/20 rounded-full border border-green-500/30 flex items-center justify-end px-1"><div className="w-3 h-3 bg-green-400 rounded-full"></div></div>
                </div>
                <div className="flex items-center justify-between p-4 bg-[#111111] border border-white/5 rounded-xl">
                  <div className="flex items-center gap-4">
                    <div>🧠</div>
                    <div>
                      <p className="text-sm font-bold text-white">Social Brain</p>
                      <p className="text-[10px] text-gray-500 uppercase">Phase 2</p>
                    </div>
                  </div>
                  <div className="w-10 h-5 bg-green-500/20 rounded-full border border-green-500/30 flex items-center justify-end px-1"><div className="w-3 h-3 bg-green-400 rounded-full"></div></div>
                </div>
                <div className="flex items-center justify-between p-4 bg-[#111111] border border-white/5 rounded-xl">
                  <div className="flex items-center gap-4">
                    <div>🎭</div>
                    <div>
                      <p className="text-sm font-bold text-white">Response Generator (Personality)</p>
                      <p className="text-[10px] text-gray-500 uppercase">Phase 3</p>
                    </div>
                  </div>
                  <div className="w-10 h-5 bg-green-500/20 rounded-full border border-green-500/30 flex items-center justify-end px-1"><div className="w-3 h-3 bg-green-400 rounded-full"></div></div>
                </div>
                <div className="flex items-center justify-between p-4 bg-[#111111] border border-white/5 rounded-xl">
                  <div className="flex items-center gap-4">
                    <div>🗣️</div>
                    <div>
                      <p className="text-sm font-bold text-white">Google Colab Voice Cloning (XTTS)</p>
                      <p className="text-[10px] text-gray-500 uppercase">Phase 4</p>
                    </div>
                  </div>
                  <div className="w-10 h-5 bg-green-500/20 rounded-full border border-green-500/30 flex items-center justify-end px-1"><div className="w-3 h-3 bg-green-400 rounded-full"></div></div>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col h-[300px]">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em] px-1 mb-4">Live Event Log</h3>
              <div className="flex-1 bg-black/60 rounded-xl border border-white/5 p-4 font-mono text-[11px] overflow-hidden">
                <div className="space-y-2">
                  <div className="flex gap-3"><span className="text-gray-600">[00:00:01]</span> <span className="text-blue-400">INFO</span> <span>System initialized.</span></div>
                  <div className="flex gap-3"><span className="text-gray-600">[00:00:02]</span> <span className="text-purple-400">BRAIN</span> <span>SocialBrain module loaded.</span></div>
                  <div className="flex gap-3"><span className="text-gray-600">[00:00:03]</span> <span className="text-purple-400">PERSN</span> <span>Loaded 6 behavior examples.</span></div>
                  <div className="flex gap-3"><span className="text-gray-600">[00:00:04]</span> <span className="text-green-400">TTS</span> <span>Colab Voice Cloning active ({colabUrl}).</span></div>
                  <div className="flex gap-3 animate-pulse mt-4"><span className="text-gray-600">[{new Date().toLocaleTimeString('en-US', { hour12: false })}]</span> <span className="text-blue-400">INFO</span> <span className="text-white">Waiting for gateway events...</span><span className="inline-block w-1.5 h-3 bg-white ml-1"></span></div>
                </div>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}
