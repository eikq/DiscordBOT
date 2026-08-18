/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';

type CloudExportSelections = {
  includeDataset: boolean;
  includeTranscripts: boolean;
  includeBestModel: boolean;
  includeLatestModel: boolean;
  includeTrainingLogs: boolean;
  includeTrainer: boolean;
  cleanAudio: boolean;
  excludeLowQuality: boolean;
};

type TrainingTarget = 'vast_24gb' | 'laptop_4050_6gb';

type CloudExportResult = {
  filename: string;
  sizeBytes: number;
  sha256: string;
  commandScript: string;
  pasteCommand: string;
};

type VoiceChangerMode = 'speech' | 'vocal' | 'song';
type VoiceChangerOutput = 'browser' | 'discord' | 'both';
type VoiceChangerProgress = {
  status: 'uploading' | 'processing' | 'complete' | 'failed';
  progress: number;
  elapsedSeconds: number;
  estimatedRemainingSeconds: number | null;
  estimatedTotalSeconds: number | null;
  sourceDurationSeconds: number;
  estimated: boolean;
  error?: string | null;
};

const formatShortDuration = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) return 'finishing';
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  return minutes > 0 ? `${minutes}:${String(whole % 60).padStart(2, '0')}` : `${whole}s`;
};

const supportedAudioExtension = (name: string, mimeType = '') => {
  const match = name.toLowerCase().match(/\.(wav|mp3|flac|m4a|aac|ogg|opus|webm)$/);
  if (match) return `.${match[1]}`;
  const mimeExtensions: Record<string, string> = {
    'audio/aac': '.aac',
    'audio/flac': '.flac',
    'audio/mp4': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/wav': '.wav',
    'audio/webm': '.webm',
  };
  return mimeExtensions[mimeType.split(';', 1)[0].toLowerCase()] || '.wav';
};

const JarvisCore = ({ phase, ready }: { phase: string; ready: boolean }) => {
  const normalizedPhase = ['thinking', 'researching', 'composing'].includes(phase) ? 'active' : phase;
  return (
    <div
      className={`jarvis-core jarvis-core--${ready ? normalizedPhase : 'offline'}`}
      role="img"
      aria-label={`Local intelligence core ${ready ? phase : 'offline'}`}
    >
      <span className="jarvis-core__halo" />
      <span className="jarvis-core__ring jarvis-core__ring--outer" />
      <span className="jarvis-core__ring jarvis-core__ring--middle" />
      <span className="jarvis-core__ring jarvis-core__ring--inner" />
      <span className="jarvis-core__scanner" />
      <span className="jarvis-core__nucleus">DM</span>
    </div>
  );
};

const encodePcm16Wav = (samples: Float32Array, sampleRate: number) => {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
};

const shellSingleQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
const powershellSingleQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

const buildVastPasteCommand = (
  filename: string,
  sizeBytes: number,
  sha256: string,
  commandScript: string,
) => {
  const bundleDirectory = filename.replace(/\.zip$/i, '');
  const runDirectory = `/workspace/${bundleDirectory}-run`;
  return `cd /workspace
ARCHIVE=${shellSingleQuote(filename)}
EXPECTED_SIZE=${sizeBytes}
EXPECTED_SHA256=${shellSingleQuote(sha256.toLowerCase())}
RUN_DIR=${shellSingleQuote(runDirectory)}

test -f "$ARCHIVE" || { echo "ERROR: Upload $ARCHIVE to /workspace first."; exit 1; }
test "$(stat -c%s "$ARCHIVE")" -eq "$EXPECTED_SIZE" || { echo "ERROR: Upload is incomplete. Expected $EXPECTED_SIZE bytes."; exit 1; }
echo "$EXPECTED_SHA256  $ARCHIVE" | sha256sum -c -
if ! command -v unzip >/dev/null || ! command -v tmux >/dev/null; then
  apt-get update && apt-get install -y unzip tmux
fi
mkdir -p "$RUN_DIR"
unzip -oq "$ARCHIVE" -d "$RUN_DIR"
cd "$RUN_DIR/${bundleDirectory}"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

if [ -n "\${TMUX:-}" ]; then
  bash ./${commandScript}
else
  tmux new-session -A -s digitalme "cd '$PWD' && bash './${commandScript}'"
fi`;
};

const buildLaptopPasteCommand = (
  filename: string,
  sizeBytes: number,
  sha256: string,
  commandScript: string,
) => {
  const bundleDirectory = filename.replace(/\.zip$/i, '');
  const downloadRelativePath = `Downloads\\${filename}`;
  const runRelativePath = `Downloads\\DigitalMeTraining\\${bundleDirectory}-run`;
  return `$Archive = Join-Path ([Environment]::GetFolderPath('UserProfile')) ${powershellSingleQuote(downloadRelativePath)}
$ExpectedSize = ${sizeBytes}
$ExpectedSha256 = ${powershellSingleQuote(sha256.toLowerCase())}
$RunDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) ${powershellSingleQuote(runRelativePath)}
$BundleDirectory = ${powershellSingleQuote(bundleDirectory)}

if (-not (Test-Path -LiteralPath $Archive)) { throw 'Download ${filename} first, or change the $Archive path on line 1.' }
if ((Get-Item -LiteralPath $Archive).Length -ne $ExpectedSize) { throw "The ZIP download is incomplete. Expected $ExpectedSize bytes." }
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256) { throw 'The ZIP SHA-256 does not match the completed export.' }
New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
Expand-Archive -LiteralPath $Archive -DestinationPath $RunDir -Force
Set-Location -LiteralPath (Join-Path $RunDir $BundleDirectory)
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
powershell -NoProfile -ExecutionPolicy Bypass -File ${powershellSingleQuote(`.\\${commandScript}`)}`;
};

export default function App() {
  const [status, setStatus] = useState<string>('Loading...');
  const [colabUrl, setColabUrl] = useState<string | null>(null);
  const [recordRawAudio, setRecordRawAudio] = useState<boolean>(false);
  const [colabAuthenticated, setColabAuthenticated] = useState<boolean>(false);
  const [intelligenceStatus, setIntelligenceStatus] = useState<any>(null);
  const [researchQuery, setResearchQuery] = useState<string>('วันนี้มีข่าวเทคโนโลยีหรือ AI อะไรสำคัญบ้าง สรุปพร้อมแหล่งอ้างอิง');
  const [researchResult, setResearchResult] = useState<any>(null);
  const [researchBusy, setResearchBusy] = useState<boolean>(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  
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
  const [personaUserId, setPersonaUserId] = useState<string>('');
  const [personaName, setPersonaName] = useState<string>('');
  const [personaAliases, setPersonaAliases] = useState<string>('');
  const [personaDescription, setPersonaDescription] = useState<string>('');
  const [personaSuccess, setPersonaSuccess] = useState<string | null>(null);
  const [isSavingPersona, setIsSavingPersona] = useState<boolean>(false);
  const [discordTokenInput, setDiscordTokenInput] = useState<string>('');
  const [isConnectingBot, setIsConnectingBot] = useState<boolean>(false);
  const [isSyncingDrive, setIsSyncingDrive] = useState<boolean>(false);
  const [hasSyncedDrive, setHasSyncedDrive] = useState<boolean>(() => {
    return localStorage.getItem('has_synced_drive') === 'true';
  });
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  const [transcriptFilter, setTranscriptFilter] = useState<'transcripts' | 'all'>('transcripts');
  const [controlState, setControlState] = useState<any>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string>('');
  const [selectedVoiceChannelId, setSelectedVoiceChannelId] = useState<string>('');
  const [selectedTextChannelId, setSelectedTextChannelId] = useState<string>('');
  const [selectedControlUserId, setSelectedControlUserId] = useState<string>('');
  const [dashboardSpeakText, setDashboardSpeakText] = useState<string>('แก้ม พร้อมเล่นเกมยัง');
  const [playbackModelSelection, setPlaybackModelSelection] = useState<'best' | 'latest'>('best');
  const [playbackModelVersionId, setPlaybackModelVersionId] = useState<string>('');
  const [modelPreviewText, setModelPreviewText] = useState<string>('แก้ม พร้อมเล่นเกมยัง');
  const [modelPreviewBusy, setModelPreviewBusy] = useState<boolean>(false);
  const [modelPreviewAudioUrl, setModelPreviewAudioUrl] = useState<string | null>(null);
  const [modelPreviewMessage, setModelPreviewMessage] = useState<string | null>(null);
  const [trainingMode, setTrainingMode] = useState<'fresh' | 'finetune'>('fresh');
  const [trainingModelSelection, setTrainingModelSelection] = useState<'best' | 'latest'>('best');
  const [trainingEpochs, setTrainingEpochs] = useState<number>(100);
  const [showCloudExport, setShowCloudExport] = useState<boolean>(false);
  const [trainingTarget, setTrainingTarget] = useState<TrainingTarget>('vast_24gb');
  const [cloudTrainingMode, setCloudTrainingMode] = useState<'fresh' | 'finetune'>('finetune');
  const [cloudModelSelection, setCloudModelSelection] = useState<'best' | 'latest'>('best');
  const [cloudTrainingEpochs, setCloudTrainingEpochs] = useState<number>(30);
  const [cloudExportSelections, setCloudExportSelections] = useState<CloudExportSelections>({
    includeDataset: true,
    includeTranscripts: true,
    includeBestModel: true,
    includeLatestModel: true,
    includeTrainingLogs: true,
    includeTrainer: true,
    cleanAudio: true,
    excludeLowQuality: true,
  });
  const [cloudExportPreview, setCloudExportPreview] = useState<any>(null);
  const [cloudExportBusy, setCloudExportBusy] = useState<'preview' | 'export' | null>(null);
  const [cloudExportMessage, setCloudExportMessage] = useState<string | null>(null);
  const [cloudExportResult, setCloudExportResult] = useState<CloudExportResult | null>(null);
  const [cloudCommandCopied, setCloudCommandCopied] = useState<boolean>(false);
  const [controlBusy, setControlBusy] = useState<string | null>(null);
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const [brainState, setBrainState] = useState<any>(null);
  const [brainQuery, setBrainQuery] = useState<string>('');
  const [voiceChangerMode, setVoiceChangerMode] = useState<VoiceChangerMode>('speech');
  const [voiceChangerOutput, setVoiceChangerOutput] = useState<VoiceChangerOutput>('browser');
  const [voiceChangerModel, setVoiceChangerModel] = useState<'best' | 'latest'>('best');
  const [voiceChangerVersionId, setVoiceChangerVersionId] = useState<string>('');
  const [voiceChangerF0Shift, setVoiceChangerF0Shift] = useState<number>(0);
  const [voiceChangerVocalBoostDb, setVoiceChangerVocalBoostDb] = useState<number>(3);
  const [voiceChangerFile, setVoiceChangerFile] = useState<File | null>(null);
  const [voiceChangerFileDuration, setVoiceChangerFileDuration] = useState<number>(0);
  const [voiceChangerSourceUrl, setVoiceChangerSourceUrl] = useState<string | null>(null);
  const [voiceChangerResultUrl, setVoiceChangerResultUrl] = useState<string | null>(null);
  const [voiceChangerResultName, setVoiceChangerResultName] = useState<string>('gam-voice-changed.wav');
  const [voiceChangerBusy, setVoiceChangerBusy] = useState<boolean>(false);
  const [voiceChangerMessage, setVoiceChangerMessage] = useState<string | null>(null);
  const [voiceChangerProgress, setVoiceChangerProgress] = useState<VoiceChangerProgress | null>(null);
  const [liveChangerActive, setLiveChangerActive] = useState<boolean>(false);
  const [liveChangerQueued, setLiveChangerQueued] = useState<number>(0);
  const [liveChangerMessage, setLiveChangerMessage] = useState<string>('Ready. Use headphones, then start the microphone.');
  const [microphoneSystemBlocked, setMicrophoneSystemBlocked] = useState<boolean>(false);
  const liveChangerActiveRef = useRef(false);
  const liveAudioContextRef = useRef<AudioContext | null>(null);
  const liveMediaStreamRef = useRef<MediaStream | null>(null);
  const liveSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const liveProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const liveMuteGainRef = useRef<GainNode | null>(null);
  const liveChunksRef = useRef<Float32Array[]>([]);
  const liveFrameCountRef = useRef(0);
  const liveQueueDepthRef = useRef(0);
  const liveConversionChainRef = useRef<Promise<void>>(Promise.resolve());
  const livePlaybackEndRef = useRef(0);
  const liveHasScheduledAudioRef = useRef(false);
  const controlRefreshInFlightRef = useRef(false);
  const dashboardDataRefreshInFlightRef = useRef(false);

  const handleSyncDrive = async () => {
    if (hasSyncedDrive) return;
    setIsSyncingDrive(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/voice-samples/sync-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('has_synced_drive', 'true');
        setHasSyncedDrive(true);
        setSyncResult(`✅ Synced ${data.syncedCount} samples into the local voice service!`);
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
        if (data.voiceServiceUrl || data.colabUrl) setColabUrl(data.voiceServiceUrl || data.colabUrl);
        setColabAuthenticated(data.voiceServiceAuthenticated === true || data.colabAuthenticated === true);
        setRecordRawAudio(data.privacy?.recordRawAudio === true);
      })
      .catch(() => setStatus('Error fetching status'));

    fetch('/api/personas')
      .then(res => res.json())
      .then(data => {
        const userId = data.defaultPersonaUserId || data.profiles?.[0]?.userId || '';
        const profile = data.profiles?.find((item: any) => item.userId === userId) || data.profiles?.[0];
        setPersonaUserId(userId);
        if (profile) {
          setPersonaName(profile.displayName || '');
          setPersonaAliases(Array.isArray(profile.aliases) ? profile.aliases.join(', ') : '');
          setPersonaDescription(profile.description || '');
        }
      })
      .catch(() => {});

    fetch('/api/brain')
      .then(res => res.json())
      .then(data => { if (!data.error) setBrainState(data); })
      .catch(() => {});

    const loadControl = () => {
      if (document.visibilityState === 'hidden' || controlRefreshInFlightRef.current) return;
      controlRefreshInFlightRef.current = true;
      fetch('/api/control')
        .then(res => res.json())
        .then(data => {
          if (!data.error) {
            setControlState(data);
            const guild = data.guilds?.find((item: any) => item.id === selectedGuildId) || data.guilds?.[0];
            if (guild) {
              setSelectedGuildId(current => current || guild.id);
              setSelectedVoiceChannelId(current => current || guild.connectedVoiceChannelId || guild.voiceChannels?.[0]?.id || '');
              setSelectedTextChannelId(current => current || guild.notificationChannels?.[0]?.id || guild.textChannels?.[0]?.id || '');
              setSelectedControlUserId(current => current || guild.selectedVoiceId || guild.members?.[0]?.id || '');
            }
          }
        })
        .catch(() => {})
        .finally(() => { controlRefreshInFlightRef.current = false; });
    };
    loadControl();
    const controlInterval = setInterval(loadControl, 3000);

    const loadData = () => {
      if (document.visibilityState === 'hidden' || dashboardDataRefreshInFlightRef.current) return;
      dashboardDataRefreshInFlightRef.current = true;
      Promise.all([
        fetch('/api/behavior').then(res => res.json()),
        fetch('/api/voice-samples').then(res => res.json()),
        fetch('/api/transcripts').then(res => res.json()),
        fetch('/api/intelligence/status').then(res => res.json()),
      ])
        .then(([behavior, samples, transcripts, intelligence]) => {
          if (behavior.examples) setExamples(behavior.examples);
          if (samples.samples) setVoiceSamples(samples.samples);
          if (transcripts.events) setLiveEvents(transcripts.events);
          if (!intelligence.error) setIntelligenceStatus(intelligence);
        })
        .catch(() => {})
        .finally(() => { dashboardDataRefreshInFlightRef.current = false; });
    };

    loadData();
    const interval = setInterval(loadData, 3000);
    return () => {
      clearInterval(interval);
      clearInterval(controlInterval);
    };
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

  const handleResearch = async () => {
    if (!researchQuery.trim() || researchBusy) return;
    setResearchBusy(true);
    setResearchError(null);
    setResearchResult(null);
    try {
      const response = await fetch('/api/intelligence/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: researchQuery.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || `Research failed with HTTP ${response.status}.`);
      setResearchResult(data);
      const latestStatus = await fetch('/api/intelligence/status').then(result => result.json());
      if (!latestStatus.error) setIntelligenceStatus(latestStatus);
    } catch (error: any) {
      setResearchError(error.message || String(error));
    } finally {
      setResearchBusy(false);
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
          personaUserId: personaUserId.trim() || undefined,
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

  const handleSavePersona = async () => {
    if (!personaUserId.trim() || !personaName.trim()) {
      alert('Discord user ID and persona name are required.');
      return;
    }
    setIsSavingPersona(true);
    setPersonaSuccess(null);
    try {
      const res = await fetch('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'persona',
          guildId: selectedGuildId,
          userId: personaUserId.trim(),
          name: personaName.trim(),
          aliases: personaAliases.split(',').map(alias => alias.trim()).filter(Boolean),
          description: personaDescription.trim(),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');
      setPersonaAliases(data.data.aliases.join(', '));
      setSelectedControlUserId(data.data.userId);
      setPersonaSuccess(`✅ Active cloned identity saved and selected as ${data.data.displayName}.`);
      setTimeout(() => setPersonaSuccess(null), 4000);
    } catch (error: any) {
      alert('Failed to save persona: ' + error.message);
    } finally {
      setIsSavingPersona(false);
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
          body: JSON.stringify({
            text: testText,
            speakerId: selectedControlUserId || undefined,
            modelSelection: playbackModelSelection,
            modelVersionId: playbackModelVersionId || undefined,
          }),
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

  const refreshControl = async () => {
    const [controlResponse, brainResponse] = await Promise.all([
      fetch('/api/control'),
      fetch(`/api/brain${brainQuery.trim() ? `?q=${encodeURIComponent(brainQuery.trim())}` : ''}`),
    ]);
    const control = await controlResponse.json();
    const brain = await brainResponse.json();
    if (!control.error) setControlState(control);
    if (!brain.error) setBrainState(brain);
  };

  const runDashboardCommand = async (command: string, extra: Record<string, any> = {}) => {
    const key = `${command}:${extra.action || ''}`;
    setControlBusy(key);
    setControlMessage(null);
    try {
      const response = await fetch('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          guildId: selectedGuildId,
          voiceChannelId: selectedVoiceChannelId,
          textChannelId: selectedTextChannelId,
          userId: selectedControlUserId,
          ...extra,
        }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Command failed.');
      setControlMessage(`✅ ${data.message}`);
      await refreshControl();
    } catch (error: any) {
      setControlMessage(`❌ ${error.message}`);
    } finally {
      setControlBusy(null);
    }
  };

  const previewPlaybackModel = async () => {
    if (!selectedControlUserId || !modelPreviewText.trim()) return;
    setModelPreviewBusy(true);
    setModelPreviewMessage(null);
    if (modelPreviewAudioUrl) URL.revokeObjectURL(modelPreviewAudioUrl);
    setModelPreviewAudioUrl(null);
    try {
      const seedBytes = new TextEncoder().encode(`${selectedControlUserId}:${modelPreviewText.trim()}`);
      const seedDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', seedBytes));
      const previewSeed = Array.from(seedDigest.slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('');
      const response = await fetch('/api/tts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: modelPreviewText.trim(),
          speakerId: selectedControlUserId,
          modelSelection: playbackModelSelection,
          modelVersionId: playbackModelVersionId || undefined,
          variationSeed: `dashboard-ab:${previewSeed}`,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      setModelPreviewAudioUrl(url);
      const version = selectedVoiceStatus?.modelVersions?.find((item: any) => item.id === playbackModelVersionId);
      setModelPreviewMessage(`Playing ${version?.label || 'selected model'} · ${playbackModelSelection === 'best' ? 'Best' : 'Latest'} in this browser. This does not change the active Discord voice.`);
    } catch (error: any) {
      setModelPreviewMessage(`❌ ${error.message}`);
    } finally {
      setModelPreviewBusy(false);
    }
  };

  const requestVoiceConversion = async (
    audio: Blob,
    extension: string,
    mode: VoiceChangerMode,
    progressJob?: { id: string; sourceDurationSeconds: number },
  ) => {
    if (!selectedControlUserId) throw new Error('Choose the member whose trained voice you want to use.');
    const query = new URLSearchParams({
      speakerId: selectedControlUserId,
      modelSelection: voiceChangerModel,
      ...(voiceChangerVersionId ? { modelVersionId: voiceChangerVersionId } : {}),
      mode,
      f0Shift: String(voiceChangerF0Shift),
      vocalBoostDb: String(voiceChangerVocalBoostDb),
      output: voiceChangerOutput,
      ...(progressJob ? { jobId: progressJob.id } : {}),
      ...(voiceChangerOutput !== 'browser' ? {
        guildId: selectedGuildId,
        voiceChannelId: selectedVoiceChannelId,
      } : {}),
    });
    const response = await fetch(`/api/voice/convert?${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': audio.type || 'application/octet-stream',
        'X-Audio-Extension': extension,
        ...(progressJob ? { 'X-Source-Duration-Seconds': String(progressJob.sourceDurationSeconds || 0) } : {}),
      },
      body: audio,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(body.error || `Voice conversion failed with HTTP ${response.status}.`);
    }
    return {
      audio: await response.blob(),
      processingMs: Number(response.headers.get('x-voice-processing-ms') || 0),
      sourceDuration: Number(response.headers.get('x-voice-source-duration') || 0),
      modelSelection: response.headers.get('x-voice-model-selection') || voiceChangerModel,
      modelVersionId: response.headers.get('x-voice-model-version') || voiceChangerVersionId,
      discordQueuePosition: Number(response.headers.get('x-voice-discord-queued') || 0),
    };
  };

  const chooseVoiceChangerFile = (file: File | null) => {
    setVoiceChangerMessage(null);
    setVoiceChangerProgress(null);
    setVoiceChangerFile(null);
    setVoiceChangerFileDuration(0);
    setVoiceChangerSourceUrl(current => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setVoiceChangerResultUrl(current => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      setVoiceChangerMessage('❌ File is larger than the 100 MB local conversion limit.');
      return;
    }
    const extension = supportedAudioExtension(file.name, file.type);
    if (!/^\.(wav|mp3|flac|m4a|aac|ogg|opus|webm)$/.test(extension)) {
      setVoiceChangerMessage('❌ Use WAV, MP3, FLAC, M4A/AAC, OGG/Opus, or WebM audio.');
      return;
    }
    setVoiceChangerFile(file);
    setVoiceChangerSourceUrl(URL.createObjectURL(file));
  };

  const convertVoiceChangerFile = async () => {
    if (!voiceChangerFile) return;
    const jobId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setVoiceChangerBusy(true);
    setVoiceChangerMessage('Uploading audio and starting the local RVC job...');
    setVoiceChangerProgress({
      status: 'uploading',
      progress: 1,
      elapsedSeconds: 0,
      estimatedRemainingSeconds: null,
      estimatedTotalSeconds: null,
      sourceDurationSeconds: voiceChangerFileDuration,
      estimated: true,
    });
    setVoiceChangerResultUrl(current => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    const startedAt = performance.now();
    let progressTimer: number | null = null;
    const pollProgress = async () => {
      try {
        const response = await fetch(`/api/voice/convert/progress/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const progress = await response.json();
        const elapsedSeconds = Number(progress.elapsedSeconds || 0);
        const sourceDurationSeconds = Number(progress.sourceDurationSeconds || voiceChangerFileDuration || 0);
        let estimatedTotalSeconds = progress.estimatedTotalSeconds === null ? null : Number(progress.estimatedTotalSeconds);
        let estimatedRemainingSeconds = progress.estimatedRemainingSeconds === null ? null : Number(progress.estimatedRemainingSeconds);
        let displayProgress = Number(progress.progress || 0);
        if (progress.status === 'processing' && sourceDurationSeconds >= 30) {
          const longAudioEstimate = sourceDurationSeconds * 4 + 6;
          estimatedTotalSeconds = Math.max(estimatedTotalSeconds || 0, longAudioEstimate);
          if (elapsedSeconds >= estimatedTotalSeconds * 0.96) {
            estimatedTotalSeconds = Math.max(estimatedTotalSeconds, elapsedSeconds + Math.max(60, sourceDurationSeconds * 0.5));
          }
          estimatedRemainingSeconds = Math.max(1, estimatedTotalSeconds - elapsedSeconds);
          displayProgress = Math.min(96, Math.max(2, (elapsedSeconds / estimatedTotalSeconds) * 100));
        }
        setVoiceChangerProgress({
          status: progress.status,
          progress: displayProgress,
          elapsedSeconds,
          estimatedRemainingSeconds,
          estimatedTotalSeconds,
          sourceDurationSeconds,
          estimated: Boolean(progress.estimated),
          error: progress.error || null,
        });
        if (progress.status === 'processing') setVoiceChangerMessage('RVC is actively processing this file on the GPU.');
      } catch {}
    };
    progressTimer = window.setInterval(() => void pollProgress(), 1_000);
    try {
      const result = await requestVoiceConversion(
        voiceChangerFile,
        supportedAudioExtension(voiceChangerFile.name, voiceChangerFile.type),
        voiceChangerMode,
        { id: jobId, sourceDurationSeconds: voiceChangerFileDuration },
      );
      const resultUrl = URL.createObjectURL(result.audio);
      const sourceBase = voiceChangerFile.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60) || 'audio';
      setVoiceChangerResultUrl(resultUrl);
      setVoiceChangerProgress({
        status: 'complete',
        progress: 100,
        elapsedSeconds: (performance.now() - startedAt) / 1_000,
        estimatedRemainingSeconds: 0,
        estimatedTotalSeconds: (performance.now() - startedAt) / 1_000,
        sourceDurationSeconds: result.sourceDuration,
        estimated: false,
      });
      setVoiceChangerResultName(`${sourceBase}-${selectedControlUser?.name || 'clone'}-${result.modelSelection}.wav`.replace(/[^A-Za-z0-9_.-]+/g, '-'));
      setVoiceChangerMessage(
        `✅ Converted ${result.sourceDuration.toFixed(1)}s with ${result.modelSelection} in ${((performance.now() - startedAt) / 1000).toFixed(1)}s (RVC ${result.processingMs}ms)${result.discordQueuePosition ? ` and queued in Discord position ${result.discordQueuePosition}` : ''}.`,
      );
    } catch (error: any) {
      setVoiceChangerProgress(current => current ? { ...current, status: 'failed', error: error.message } : null);
      setVoiceChangerMessage(`❌ ${error.message}`);
    } finally {
      if (progressTimer !== null) window.clearInterval(progressTimer);
      setVoiceChangerBusy(false);
    }
  };

  const scheduleLiveVoicePlayback = async (audio: Blob) => {
    const context = liveAudioContextRef.current;
    if (!context || context.state === 'closed') return;
    if (context.state === 'suspended') await context.resume();
    const buffer = await context.decodeAudioData(await audio.arrayBuffer());
    const overlapSeconds = 0.18;
    const now = context.currentTime;
    const canOverlap = liveHasScheduledAudioRef.current && livePlaybackEndRef.current > now + 0.05;
    const startAt = canOverlap
      ? Math.max(now + 0.05, livePlaybackEndRef.current - overlapSeconds)
      : now + 0.08;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(context.destination);
    const fadeSeconds = Math.min(overlapSeconds, Math.max(0.025, buffer.duration / 6));
    gain.gain.setValueAtTime(canOverlap ? 0 : 1, startAt);
    if (canOverlap) gain.gain.linearRampToValueAtTime(1, startAt + fadeSeconds);
    const fadeOutAt = Math.max(startAt + fadeSeconds, startAt + buffer.duration - fadeSeconds);
    gain.gain.setValueAtTime(1, fadeOutAt);
    gain.gain.linearRampToValueAtTime(0, startAt + buffer.duration);
    source.start(startAt);
    livePlaybackEndRef.current = startAt + buffer.duration;
    liveHasScheduledAudioRef.current = true;
  };

  const queueLiveVoiceSegment = (samples: Float32Array, sampleRate: number) => {
    if (samples.length < Math.floor(sampleRate * 0.35)) return;
    if (liveQueueDepthRef.current >= 4) {
      setLiveChangerMessage('⚠️ The GPU is behind the microphone. One segment was skipped to keep latency bounded.');
      return;
    }
    const audio = encodePcm16Wav(samples, sampleRate);
    liveQueueDepthRef.current += 1;
    setLiveChangerQueued(liveQueueDepthRef.current);
    const capturedAt = performance.now();
    liveConversionChainRef.current = liveConversionChainRef.current
      .catch(() => {})
      .then(async () => {
        const result = await requestVoiceConversion(audio, '.wav', 'speech');
        if (voiceChangerOutput !== 'discord') await scheduleLiveVoicePlayback(result.audio);
        setLiveChangerMessage(
          `${result.discordQueuePosition ? `Discord queue ${result.discordQueuePosition}` : 'Playing in browser'} · ${result.modelSelection} · ${result.sourceDuration.toFixed(1)}s segment · ${((performance.now() - capturedAt) / 1000).toFixed(1)}s conversion latency.`,
        );
      })
      .catch((error: any) => {
        setLiveChangerMessage(`❌ Live conversion stopped producing audio: ${error.message}`);
      })
      .finally(() => {
        liveQueueDepthRef.current = Math.max(0, liveQueueDepthRef.current - 1);
        setLiveChangerQueued(liveQueueDepthRef.current);
      });
  };

  const drainLiveVoiceBuffer = (sampleRate: number, flush = false) => {
    const segmentFrames = Math.floor(sampleRate * 3.2);
    const overlapFrames = voiceChangerOutput === 'browser' ? Math.floor(sampleRate * 0.18) : 0;
    if (!flush && liveFrameCountRef.current < segmentFrames) return;
    if (flush && liveFrameCountRef.current < Math.floor(sampleRate * 0.35)) {
      liveChunksRef.current = [];
      liveFrameCountRef.current = 0;
      return;
    }
    const combined = new Float32Array(liveFrameCountRef.current);
    let offset = 0;
    for (const chunk of liveChunksRef.current) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    const outputFrames = flush ? combined.length : segmentFrames;
    const output = combined.slice(0, outputFrames);
    const consumedFrames = flush ? combined.length : Math.max(1, segmentFrames - overlapFrames);
    const remaining = combined.slice(consumedFrames);
    liveChunksRef.current = remaining.length ? [remaining] : [];
    liveFrameCountRef.current = remaining.length;
    queueLiveVoiceSegment(output, sampleRate);
  };

  const startLiveVoiceChanger = async () => {
    if (!selectedControlUserId) {
      setLiveChangerMessage('❌ Choose a member/clone first.');
      return;
    }
    if (!selectedVoiceChangerModelAvailable || selectedJobIsActive) {
      setLiveChangerMessage('❌ The selected model must be ready and training must be stopped.');
      return;
    }
    try {
      setMicrophoneSystemBlocked(false);
      if (liveAudioContextRef.current && liveAudioContextRef.current.state !== 'closed') {
        await liveAudioContextRef.current.close();
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      const context = new AudioContext({ latencyHint: 'interactive' });
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const muteGain = context.createGain();
      muteGain.gain.value = 0;
      liveAudioContextRef.current = context;
      liveMediaStreamRef.current = stream;
      liveSourceNodeRef.current = source;
      liveProcessorRef.current = processor;
      liveMuteGainRef.current = muteGain;
      liveChunksRef.current = [];
      liveFrameCountRef.current = 0;
      liveQueueDepthRef.current = 0;
      liveConversionChainRef.current = Promise.resolve();
      livePlaybackEndRef.current = 0;
      liveHasScheduledAudioRef.current = false;
      liveChangerActiveRef.current = true;
      processor.onaudioprocess = event => {
        if (!liveChangerActiveRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        liveChunksRef.current.push(copy);
        liveFrameCountRef.current += copy.length;
        drainLiveVoiceBuffer(context.sampleRate);
      };
      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(context.destination);
      await context.resume();
      setLiveChangerActive(true);
      setLiveChangerQueued(0);
      setLiveChangerMessage('🎙️ Listening continuously. The first changed segment will play after about 3-6 seconds.');
    } catch (error: any) {
      const errorMessage = String(error?.message || '');
      const deniedBySystem = /permission denied by system|denied.*system/i.test(errorMessage);
      const permissionBlocked = deniedBySystem
        || error?.name === 'NotAllowedError'
        || /permission denied|not allowed/i.test(errorMessage);
      setMicrophoneSystemBlocked(permissionBlocked);
      if (deniedBySystem) {
        setLiveChangerMessage('❌ Windows blocked microphone access for this app. Open this dashboard in Chrome or Edge; allowing only the site prompt is not enough for the Codex in-app browser.');
      } else if (permissionBlocked) {
        setLiveChangerMessage('❌ Microphone permission is blocked for this site. In Chrome or Edge, click the lock icon beside the address, set Microphone to Allow, then reload the page.');
      } else {
        setLiveChangerMessage(`❌ Microphone could not start: ${errorMessage || 'Unknown microphone error'}`);
      }
    }
  };

  const openDashboardInExternalBrowser = async () => {
    const dashboardUrl = 'http://127.0.0.1:3000/';
    try {
      await navigator.clipboard.writeText(dashboardUrl);
      setLiveChangerMessage('✅ Dashboard address copied. Open Chrome or Edge, press Ctrl+V, allow microphone access there, then press Start Microphone.');
    } catch (error: any) {
      setLiveChangerMessage(`Open ${dashboardUrl} in Chrome or Edge. Clipboard copy failed: ${error?.message || 'permission unavailable'}.`);
    }
  };

  const stopLiveVoiceChanger = async () => {
    const context = liveAudioContextRef.current;
    liveChangerActiveRef.current = false;
    setLiveChangerActive(false);
    if (context && context.state !== 'closed') drainLiveVoiceBuffer(context.sampleRate, true);
    if (liveProcessorRef.current) {
      liveProcessorRef.current.onaudioprocess = null;
      liveProcessorRef.current.disconnect();
    }
    liveSourceNodeRef.current?.disconnect();
    liveMuteGainRef.current?.disconnect();
    liveMediaStreamRef.current?.getTracks().forEach(track => track.stop());
    liveProcessorRef.current = null;
    liveSourceNodeRef.current = null;
    liveMuteGainRef.current = null;
    liveMediaStreamRef.current = null;
    setLiveChangerMessage('Finishing the last captured segment...');
    await liveConversionChainRef.current.catch(() => {});
    setLiveChangerMessage('Stopped. Any converted audio already scheduled will finish playing.');
  };

  const exportBrainVault = async () => {
    const response = await fetch('/api/brain/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'export' }),
    });
    const data = await response.json();
    setControlMessage(data.success ? `✅ Obsidian vault updated: ${data.vaultPath}` : `❌ ${data.error}`);
    await refreshControl();
  };

  const cloudExportPayload = () => ({
    userId: selectedControlUserId,
    trainingTarget,
    trainingMode: cloudTrainingMode,
    modelSelection: cloudModelSelection,
    epochs: cloudTrainingEpochs,
    ...cloudExportSelections,
  });

  const chooseTrainingTarget = (target: TrainingTarget) => {
    setTrainingTarget(target);
    setCloudExportPreview(null);
    setCloudExportMessage(null);
    setCloudExportResult(null);
    setCloudCommandCopied(false);
  };

  const chooseCloudTrainingMode = (mode: 'fresh' | 'finetune') => {
    setCloudTrainingMode(mode);
    setCloudTrainingEpochs(mode === 'finetune' ? 30 : 100);
    setCloudExportPreview(null);
    setCloudExportMessage(null);
    setCloudExportResult(null);
    setCloudCommandCopied(false);
  };

  const chooseCloudModel = (selection: 'best' | 'latest') => {
    setCloudModelSelection(selection);
    setCloudExportSelections(current => ({
      ...current,
      includeBestModel: selection === 'best' ? true : current.includeBestModel,
      includeLatestModel: selection === 'latest' ? true : current.includeLatestModel,
    }));
    setCloudExportPreview(null);
    setCloudExportMessage(null);
    setCloudExportResult(null);
    setCloudCommandCopied(false);
  };

  const updateCloudExportSelection = (key: keyof CloudExportSelections, value: boolean) => {
    setCloudExportSelections(current => ({ ...current, [key]: value }));
    setCloudExportPreview(null);
    setCloudExportMessage(null);
    setCloudExportResult(null);
    setCloudCommandCopied(false);
  };

  const checkCloudExportReadiness = async () => {
    setCloudExportBusy('preview');
    setCloudExportMessage(null);
    try {
      const response = await fetch('/api/voice-export/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloudExportPayload()),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not inspect the cloud export.');
      setCloudExportPreview(data);
      setCloudExportMessage(data.ready
        ? '✅ Ready to create a non-destructive Vast.ai training package.'
        : '⚠️ Fix the blocking items below before creating the package.');
      if (data.ready) {
        setCloudExportMessage(`Ready to create a non-destructive ${trainingTarget === 'laptop_4050_6gb' ? 'RTX 4050 laptop' : 'Vast.ai'} training package.`);
      }
    } catch (error: any) {
      setCloudExportPreview(null);
      setCloudExportMessage(`❌ ${error.message}`);
    } finally {
      setCloudExportBusy(null);
    }
  };

  const downloadCloudTrainingExport = async () => {
    setCloudExportBusy('export');
    setCloudExportMessage('Cleaning copies and building the training archive. This can take a few minutes...');
    setCloudExportResult(null);
    setCloudCommandCopied(false);
    try {
      const response = await fetch('/api/voice-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloudExportPayload()),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Export failed with HTTP ${response.status}.`);
      }
      const disposition = response.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1]
        || `digital-me-${selectedControlUserId}-${trainingTarget === 'laptop_4050_6gb' ? 'laptop-4050' : 'vast'}.zip`;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      const kept = response.headers.get('x-digital-me-kept-clips');
      const excluded = response.headers.get('x-digital-me-excluded-clips');
      const sha256 = response.headers.get('x-digital-me-sha256') || '';
      setCloudExportResult({
        filename,
        sizeBytes: blob.size,
        sha256,
        commandScript: cloudCommandScriptName,
        pasteCommand: trainingTarget === 'laptop_4050_6gb'
          ? buildLaptopPasteCommand(filename, blob.size, sha256, cloudCommandScriptName)
          : buildVastPasteCommand(filename, blob.size, sha256, cloudCommandScriptName),
      });
      setCloudExportMessage(`✅ Downloaded ${filename}${kept ? ` with ${kept} clean clips${excluded ? ` (${excluded} excluded)` : ''}` : ''}.`);
    } catch (error: any) {
      setCloudExportMessage(`❌ ${error.message}`);
    } finally {
      setCloudExportBusy(null);
    }
  };

  const copyCloudPasteCommand = async () => {
    if (!cloudExportResult) return;
    try {
      await navigator.clipboard.writeText(cloudExportResult.pasteCommand);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = cloudExportResult.pasteCommand;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCloudCommandCopied(true);
    window.setTimeout(() => setCloudCommandCopied(false), 2500);
  };

  const activeGuild = controlState?.guilds?.find((guild: any) => guild.id === selectedGuildId) || controlState?.guilds?.[0];
  const learningSession = activeGuild?.learningSession || null;
  const selectedControlUser = activeGuild?.members?.find((member: any) => member.id === selectedControlUserId);
  const selectedVoiceStatus = activeGuild?.consentedUsers?.find((user: any) => user.userId === selectedControlUserId)?.voice
    || controlState?.voices?.find((voice: any) => voice.speakerId === selectedControlUserId)
    || null;
  const selectedTrainingJob = selectedVoiceStatus?.job || null;
  const modelVersions = selectedVoiceStatus?.modelVersions || [];
  const activeModelVersionId = selectedVoiceStatus?.activeModelVersionId
    || modelVersions.find((version: any) => version.isCurrent)?.id
    || '';
  const selectedPlaybackVersion = modelVersions.find((version: any) => version.id === playbackModelVersionId);
  const selectedVoiceChangerVersion = modelVersions.find((version: any) => version.id === voiceChangerVersionId);
  const selectedJobIsActive = selectedTrainingJob?.status === 'queued'
    || selectedTrainingJob?.status === 'training'
    || selectedTrainingJob?.status === 'stopping';
  const trainingOptionsSupported = selectedVoiceStatus?.availableModels !== undefined;
  const selectedModelAvailable = trainingModelSelection === 'best'
    ? selectedVoiceStatus?.availableModels?.best === true
    : selectedVoiceStatus?.availableModels?.latest === true;
  const selectedPlaybackModelAvailable = playbackModelSelection === 'best'
    ? (selectedPlaybackVersion?.availableModels?.best ?? selectedVoiceStatus?.availableModels?.best) === true
    : (selectedPlaybackVersion?.availableModels?.latest ?? selectedVoiceStatus?.availableModels?.latest) === true;
  const selectedVoiceChangerModelAvailable = voiceChangerModel === 'best'
    ? (selectedVoiceChangerVersion?.availableModels?.best ?? selectedVoiceStatus?.availableModels?.best) === true
    : (selectedVoiceChangerVersion?.availableModels?.latest ?? selectedVoiceStatus?.availableModels?.latest) === true;
  const validTrainingEpochs = Number.isInteger(trainingEpochs) && trainingEpochs >= 1 && trainingEpochs <= 1200;
  const validCloudTrainingEpochs = Number.isInteger(cloudTrainingEpochs) && cloudTrainingEpochs >= 1 && cloudTrainingEpochs <= 1200;
  const cloudCommandScriptName = `${cloudTrainingMode === 'finetune'
    ? `RUN_FINETUNE_${cloudModelSelection.toUpperCase()}_${cloudTrainingEpochs}_EPOCHS`
    : `RUN_TRAIN_NEW_${cloudTrainingEpochs}_EPOCHS`}${trainingTarget === 'laptop_4050_6gb' ? '_LAPTOP_4050.ps1' : '.sh'}`;
  const cloudCommandDisplay = trainingTarget === 'laptop_4050_6gb'
    ? `powershell -NoProfile -ExecutionPolicy Bypass -File .\\${cloudCommandScriptName}`
    : `bash ${cloudCommandScriptName}`;

  useEffect(() => {
    setCloudExportPreview(null);
    setCloudExportResult(null);
    setCloudCommandCopied(false);
  }, [selectedControlUserId, trainingTarget, cloudTrainingMode, cloudModelSelection, cloudTrainingEpochs]);

  useEffect(() => {
    const bestAvailable = selectedVoiceStatus?.availableModels?.best === true;
    const latestAvailable = selectedVoiceStatus?.availableModels?.latest === true;
    const versionId = activeModelVersionId;
    setPlaybackModelVersionId(versionId);
    setVoiceChangerVersionId(versionId);
    if (cloudTrainingMode === 'finetune' && selectedVoiceStatus && !bestAvailable && !latestAvailable) {
      setCloudTrainingMode('fresh');
      setCloudTrainingEpochs(100);
    } else if (cloudTrainingMode === 'finetune' && cloudModelSelection === 'best' && !bestAvailable && latestAvailable) {
      setCloudModelSelection('latest');
    } else if (cloudTrainingMode === 'finetune' && cloudModelSelection === 'latest' && !latestAvailable && bestAvailable) {
      setCloudModelSelection('best');
    }
  }, [selectedControlUserId, selectedVoiceStatus?.availableModels?.best, selectedVoiceStatus?.availableModels?.latest, cloudTrainingMode, cloudModelSelection]);

  useEffect(() => {
    const active = selectedVoiceStatus?.checkpointSelection?.active;
    const bestAvailable = selectedVoiceStatus?.availableModels?.best === true;
    const latestAvailable = selectedVoiceStatus?.availableModels?.latest === true;
    setPlaybackModelSelection(active === 'latest' && latestAvailable ? 'latest' : bestAvailable ? 'best' : 'latest');
    setVoiceChangerModel(active === 'latest' && latestAvailable ? 'latest' : bestAvailable ? 'best' : 'latest');
    setModelPreviewMessage(null);
    setModelPreviewAudioUrl(current => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }, [selectedControlUserId, selectedVoiceStatus?.checkpointSelection?.active, activeModelVersionId]);

  useEffect(() => () => {
    liveChangerActiveRef.current = false;
    liveProcessorRef.current?.disconnect();
    liveSourceNodeRef.current?.disconnect();
    liveMuteGainRef.current?.disconnect();
    liveMediaStreamRef.current?.getTracks().forEach(track => track.stop());
    if (liveAudioContextRef.current?.state !== 'closed') void liveAudioContextRef.current?.close();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#0a0a0a] to-[#121212] text-gray-200 font-sans">
      <header className="h-20 border-b border-white/5 flex items-center justify-between px-10">
        <h2 className="text-xl font-medium text-white tracking-tight">Digital Me <span className="text-gray-600 font-light mx-2">/</span> <span className="text-[#5865F2] font-semibold">Discord Voice Dashboard</span></h2>
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
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Local RTX RVC Training + Inference</p>
            <div className="text-lg font-bold text-white mb-2 font-mono truncate">
              {colabUrl ? colabUrl : 'Not Connected'}
            </div>
            <div className="flex items-center justify-between mb-4">
              <div className={`flex items-center gap-1.5 text-xs font-mono ${colabUrl ? 'text-green-400' : 'text-red-400'}`}>
                <span>{colabUrl ? `● Local service / auth ${colabAuthenticated ? 'configured' : 'missing'}` : '○ Run npm run voice:setup, then restart locally'}</span>
              </div>
              <span className="text-xs text-[#5865F2] font-mono">Private loopback connection</span>
            </div>

            <div className="bg-[#111111] border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-400 mb-3">
              Setup: <code className="text-gray-200">npm run voice:setup</code> once, then use <code className="text-gray-200">npm run start:local</code>.
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
                {isSyncingDrive ? '⏳ Syncing locally...' : hasSyncedDrive ? '✓ Voice Samples Synced Locally' : '📤 Sync Existing Recorded Samples (One-Time)'}
              </button>
              {syncResult && (
                <p className="text-xs font-mono text-gray-300">{syncResult}</p>
              )}
            </div>

          </div>
        </div>

        {/* Local Intelligence + read-only research */}
        <div className="bg-[#071419] p-6 md:p-8 rounded-2xl border border-cyan-400/20 space-y-5 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(circle_at_75%_20%,rgba(34,211,238,0.16),transparent_35%)]"></div>
          <div className="relative flex flex-wrap items-start justify-between gap-5">
            <div className="flex items-center gap-5 min-w-0">
              <JarvisCore
                phase={intelligenceStatus?.activity?.phase || 'idle'}
                ready={Boolean(intelligenceStatus?.llm?.modelAvailable && intelligenceStatus?.research?.connected)}
              />
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-[0.24em] uppercase text-cyan-300">Local Intelligence Core</p>
                <h3 className="text-xl font-bold text-white mt-1">JARVIS Research Console</h3>
                <p className="text-xs text-cyan-100/55 mt-1 max-w-xl">Qwen3.8 chooses from a pinned, read-only MCP allowlist and keeps a source ledger.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono">
              <span className={`px-3 py-2 rounded-lg border ${intelligenceStatus?.llm?.modelAvailable ? 'text-emerald-300 border-emerald-400/25 bg-emerald-400/5' : 'text-amber-300 border-amber-400/25 bg-amber-400/5'}`}>
                {intelligenceStatus?.llm?.modelAvailable ? 'MODEL READY' : intelligenceStatus?.llm?.reachable ? 'MODEL MISSING' : 'OLLAMA OFFLINE'}
              </span>
              <span className={`px-3 py-2 rounded-lg border ${intelligenceStatus?.research?.availability === 'up' || intelligenceStatus?.research?.connected ? 'text-emerald-300 border-emerald-400/25 bg-emerald-400/5' : 'text-amber-300 border-amber-400/25 bg-amber-400/5'}`}>
                MCP {intelligenceStatus?.research?.availability === 'up' || intelligenceStatus?.research?.connected
                  ? 'READY'
                  : intelligenceStatus?.research?.availability === 'not_configured'
                    ? 'NOT CONFIGURED'
                    : intelligenceStatus?.research?.availability === 'disabled'
                      ? 'DISABLED'
                      : intelligenceStatus?.research?.availability === 'failed'
                        ? 'FAILED'
                        : 'OFFLINE'}
              </span>
              <span className="px-3 py-2 rounded-lg border border-cyan-400/20 text-cyan-200 bg-cyan-400/5">
                {intelligenceStatus?.research?.allowedTools?.length || 0} SAFE TOOLS
              </span>
              <span className="px-3 py-2 rounded-lg border border-cyan-400/20 text-cyan-200 bg-cyan-400/5 uppercase">
                {intelligenceStatus?.activity?.phase || 'idle'}
              </span>
            </div>
          </div>

          <div className="relative grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
            <div className="space-y-3">
              <textarea
                value={researchQuery}
                onChange={event => setResearchQuery(event.target.value)}
                rows={4}
                maxLength={2000}
                className="w-full resize-y bg-black/30 border border-cyan-300/15 rounded-xl p-4 text-sm text-cyan-50 placeholder-cyan-100/30 focus:outline-none focus:border-cyan-300/40"
                placeholder="ถามข่าว ตลาด AI ภัยพิบัติ งานวิจัย หรือข้อมูลโลกปัจจุบัน..."
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[10px] text-cyan-100/40">Read-only · external data treated as untrusted · localhost only</span>
                <button
                  onClick={handleResearch}
                  disabled={researchBusy || !researchQuery.trim() || !intelligenceStatus?.llm?.modelAvailable}
                  className="px-5 py-2.5 rounded-xl bg-cyan-300 disabled:bg-cyan-950 disabled:text-cyan-700 text-slate-950 text-xs font-bold transition-colors"
                >
                  {researchBusy ? 'RESEARCHING...' : 'RUN LIVE RESEARCH'}
                </button>
              </div>
              {researchError && <p className="text-xs text-red-300 bg-red-400/5 border border-red-400/15 rounded-lg p-3">{researchError}</p>}
            </div>

            <div className="min-h-40 rounded-xl bg-black/25 border border-cyan-300/10 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-[10px] uppercase tracking-[0.18em] text-cyan-300">Response Preview</span>
                <span className="text-[10px] text-cyan-100/35 truncate max-w-[60%]">{intelligenceStatus?.llm?.model || 'No model loaded'}</span>
              </div>
              {researchResult ? (
                <div className="space-y-3">
                  <p className="text-sm text-cyan-50 whitespace-pre-wrap leading-6">{researchResult.answer}</p>
                  {researchResult.toolsUsed?.length > 0 && <p className="text-[10px] text-cyan-200/55">Tools: {researchResult.toolsUsed.join(', ')}</p>}
                  {researchResult.sources?.length > 0 && (
                    <div className="space-y-1 pt-2 border-t border-cyan-300/10">
                      {researchResult.sources.map((source: string) => (
                        <a key={source} href={source} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-cyan-300 hover:text-cyan-100">{source}</a>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-28 grid place-items-center text-center">
                  <p className="text-xs text-cyan-100/35">{researchBusy ? intelligenceStatus?.activity?.detail || 'The local model is selecting sources...' : 'Live answers and citations will appear here.'}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Discord Command Center */}
        <div className="bg-[#161616] p-8 rounded-2xl border border-[#5865F2]/20 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white">Discord Command Center</h3>
              <p className="text-xs text-gray-400 mt-1">Everything available as a slash command is available here with guided selections.</p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className={`w-2 h-2 rounded-full ${controlState?.ready ? 'bg-green-400' : 'bg-red-400'}`}></span>
              <span className="text-gray-400">{controlState?.botTag || 'Bot offline'}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase">Discord Server</span>
              <select value={selectedGuildId} onChange={(event) => {
                const guild = controlState?.guilds?.find((item: any) => item.id === event.target.value);
                setSelectedGuildId(event.target.value);
                setSelectedVoiceChannelId(guild?.connectedVoiceChannelId || guild?.voiceChannels?.[0]?.id || '');
                setSelectedTextChannelId(guild?.notificationChannels?.[0]?.id || guild?.textChannels?.[0]?.id || '');
                setSelectedControlUserId(guild?.selectedVoiceId || guild?.members?.[0]?.id || '');
              }} className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white">
                {(controlState?.guilds || []).map((guild: any) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase">Voice Channel</span>
              <select value={selectedVoiceChannelId} onChange={(event) => setSelectedVoiceChannelId(event.target.value)} className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white">
                {(activeGuild?.voiceChannels || []).map((channel: any) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase">Notification / VC Chat</span>
              <select value={selectedTextChannelId} onChange={(event) => setSelectedTextChannelId(event.target.value)} className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white">
                {(activeGuild?.notificationChannels || activeGuild?.textChannels || []).map((channel: any) => (
                  <option key={`${channel.kind || 'text'}:${channel.id}`} value={channel.id}>
                    {channel.kind === 'voice' ? `🔊 ${channel.name} — voice chat` : `#${channel.name}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase">Member / Clone</span>
              <select value={selectedControlUserId} onChange={(event) => setSelectedControlUserId(event.target.value)} className="w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white">
                {(activeGuild?.members || []).map((member: any) => <option key={member.id} value={member.id}>{member.name}{member.consented ? ' ✓' : ''}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="bg-[#101010] border border-white/5 rounded-xl p-4 space-y-3">
              <div className="flex justify-between items-center"><h4 className="text-sm font-bold text-white">Session</h4><span className="text-[10px] text-green-400 font-mono">{activeGuild?.receiverState || 'OFFLINE'}</span></div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => runDashboardCommand('join')} className="py-2 bg-green-600/20 text-green-300 border border-green-500/30 rounded-lg text-xs">Join & Listen</button>
                <button onClick={() => runDashboardCommand('leave')} className="py-2 bg-red-600/20 text-red-300 border border-red-500/30 rounded-lg text-xs">Leave</button>
                <button onClick={() => runDashboardCommand('status')} className="py-2 bg-white/5 text-gray-300 rounded-lg text-xs">Status</button>
                <button onClick={() => runDashboardCommand('debug')} className="py-2 bg-white/5 text-gray-300 rounded-lg text-xs">Debug</button>
                <button onClick={() => runDashboardCommand('transcript')} className="py-2 bg-white/5 text-gray-300 rounded-lg text-xs">Transcripts</button>
                <button onClick={() => runDashboardCommand('voices')} className="py-2 bg-white/5 text-gray-300 rounded-lg text-xs">Voices</button>
              </div>
              <button
                onClick={() => runDashboardCommand('vc-auto-response', { action: activeGuild?.vcAutoResponseEnabled === false ? 'resume' : 'pause' })}
                disabled={!selectedGuildId || controlBusy?.startsWith('vc-auto-response:')}
                className={`w-full py-2.5 border rounded-lg text-xs font-bold disabled:opacity-40 ${activeGuild?.vcAutoResponseEnabled === false ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-200 hover:bg-emerald-500/25' : 'bg-amber-500/15 border-amber-500/35 text-amber-200 hover:bg-amber-500/25'}`}
              >
                {activeGuild?.vcAutoResponseEnabled === false
                  ? 'Resume VC Auto-Response'
                  : 'Pause VC AI · Prioritize Voice Changer'}
              </button>
              <div className={`p-2.5 rounded-lg border text-[10px] ${activeGuild?.vcAutoResponseEnabled === false ? 'bg-amber-500/5 border-amber-500/20 text-amber-100/80' : 'bg-white/[0.02] border-white/5 text-gray-500'}`}>
                {activeGuild?.vcAutoResponseEnabled === false
                  ? 'VC AI is paused: no Discord audio decoding, STT, training capture, memory analysis, LLM, or automatic TTS replies. The bot stays connected for Voice Changer and manual Speak playback.'
                  : 'VC AI is active and can listen, transcribe, learn, think, and reply automatically. Pause it before a heavy Voice Changer job to reserve compute.'}
              </div>
              <p className="text-[10px] text-gray-500">Connected: {activeGuild?.connectedVoiceChannelId ? 'yes' : 'no'} · Selected persona: {activeGuild?.persona?.displayName || 'none'}</p>
            </div>

            <div className="bg-[#101010] border border-white/5 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-bold text-white">Voice & Identity</h4>
              <button onClick={() => runDashboardCommand('voice')} disabled={!selectedControlUser?.consented} className="w-full py-2 bg-[#5865F2]/20 text-[#aab7ff] border border-[#5865F2]/30 disabled:opacity-40 rounded-lg text-xs">Select Voice + Persona</button>
              <div className="flex gap-2">
                <input value={dashboardSpeakText} onChange={(event) => setDashboardSpeakText(event.target.value)} className="min-w-0 flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-white" />
                <button onClick={() => runDashboardCommand('speak', { text: dashboardSpeakText })} className="px-4 py-2 bg-[#5865F2] text-white rounded-lg text-xs">Speak</button>
              </div>
              <p className="text-[10px] text-gray-500">Use the Active Clone Identity editor below to run the Persona command without typing IDs.</p>
            </div>

            <div className="bg-[#101010] border border-white/5 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-white">Automatic Learning Session</h4>
                <span className={`text-[9px] font-bold uppercase ${learningSession?.status === 'listening' ? 'text-green-300' : learningSession?.status === 'failed' ? 'text-red-300' : 'text-gray-500'}`}>
                  {learningSession?.status || 'inactive'}
                </span>
              </div>
              <button
                onClick={() => runDashboardCommand('train')}
                disabled={learningSession?.status === 'listening' || controlBusy === 'train:'}
                className="w-full py-2 bg-amber-500/15 disabled:opacity-40 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-bold"
              >
                {selectedControlUser?.consented ? 'Start Learning This Person' : 'Request Consent & Start Learning'}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => runDashboardCommand('learning-session', { action: 'stop' })}
                  disabled={learningSession?.status !== 'listening' || controlBusy === 'learning-session:stop'}
                  className="py-2 bg-red-500/10 border border-red-500/20 disabled:opacity-40 text-red-300 rounded-lg text-xs"
                >Stop & Process</button>
                <button onClick={() => runDashboardCommand('learning-session', { action: 'status' })} className="py-2 bg-white/5 text-gray-300 rounded-lg text-xs">Refresh Status</button>
              </div>
              {learningSession ? (
                <div className="bg-black/25 border border-white/5 rounded-lg p-2.5 space-y-2 text-[10px]">
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Person</span><strong className="text-gray-200 text-right">{learningSession.targetDisplayName}</strong></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded bg-white/[0.03] p-2"><span className="block text-gray-500">Clean audio</span><strong className="text-green-300">{Number(learningSession.counters?.acceptedVoiceSeconds || 0).toFixed(1)}s</strong></div>
                    <div className="rounded bg-white/[0.03] p-2"><span className="block text-gray-500">Captured</span><strong className="text-gray-200">{Number(learningSession.counters?.capturedSeconds || 0).toFixed(1)}s</strong></div>
                    <div className="rounded bg-white/[0.03] p-2"><span className="block text-gray-500">Accepted clips</span><strong className="text-green-300">{learningSession.counters?.acceptedVoiceClips || 0}</strong></div>
                    <div className="rounded bg-white/[0.03] p-2"><span className="block text-gray-500">Rejected clips</span><strong className="text-amber-300">{learningSession.counters?.rejectedClips || 0}</strong></div>
                  </div>
                  <p className="text-gray-500">Styles: {Object.entries(learningSession.counters?.styleCounts || {}).filter(([, count]) => Number(count) > 0).map(([name, count]) => `${name} ${count}`).join(' · ') || 'waiting for clean speech'}</p>
                  {learningSession.datasetVersionId && <p className="text-gray-500">Dataset: <code className="text-gray-300">{learningSession.datasetVersionId}</code></p>}
                  {learningSession.training?.reason && <p className="text-purple-300">{learningSession.training.reason}</p>}
                </div>
              ) : (
                <p className="text-[10px] text-gray-500">Choose a member and voice channel. The system will analyze every sentence, keep clean clips, and train only after you stop.</p>
              )}
            </div>
          </div>

          <div className="bg-[#101010] border border-purple-500/20 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-white">Local Voice Training</h4>
                <p className="text-[11px] text-gray-400 mt-1">Choose one person, how training starts, the source model, and the exact epoch count.</p>
              </div>
              <button
                onClick={() => runDashboardCommand('voice-train', { action: 'status' })}
                disabled={!selectedControlUser?.consented || controlBusy === 'voice-train:status'}
                className="px-3 py-2 bg-white/5 disabled:opacity-40 text-gray-300 rounded-lg text-xs"
              >
                Refresh Status
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Person</span>
                <select value={selectedControlUserId} onChange={(event) => setSelectedControlUserId(event.target.value)} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white">
                  {(activeGuild?.members || []).map((member: any) => (
                    <option key={`training:${member.id}`} value={member.id}>{member.name}{member.consented ? ' (consented)' : ' (no consent)'}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Training Type</span>
                <select value={trainingMode} onChange={(event) => setTrainingMode(event.target.value as 'fresh' | 'finetune')} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white">
                  <option value="fresh">Train from zero</option>
                  <option value="finetune" disabled={!selectedVoiceStatus?.availableModels?.best && !selectedVoiceStatus?.availableModels?.latest}>Fine-tune an existing model</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Starting Model</span>
                <select
                  value={trainingModelSelection}
                  onChange={(event) => setTrainingModelSelection(event.target.value as 'best' | 'latest')}
                  disabled={trainingMode === 'fresh'}
                  className="w-full bg-black/30 border border-white/10 disabled:opacity-40 rounded-lg px-3 py-2.5 text-xs text-white"
                >
                  <option value="best" disabled={!selectedVoiceStatus?.availableModels?.best}>Best model</option>
                  <option value="latest" disabled={!selectedVoiceStatus?.availableModels?.latest}>Latest (last epoch)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Epochs (1-1200)</span>
                <input
                  type="number"
                  min={1}
                  max={1200}
                  step={1}
                  value={trainingEpochs}
                  onChange={(event) => setTrainingEpochs(Number(event.target.value))}
                  className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] items-stretch gap-3">
              <div className="bg-black/25 border border-white/5 rounded-lg px-3 py-2.5 text-[11px] text-gray-400">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>Dataset: <strong className="text-gray-200">{selectedVoiceStatus ? `${selectedVoiceStatus.sampleCount} clips / ${Number(selectedVoiceStatus.durationSeconds || 0).toFixed(1)}s` : 'not available'}</strong></span>
                  <span>Model: <strong className="text-gray-200">{selectedVoiceStatus?.modelReady
                    ? `ready${selectedVoiceStatus?.checkpointSelection
                      ? `, active ${selectedVoiceStatus.checkpointSelection.active} epoch ${selectedVoiceStatus.checkpointSelection.active === 'latest'
                        ? selectedVoiceStatus.checkpointSelection.latestEpoch
                        : selectedVoiceStatus.checkpointSelection.bestEpoch}`
                      : ''}`
                    : 'not trained'}</strong></span>
                  <span>Job: <strong className={selectedTrainingJob?.status === 'failed' ? 'text-red-300' : selectedJobIsActive ? 'text-amber-300' : 'text-gray-200'}>{selectedTrainingJob?.status || 'idle'}</strong></span>
                  {selectedTrainingJob?.currentEpoch ? <span>Completed epoch: <strong className="text-gray-200">{selectedTrainingJob.currentEpoch}</strong></span> : null}
                </div>
                <p className="mt-1.5">
                  {!trainingOptionsSupported
                    ? 'Finish the current training, then restart Digital Me once to activate these new training controls.'
                    : selectedTrainingJob?.message || (trainingMode === 'fresh'
                      ? 'Starts a new clone from the generic RVC base; the current working model stays active until completion.'
                      : `Warm-starts from this person's ${trainingModelSelection} model with a reduced learning rate.`)}
                </p>
              </div>

              <div className="flex flex-col gap-2 min-w-52">
                <button
                  onClick={() => runDashboardCommand('voice-train', {
                    action: 'start',
                    trainingMode,
                    modelSelection: trainingModelSelection,
                    epochs: trainingEpochs,
                  })}
                  disabled={
                    !selectedControlUser?.consented
                    || !trainingOptionsSupported
                    || selectedJobIsActive
                    || !validTrainingEpochs
                    || (trainingMode === 'finetune' && !selectedModelAvailable)
                    || controlBusy === 'voice-train:start'
                  }
                  className="px-5 py-3 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-purple-200 rounded-lg text-xs font-bold"
                >
                  {controlBusy === 'voice-train:start' ? 'Submitting...' : trainingMode === 'fresh' ? 'Start Training from Zero' : `Start Fine-tuning from ${trainingModelSelection === 'best' ? 'Best' : 'Latest'}`}
                </button>
                {selectedJobIsActive && (
                  <button
                    onClick={() => runDashboardCommand('voice-train', { action: 'stop' })}
                    disabled={selectedTrainingJob?.status === 'queued' || selectedTrainingJob?.status === 'stopping' || controlBusy === 'voice-train:stop'}
                    className="px-5 py-3 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-amber-200 rounded-lg text-xs font-bold"
                  >
                    {selectedTrainingJob?.status === 'stopping'
                      ? `Stopping after epoch ${selectedTrainingJob.stopAfterEpoch || 'current'}...`
                      : controlBusy === 'voice-train:stop'
                        ? 'Requesting safe stop...'
                        : 'Stop after current epoch & publish'}
                  </button>
                )}
              </div>
            </div>

            {(selectedVoiceStatus?.modelVersions?.length || selectedVoiceStatus?.availableModels?.best) && (
              <div className="bg-black/20 border border-white/5 rounded-lg p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="text-[11px] font-bold text-gray-300">Model Registry</h5>
                  <span className="text-[9px] text-gray-500">
                    {selectedVoiceStatus?.availableModels?.best && selectedVoiceStatus?.availableModels?.latest
                      ? 'Best and Latest are ready for A/B preview/export'
                      : 'Waiting for both Best and Latest checkpoints'}
                  </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-[220px_160px_1fr_auto_auto] gap-2 border-t border-white/[0.06] pt-3">
                  <label className="space-y-1">
                    <span className="text-[9px] font-bold uppercase text-gray-500">Model Version</span>
                    <select
                      value={playbackModelVersionId}
                      onChange={(event) => setPlaybackModelVersionId(event.target.value)}
                      className="w-full bg-[#0f0f0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                    >
                      {modelVersions.map((version: any) => (
                        <option key={`playback:${version.id}`} value={version.id}>
                          {version.label || version.id}{version.isCurrent ? ' (active)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] font-bold uppercase text-gray-500">Checkpoint</span>
                    <select
                      value={playbackModelSelection}
                      onChange={(event) => setPlaybackModelSelection(event.target.value as 'best' | 'latest')}
                      className="w-full bg-[#0f0f0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                    >
                      <option value="best" disabled={selectedPlaybackVersion?.availableModels?.best === false}>Best · epoch {selectedPlaybackVersion?.bestEpoch ?? selectedVoiceStatus?.checkpointSelection?.bestEpoch ?? '?'}</option>
                      <option value="latest" disabled={selectedPlaybackVersion?.availableModels?.latest === false}>Latest · epoch {selectedPlaybackVersion?.latestEpoch ?? selectedVoiceStatus?.checkpointSelection?.latestEpoch ?? '?'}</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] font-bold uppercase text-gray-500">Preview Sentence</span>
                    <input
                      value={modelPreviewText}
                      onChange={(event) => setModelPreviewText(event.target.value)}
                      className="w-full bg-[#0f0f0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                    />
                  </label>
                  <button
                    onClick={() => void previewPlaybackModel()}
                    disabled={!selectedPlaybackModelAvailable || !modelPreviewText.trim() || modelPreviewBusy || selectedJobIsActive}
                    className="self-end px-4 py-2 bg-sky-500/15 border border-sky-500/30 disabled:opacity-40 text-sky-200 rounded-lg text-xs font-bold"
                  >
                    {modelPreviewBusy ? 'Generating...' : 'Preview & Hear'}
                  </button>
                  <button
                    onClick={() => void runDashboardCommand('voice-model', { action: 'select', modelSelection: playbackModelSelection, modelVersionId: playbackModelVersionId })}
                    disabled={!selectedPlaybackModelAvailable || selectedJobIsActive || controlBusy === 'voice-model:select' || (activeModelVersionId === playbackModelVersionId && selectedVoiceStatus?.checkpointSelection?.active === playbackModelSelection)}
                    className="self-end px-4 py-2 bg-green-500/15 border border-green-500/30 disabled:opacity-40 text-green-200 rounded-lg text-xs font-bold"
                  >
                    {activeModelVersionId === playbackModelVersionId && selectedVoiceStatus?.checkpointSelection?.active === playbackModelSelection ? 'Currently Active' : 'Set Active'}
                  </button>
                </div>
                <p className="text-[10px] text-gray-500">
                  Active in Discord: <strong className="text-green-300">{selectedVoiceStatus?.activeModelLabel || 'Gam Voice'} · {selectedVoiceStatus?.checkpointSelection?.active === 'latest' ? 'Latest' : 'Best'}</strong>. Preview plays only in this browser; Set Active changes Discord and dashboard speech.
                </p>
                {modelPreviewMessage && <p className="text-[10px] text-sky-200">{modelPreviewMessage}</p>}
                {modelPreviewAudioUrl && <audio controls autoPlay src={modelPreviewAudioUrl} className="w-full h-10" />}
                <div className="space-y-1">
                  {(selectedVoiceStatus?.modelVersions || []).slice(0, 4).map((version: any) => (
                    <div key={version.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[10px] text-gray-500 border-t border-white/[0.04] pt-1.5">
                      <span><strong className="text-gray-200">{version.label || 'Gam Voice'}</strong> <code className="ml-2 text-gray-500">{version.id}</code>{version.isCurrent ? <strong className="ml-2 text-green-300">ACTIVE</strong> : null}</span>
                      <span>{version.trainingMode} · {version.epochs} epochs{version.bestEpoch ? ` · best e${version.bestEpoch}` : ''}</span>
                      <span>{version.datasetVersionId ? `dataset ${version.datasetVersionId}` : 'legacy dataset'}</span>
                    </div>
                  ))}
                  {!selectedVoiceStatus?.modelVersions?.length && <p className="text-[10px] text-gray-500">The current legacy model is available; its version entry will be added after the next training run.</p>}
                </div>
              </div>
            )}
          </div>

          <div className="bg-[#101010] border border-emerald-500/25 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white">Voice Changer</h4>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">Local RVC</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Keep the source words, timing, emotion, and melody while changing the vocal identity to the selected trained voice.</p>
              </div>
              <div className="text-[10px] text-right">
                <p className={selectedVoiceChangerModelAvailable ? 'text-emerald-300' : 'text-amber-300'}>{selectedControlUser?.name || 'No member selected'} · {voiceChangerModel}</p>
                <p className="text-gray-500">Private processing on this PC</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Clone Voice</span>
                <select
                  value={selectedControlUserId}
                  onChange={event => setSelectedControlUserId(event.target.value)}
                  disabled={liveChangerActive}
                  className="w-full bg-black/30 border border-white/10 disabled:opacity-50 rounded-lg px-3 py-2.5 text-xs text-white"
                >
                  {(activeGuild?.members || []).map((member: any) => (
                    <option key={`changer:${member.id}`} value={member.id}>{member.name}{member.consented ? ' (consented)' : ' (no consent)'}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Model Version</span>
                <select
                  value={voiceChangerVersionId}
                  onChange={event => setVoiceChangerVersionId(event.target.value)}
                  disabled={liveChangerActive}
                  className="w-full bg-black/30 border border-white/10 disabled:opacity-50 rounded-lg px-3 py-2.5 text-xs text-white"
                >
                  {modelVersions.map((version: any) => (
                    <option key={`changer:${version.id}`} value={version.id}>{version.label || version.id}{version.isCurrent ? ' (active)' : ''}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Checkpoint</span>
                <select
                  value={voiceChangerModel}
                  onChange={event => setVoiceChangerModel(event.target.value as 'best' | 'latest')}
                  disabled={liveChangerActive}
                  className="w-full bg-black/30 border border-white/10 disabled:opacity-50 rounded-lg px-3 py-2.5 text-xs text-white"
                >
                  <option value="best" disabled={selectedVoiceChangerVersion?.availableModels?.best === false}>Best · epoch {selectedVoiceChangerVersion?.bestEpoch ?? selectedVoiceStatus?.checkpointSelection?.bestEpoch ?? '?'}</option>
                  <option value="latest" disabled={selectedVoiceChangerVersion?.availableModels?.latest === false}>Latest · epoch {selectedVoiceChangerVersion?.latestEpoch ?? selectedVoiceStatus?.checkpointSelection?.latestEpoch ?? '?'}</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="flex justify-between text-[10px] font-bold text-gray-500 uppercase"><span>Global pitch shift</span><strong className={voiceChangerMode === 'song' && voiceChangerF0Shift !== 0 ? 'text-red-300' : 'text-emerald-200'}>{voiceChangerF0Shift > 0 ? '+' : ''}{voiceChangerF0Shift} semitone</strong></span>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={voiceChangerF0Shift}
                  onChange={event => setVoiceChangerF0Shift(Number(event.target.value))}
                  disabled={liveChangerActive}
                  className="w-full accent-emerald-500 disabled:opacity-50"
                />
                <span className={`block text-[9px] ${voiceChangerMode === 'song' && voiceChangerF0Shift !== 0 ? 'text-red-300' : 'text-gray-500'}`}>
                  {voiceChangerMode === 'song'
                    ? voiceChangerF0Shift === 0
                      ? 'Mixed songs must normally stay at 0 so the vocal remains in key with the instruments.'
                      : 'Warning: this shifts only the converted singer, not the instruments, so the song will sound out of key.'
                    : 'Keep at 0 first. Adjust only if the complete vocal should be transposed to another key.'}
                </span>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold text-gray-500 uppercase">Play converted voice in</span>
                <select
                  value={voiceChangerOutput}
                  onChange={event => setVoiceChangerOutput(event.target.value as VoiceChangerOutput)}
                  disabled={liveChangerActive}
                  className="w-full bg-black/30 border border-white/10 disabled:opacity-50 rounded-lg px-3 py-2.5 text-xs text-white"
                >
                  <option value="browser">This browser only</option>
                  <option value="discord" disabled={!controlState?.ready || !selectedGuildId || !selectedVoiceChannelId}>Discord VC through bot</option>
                  <option value="both" disabled={!controlState?.ready || !selectedGuildId || !selectedVoiceChannelId}>Browser + Discord VC</option>
                </select>
                <span className="block text-[9px] text-gray-500">Discord output makes the bot join the selected Voice Channel automatically.</span>
              </label>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="bg-black/25 border border-emerald-500/15 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h5 className="text-xs font-bold text-white">Low-latency Microphone</h5>
                    <p className="text-[10px] text-gray-500 mt-1">Captures continuous 3.2-second segments. Browser mode overlaps and crossfades; Discord mode uses a short ordered bot queue. It is near-real-time, not zero-latency.</p>
                  </div>
                  <span className={`text-[9px] font-bold ${liveChangerActive ? 'text-red-300 animate-pulse' : 'text-gray-500'}`}>{liveChangerActive ? '● LIVE' : '○ STOPPED'}</span>
                </div>
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/15 text-[10px] text-amber-100/80">
                  Use headphones when browser playback is enabled. Otherwise the microphone can capture the changed playback again and create feedback. Training and voice conversion cannot use the GPU at the same time.
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => void startLiveVoiceChanger()}
                    disabled={liveChangerActive || !selectedControlUser?.consented || !selectedVoiceChangerModelAvailable || selectedJobIsActive}
                    className="py-2.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 disabled:opacity-40 text-emerald-200 rounded-lg text-xs font-bold"
                  >
                    Start Microphone
                  </button>
                  <button
                    onClick={() => void stopLiveVoiceChanger()}
                    disabled={!liveChangerActive}
                    className="py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 disabled:opacity-40 text-red-200 rounded-lg text-xs font-bold"
                  >
                    Stop Microphone
                  </button>
                </div>
                <div className="flex justify-between gap-3 text-[10px]">
                  <span className="text-gray-400">{liveChangerMessage}</span>
                  <strong className={liveChangerQueued > 2 ? 'text-amber-300' : 'text-emerald-300'}>{liveChangerQueued} queued</strong>
                </div>
                <button
                  onClick={() => void openDashboardInExternalBrowser()}
                  className={`w-full py-2 border rounded-lg text-[10px] font-bold ${microphoneSystemBlocked ? 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-400/40 text-amber-100' : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300'}`}
                >
                  Copy Dashboard Address for Chrome / Edge
                </button>
                <p className="text-[9px] text-gray-600">
                  The Codex in-app browser can show a site Allow prompt while Windows still blocks the Codex app itself. Chrome or Edge uses its own microphone permission and avoids that system-level block.
                </p>
              </div>

              <div className="bg-black/25 border border-sky-500/15 rounded-xl p-4 space-y-3">
                <div>
                  <h5 className="text-xs font-bold text-white">Convert an Audio File</h5>
                  <p className="text-[10px] text-gray-500 mt-1">Upload speech, singing, or a song up to 100 MB / 10 minutes, then listen and download the changed WAV.</p>
                </div>
                <label className="space-y-1 block">
                  <span className="text-[10px] font-bold text-gray-500 uppercase">Source type</span>
                  <select
                    value={voiceChangerMode}
                    onChange={event => {
                      const nextMode = event.target.value as VoiceChangerMode;
                      setVoiceChangerMode(nextMode);
                      if (nextMode === 'song') setVoiceChangerF0Shift(0);
                    }}
                    className="w-full bg-[#0f0f0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                  >
                    <option value="speech">Speech / microphone</option>
                    <option value="vocal">Singing vocal only (best quality)</option>
                    <option value="song">Mixed song + instruments (automatic separation)</option>
                  </select>
                </label>
                {voiceChangerMode === 'vocal' && (
                  <p className="p-2.5 bg-emerald-500/5 border border-emerald-500/15 rounded-lg text-[10px] text-emerald-100/75">Use this for an acapella or isolated singing WAV. It skips separation and preserves the original melody, timing, and loudness changes before applying Gam's voice.</p>
                )}
                {voiceChangerMode === 'song' && (
                  <div className="space-y-3">
                    <p className="p-2.5 bg-sky-500/5 border border-sky-500/15 rounded-lg text-[10px] text-sky-100/75">The system automatically separates the singer, applies RVC only to the vocal, then safely mixes the untouched instruments back. This takes longer than an isolated vocal.</p>
                    <label className="space-y-1 block p-3 bg-violet-500/5 border border-violet-500/15 rounded-lg">
                      <span className="flex justify-between text-[10px] font-bold text-gray-400 uppercase"><span>Vocal volume over music</span><strong className="text-violet-200">{voiceChangerVocalBoostDb > 0 ? '+' : ''}{voiceChangerVocalBoostDb.toFixed(1)} dB</strong></span>
                      <input
                        type="range"
                        min={-6}
                        max={12}
                        step={0.5}
                        value={voiceChangerVocalBoostDb}
                        onChange={event => setVoiceChangerVocalBoostDb(Number(event.target.value))}
                        className="w-full accent-violet-500"
                      />
                      <span className="block text-[9px] text-gray-500">Start at +3 dB. Try +4.5 or +6 dB if the converted singer is still masked. The final limiter prevents digital clipping.</span>
                    </label>
                  </div>
                )}
                <input
                  type="file"
                  accept="audio/wav,audio/mpeg,audio/flac,audio/mp4,audio/aac,audio/ogg,audio/opus,audio/webm,.m4a,.mp3,.flac,.ogg,.opus,.webm"
                  onChange={event => chooseVoiceChangerFile(event.target.files?.[0] || null)}
                  className="block w-full text-[10px] text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500/15 file:px-3 file:py-2 file:text-xs file:font-bold file:text-sky-200"
                />
                {voiceChangerFile && <p className="text-[10px] text-gray-500">{voiceChangerFile.name} · {(voiceChangerFile.size / 1024 / 1024).toFixed(1)} MB</p>}
                {voiceChangerSourceUrl && (
                  <audio
                    controls
                    src={voiceChangerSourceUrl}
                    onLoadedMetadata={event => {
                      const duration = Number(event.currentTarget.duration);
                      setVoiceChangerFileDuration(Number.isFinite(duration) ? duration : 0);
                    }}
                    className="w-full h-10"
                  />
                )}
                <button
                  onClick={() => void convertVoiceChangerFile()}
                  disabled={!voiceChangerFile || voiceChangerBusy || liveChangerActive || !selectedControlUser?.consented || !selectedVoiceChangerModelAvailable || selectedJobIsActive}
                  className="w-full py-2.5 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 disabled:opacity-40 text-sky-200 rounded-lg text-xs font-bold"
                >
                  {voiceChangerBusy ? 'Converting on GPU...' : 'Convert to Selected Voice'}
                </button>
                {voiceChangerProgress && (
                  <div className="space-y-2 p-3 rounded-lg bg-sky-500/5 border border-sky-500/15">
                    <div className="flex items-center justify-between gap-3 text-[10px]">
                      <span className="font-bold text-sky-100">
                        {voiceChangerProgress.status === 'complete'
                          ? 'Complete'
                          : voiceChangerProgress.status === 'failed'
                            ? 'Failed'
                            : voiceChangerProgress.status === 'uploading'
                              ? 'Uploading / preparing'
                              : voiceChangerMode === 'song'
                                ? 'Separating vocal + converting on GPU'
                                : voiceChangerMode === 'vocal'
                                  ? 'Converting isolated vocal on GPU'
                                  : 'Processing on GPU'}
                      </span>
                      <strong className="text-sky-200">{Math.min(100, Math.max(0, voiceChangerProgress.progress)).toFixed(1)}%</strong>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-black/40 border border-white/5">
                      <div
                        className={`h-full rounded-full transition-[width] duration-700 ${voiceChangerProgress.status === 'failed' ? 'bg-red-400' : voiceChangerProgress.status === 'complete' ? 'bg-emerald-400' : 'bg-sky-400 animate-pulse'}`}
                        style={{ width: `${Math.min(100, Math.max(1, voiceChangerProgress.progress))}%` }}
                      />
                    </div>
                    <div className="flex justify-between gap-3 text-[9px] text-gray-500">
                      <span>Elapsed {formatShortDuration(voiceChangerProgress.elapsedSeconds)}</span>
                      <span>{voiceChangerProgress.status === 'processing' ? `ETA ${formatShortDuration(voiceChangerProgress.estimatedRemainingSeconds)}` : voiceChangerProgress.status === 'complete' ? 'Ready to play/download' : 'Waiting for RVC'}</span>
                    </div>
                    {voiceChangerProgress.status === 'processing' && (
                      <p className="text-[9px] text-gray-600">Estimated from the file duration and recent conversion speed. RVC does not expose exact per-frame progress, so it may pause near 97% while finishing.</p>
                    )}
                  </div>
                )}
                {voiceChangerMessage && <p className="text-[10px] text-gray-300">{voiceChangerMessage}</p>}
                {voiceChangerResultUrl && (
                  <div className="space-y-2 border-t border-white/5 pt-3">
                    <audio controls autoPlay={voiceChangerOutput !== 'discord'} src={voiceChangerResultUrl} className="w-full h-10" />
                    <a href={voiceChangerResultUrl} download={voiceChangerResultName} className="block w-full py-2 text-center bg-emerald-500/15 border border-emerald-500/25 text-emerald-200 rounded-lg text-xs font-bold">Download Changed WAV</a>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-[#101010] border border-sky-500/20 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white">Export for Training</h4>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-sky-300 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full">Optional</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Prepare one private ZIP for Vast.ai or this RTX 4050 laptop without changing the recordings or models stored on this PC.</p>
              </div>
              <button
                onClick={() => setShowCloudExport(value => !value)}
                className="px-3 py-2 bg-sky-500/10 border border-sky-500/25 text-sky-200 rounded-lg text-xs"
              >
                {showCloudExport ? 'Hide Training Export' : 'Open Export Options'}
              </button>
            </div>

            {showCloudExport && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-black/25 border border-white/5 rounded-xl p-4 space-y-3">
                    <div>
                      <h5 className="text-xs font-bold text-white">Step 1 - Choose where and how to train</h5>
                      <p className="text-[10px] text-gray-500 mt-1">The target and training choices are written into the generated command script.</p>
                    </div>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-bold text-gray-500 uppercase">Where to train</span>
                      <select
                        value={trainingTarget}
                        onChange={(event) => chooseTrainingTarget(event.target.value as TrainingTarget)}
                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white"
                      >
                        <option value="vast_24gb">Vast.ai - RTX 3090/4090 24 GB</option>
                        <option value="laptop_4050_6gb">My laptop - i5-13500HX / RTX 4050 6 GB / 16 GB RAM</option>
                      </select>
                      <span className="block text-[10px] text-gray-500">
                        {trainingTarget === 'laptop_4050_6gb'
                          ? 'Generates a Windows PowerShell launcher with batch 2, CUDA fallback to 1, 2 data workers, and a 6-thread auxiliary CPU limit.'
                          : 'Generates the Vast.ai Linux/tmux launcher with automatic 24 GB GPU tuning.'}
                      </span>
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-bold text-gray-500 uppercase">Training action</span>
                      <select
                        value={cloudTrainingMode}
                        onChange={(event) => chooseCloudTrainingMode(event.target.value as 'fresh' | 'finetune')}
                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white"
                      >
                        <option value="fresh">Train a new model from zero</option>
                        <option value="finetune" disabled={!selectedVoiceStatus?.availableModels?.best && !selectedVoiceStatus?.availableModels?.latest}>Fine-tune an existing model</option>
                      </select>
                      <span className="block text-[10px] text-gray-500">
                        {cloudTrainingMode === 'fresh'
                          ? 'Starts from the generic RVC base and ignores Gam model weights. Recommended first try: 100 epochs.'
                          : 'Continues learning from a completed Gam checkpoint. Recommended first try: 25-40 epochs.'}
                      </span>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase">Starting model</span>
                        <select
                          value={cloudModelSelection}
                          onChange={(event) => chooseCloudModel(event.target.value as 'best' | 'latest')}
                          disabled={cloudTrainingMode === 'fresh'}
                          className="w-full bg-black/30 border border-white/10 disabled:opacity-40 rounded-lg px-3 py-2.5 text-xs text-white"
                        >
                          <option value="best" disabled={!selectedVoiceStatus?.availableModels?.best}>Best model</option>
                          <option value="latest" disabled={!selectedVoiceStatus?.availableModels?.latest}>Latest model</option>
                        </select>
                        <span className="block text-[10px] text-gray-500">Best uses the lowest training-loss epoch. Latest uses the final completed epoch.</span>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase">Epochs</span>
                        <input
                          type="number"
                          min={1}
                          max={1200}
                          step={1}
                          value={cloudTrainingEpochs}
                          onChange={(event) => {
                            setCloudTrainingEpochs(Number(event.target.value));
                            setCloudExportPreview(null);
                            setCloudExportMessage(null);
                          }}
                          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white"
                        />
                        <span className="block text-[10px] text-gray-500">The generated script stops after this many cloud epochs.</span>
                      </label>
                    </div>
                    <div className="bg-sky-500/5 border border-sky-500/15 rounded-lg p-3">
                      <span className="block text-[10px] font-bold uppercase text-sky-200">Generated command</span>
                      <code className="block mt-1 text-[11px] text-sky-100 break-all">{cloudCommandDisplay}</code>
                      <span className="block mt-1 text-[10px] text-gray-500">The ZIP will contain this exact script with the selected action, checkpoint, and epoch count already configured.</span>
                      <span className="block mt-1 text-[10px] text-emerald-300/80">
                        {trainingTarget === 'laptop_4050_6gb'
                          ? 'Laptop-safe profile: batch 2, fallback to 1, 2 workers, mixed precision, TF32, and capped auxiliary CPU threads.'
                          : 'GPU auto-tuning: a 24 GB RTX 3090/4090 starts at batch 20 with mixed precision, TF32, and automatic CUDA out-of-memory fallback.'}
                      </span>
                    </div>

                    <div className="pt-1">
                      <h5 className="text-xs font-bold text-white">Step 2 - Choose what to include</h5>
                    </div>
                    {([
                      ['includeDataset', 'Dataset audio', 'Required for training. Exports only this person’s active WAV files.'],
                      ['includeTranscripts', 'Thai/English transcripts and metadata', 'Useful for reviewing clips and future intelligence training; optional for RVC.'],
                      ['includeBestModel', 'Best model checkpoint', 'Recommended backup and required when fine-tuning from Best.'],
                      ['includeLatestModel', 'Latest model checkpoint', 'Recommended for A/B testing and required when fine-tuning from Latest.'],
                      ['includeTrainingLogs', 'Previous metrics and logs', 'Helps compare the cloud run with earlier local training.'],
                      ['includeTrainer', 'Vast.ai setup and trainer', 'Required for the one-command tutorial below.'],
                    ] as Array<[keyof CloudExportSelections, string, string]>).map(([key, label, help]) => (
                      <label key={key} className="flex items-start gap-3 p-2.5 bg-white/[0.025] border border-white/5 rounded-lg cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cloudExportSelections[key]}
                          onChange={(event) => updateCloudExportSelection(key, event.target.checked)}
                          className="mt-0.5 accent-sky-500"
                        />
                        <span>
                          <span className="block text-xs text-gray-200">{label}</span>
                          <span className="block text-[10px] text-gray-500 mt-0.5">{help}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="space-y-4">
                    <div className="bg-black/25 border border-emerald-500/15 rounded-xl p-4 space-y-3">
                      <div>
                        <h5 className="text-xs font-bold text-white">Audio cleanup</h5>
                        <p className="text-[10px] text-gray-500 mt-1">Cleanup is conservative so it improves consistency without flattening Gam’s timing or emotion.</p>
                      </div>
                      <label className="flex items-start gap-3 p-2.5 bg-emerald-500/5 border border-emerald-500/10 rounded-lg cursor-pointer">
                        <input type="checkbox" checked={cloudExportSelections.cleanAudio} onChange={(event) => updateCloudExportSelection('cleanAudio', event.target.checked)} className="mt-0.5 accent-emerald-500" />
                        <span>
                          <span className="block text-xs text-emerald-100">Create safe cleaned copies</span>
                          <span className="block text-[10px] text-gray-500 mt-0.5">Convert to mono 40 kHz, trim excess edge silence, remove DC/low rumble, normalize RMS, limit peaks, and add short click-free fades.</span>
                        </span>
                      </label>
                      <label className="flex items-start gap-3 p-2.5 bg-emerald-500/5 border border-emerald-500/10 rounded-lg cursor-pointer">
                        <input type="checkbox" checked={cloudExportSelections.excludeLowQuality} onChange={(event) => updateCloudExportSelection('excludeLowQuality', event.target.checked)} className="mt-0.5 accent-emerald-500" />
                        <span>
                          <span className="block text-xs text-emerald-100">Skip clearly unusable clips</span>
                          <span className="block text-[10px] text-gray-500 mt-0.5">Excludes clips that are too short, nearly silent, contain too little audible speech, cannot be decoded, or are severely clipped.</span>
                        </span>
                      </label>
                      <p className="text-[10px] text-amber-200/80">Cleanup cannot separate another person speaking over the target or reliably remove music/game audio. Listen to random clips before renting a GPU.</p>
                    </div>

                    <div className="bg-black/25 border border-white/5 rounded-xl p-4">
                      <h5 className="text-xs font-bold text-white">Exported training plan</h5>
                      <div className="grid grid-cols-2 gap-2 mt-3 text-[10px]">
                        <span className="text-gray-500">Person</span><strong className="text-gray-200 text-right">{selectedControlUser?.name || 'Choose a person'}</strong>
                        <span className="text-gray-500">Training computer</span><strong className="text-gray-200 text-right">{trainingTarget === 'laptop_4050_6gb' ? 'RTX 4050 laptop (6 GB)' : 'Vast.ai 24 GB GPU'}</strong>
                        <span className="text-gray-500">Action</span><strong className="text-gray-200 text-right">{cloudTrainingMode === 'fresh' ? 'Train new model' : 'Fine-tune model'}</strong>
                        <span className="text-gray-500">Starting model</span><strong className="text-gray-200 text-right">{cloudTrainingMode === 'fresh' ? 'Generic RVC base' : cloudModelSelection === 'best' ? 'Best checkpoint' : 'Latest checkpoint'}</strong>
                        <span className="text-gray-500">Epochs</span><strong className="text-gray-200 text-right">{validCloudTrainingEpochs ? cloudTrainingEpochs : 'Invalid'}</strong>
                        <span className="text-gray-500">Dataset now</span><strong className="text-gray-200 text-right">{selectedVoiceStatus ? `${selectedVoiceStatus.sampleCount} clips / ${(Number(selectedVoiceStatus.durationSeconds || 0) / 60).toFixed(1)} min` : 'Unavailable'}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-4">
                  <h5 className="text-xs font-bold text-amber-100">Recommended before exporting</h5>
                  <ol className="list-decimal pl-4 mt-2 space-y-1 text-[10px] text-gray-400">
                    <li>Stop capture and wait for any local training job to finish so the package is a stable snapshot.</li>
                    <li>Aim for 15-30 minutes of only the target speaking naturally: normal, excited, quiet, questions, Thai, and some English.</li>
                    <li>Remove overlapping friends, music, game audio, strong echo, microphone bumps, and distorted shouting.</li>
                    <li>For the first fine-tune, use 25-40 epochs. Use about 100 epochs for a fresh comparison run.</li>
                    {trainingTarget === 'laptop_4050_6gb' && <li>Plug in the laptop, use its performance/cooling mode, keep 20 GB free, and stop the bot plus GPU-heavy apps before running the exported script.</li>}
                    <li>Never upload this project’s .env, Discord token, or voice API token.</li>
                  </ol>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={checkCloudExportReadiness}
                    disabled={!selectedControlUserId || !validCloudTrainingEpochs || cloudExportBusy !== null}
                    className="px-4 py-2.5 bg-white/5 border border-white/10 disabled:opacity-40 text-gray-200 rounded-lg text-xs font-bold"
                  >
                    {cloudExportBusy === 'preview' ? 'Checking...' : 'Check Export Readiness'}
                  </button>
                  <button
                    onClick={downloadCloudTrainingExport}
                    disabled={!cloudExportPreview?.ready || cloudExportBusy !== null}
                    className="px-5 py-2.5 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-sky-100 rounded-lg text-xs font-bold"
                  >
                    {cloudExportBusy === 'export' ? 'Cleaning & Packaging...' : `Create & Download ${trainingTarget === 'laptop_4050_6gb' ? 'Laptop' : 'Vast.ai'} ZIP`}
                  </button>
                </div>

                {cloudExportMessage && <p className="text-xs text-gray-300 bg-black/20 border border-white/5 rounded-lg px-3 py-2">{cloudExportMessage}</p>}

                {cloudExportResult && (
                  <div className="bg-emerald-500/5 border border-emerald-400/30 rounded-xl p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h5 className="text-sm font-bold text-emerald-100">ZIP ready - copy one command into {trainingTarget === 'laptop_4050_6gb' ? 'PowerShell' : 'Vast.ai'}</h5>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {trainingTarget === 'laptop_4050_6gb'
                            ? 'Keep the ZIP in your Windows Downloads folder, open PowerShell, and paste this entire block. It verifies and extracts the package before training.'
                            : <>Upload the downloaded ZIP to <code className="text-emerald-200">/workspace</code>, wait for the full size shown below, open Jupyter Terminal, then paste this entire block.</>}
                        </p>
                      </div>
                      <button
                        onClick={copyCloudPasteCommand}
                        className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-100 rounded-lg text-xs font-bold"
                      >
                        {cloudCommandCopied ? 'Copied!' : `Copy ${trainingTarget === 'laptop_4050_6gb' ? 'Laptop' : 'Vast.ai'} Command`}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 text-[10px]">
                      <div className="bg-black/25 rounded-lg p-2.5"><span className="block text-gray-500">Upload this file</span><strong className="text-gray-200 break-all">{cloudExportResult.filename}</strong></div>
                      <div className="bg-black/25 rounded-lg p-2.5"><span className="block text-gray-500">Expected upload size</span><strong className="text-gray-200">{cloudExportResult.sizeBytes.toLocaleString()} bytes ({(cloudExportResult.sizeBytes / 1024 / 1024).toFixed(1)} MiB)</strong></div>
                      <div className="bg-black/25 rounded-lg p-2.5"><span className="block text-gray-500">Training script</span><strong className="text-gray-200 break-all">{cloudExportResult.commandScript}</strong></div>
                    </div>
                    <pre className="bg-black/60 border border-white/10 rounded-lg p-3 font-mono text-[10px] leading-relaxed text-emerald-100 overflow-x-auto whitespace-pre">{cloudExportResult.pasteCommand}</pre>
                    <p className="text-[10px] text-gray-500">
                      {trainingTarget === 'laptop_4050_6gb'
                        ? 'The command verifies ZIP size and SHA-256, extracts to Downloads\\DigitalMeTraining, checks the NVIDIA GPU, and starts the laptop-safe PowerShell plan.'
                        : "The pasted command refuses incomplete uploads, verifies SHA-256, extracts into this export's own folder, detects Vast's automatic tmux session, and starts the selected training plan."}
                    </p>
                  </div>
                )}

                {cloudExportPreview && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-3">
                      <h6 className="text-[10px] font-bold uppercase text-red-200">Blocking ({cloudExportPreview.blockers?.length || 0})</h6>
                      {(cloudExportPreview.blockers?.length ? cloudExportPreview.blockers : ['Nothing is blocking this export.']).map((item: string) => <p key={item} className="text-[10px] text-gray-400 mt-1.5">• {item}</p>)}
                    </div>
                    <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3">
                      <h6 className="text-[10px] font-bold uppercase text-amber-200">Warnings ({cloudExportPreview.warnings?.length || 0})</h6>
                      {(cloudExportPreview.warnings?.length ? cloudExportPreview.warnings : ['No warnings for the selected package.']).map((item: string) => <p key={item} className="text-[10px] text-gray-400 mt-1.5">• {item}</p>)}
                    </div>
                    <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-3">
                      <h6 className="text-[10px] font-bold uppercase text-emerald-200">Recommendations</h6>
                      {(cloudExportPreview.recommendations || []).slice(0, 5).map((item: string) => <p key={item} className="text-[10px] text-gray-400 mt-1.5">• {item}</p>)}
                    </div>
                  </div>
                )}

                {trainingTarget === 'laptop_4050_6gb' ? (
                  <div className="bg-black/25 border border-emerald-500/20 rounded-xl p-4 space-y-4">
                    <div>
                      <h5 className="text-xs font-bold text-emerald-100">Clear RTX 4050 laptop instructions</h5>
                      <p className="text-[10px] text-gray-500 mt-1">The export creates the safe Windows training command from your choices.</p>
                    </div>
                    <ol className="space-y-3 text-[11px] text-gray-400">
                      <li><strong className="text-gray-200">1. Prepare the laptop.</strong> Plug it in, enable its performance/cooling mode, keep at least 20 GB free, and stop the Discord bot plus GPU-heavy apps.</li>
                      <li><strong className="text-gray-200">2. Create the package.</strong> Choose Train New or Fine-tune, Best/Latest, epochs, run Check Export Readiness, then click Create & Download Laptop ZIP.</li>
                      <li><strong className="text-gray-200">3. Keep the ZIP in Downloads.</strong> The copied command expects the completed ZIP in your normal Windows Downloads folder. You can edit its first line if your browser saves elsewhere.</li>
                      <li><strong className="text-gray-200">4. Copy the generated laptop command.</strong> Press Copy Laptop Command in the green panel, open PowerShell, and paste the full block once.</li>
                      <li><strong className="text-gray-200">5. Let setup finish.</strong> It verifies the ZIP, reuses the existing DiscordBOT RVC environment when possible, or installs the pinned environment on the first run.</li>
                      <li><strong className="text-gray-200">6. Keep PowerShell open.</strong> Training starts at batch 2, retries at batch 1 if 6 GB VRAM is insufficient, uses 2 data workers, and limits auxiliary CPU math to 6 threads.</li>
                      <li><strong className="text-gray-200">7. Use the result.</strong> When training finishes, find <code className="text-emerald-200">DOWNLOAD_ME_*.zip</code> in the extracted run folder under <code className="text-emerald-200">Downloads\DigitalMeTraining</code>.</li>
                    </ol>
                  </div>
                ) : (
                <div className="bg-black/25 border border-sky-500/20 rounded-xl p-4 space-y-4">
                  <div>
                    <h5 className="text-xs font-bold text-sky-100">Clear Vast.ai instructions - from this dashboard to the finished model</h5>
                    <p className="text-[10px] text-gray-500 mt-1">You do not need to write the RVC training command yourself. The export creates it from the choices above.</p>
                  </div>
                  <ol className="space-y-3 text-[11px] text-gray-400">
                    <li><strong className="text-gray-200">1. Create the package on this PC.</strong> Choose Train New or Fine-tune, choose Best/Latest if needed, enter epochs, run Check Export Readiness, then click Create & Download Vast.ai ZIP.</li>
                    <li><strong className="text-gray-200">2. Rent the GPU.</strong> In Vast.ai choose one on-demand RTX 3090 or 4090 with 24 GB VRAM, a verified reliable host, a PyTorch or Ubuntu 24.04 template with Python 3.12, Jupyter + SSH, and 60-80 GB disk.</li>
                    <li><strong className="text-gray-200">3. Upload the ZIP.</strong> Open the instance's Jupyter page, enter <code className="text-sky-200">/workspace</code>, upload the exact ZIP named by the green result panel, and wait until Jupyter shows the expected full size.</li>
                    <li><strong className="text-gray-200">4. Copy the generated cloud command.</strong> After the download finishes, press <strong className="text-gray-200">Copy Vast.ai Command</strong> in the green panel above. It includes the exact filename, byte count, SHA-256, extraction folder, and training script.</li>
                    <li>
                      <strong className="text-gray-200">5. Paste once in Jupyter Terminal.</strong>
                      <p className="mt-1 text-[10px] text-gray-500">The command automatically verifies the upload, extracts it, detects whether Vast already placed the terminal inside tmux, and uses {cloudTrainingMode === 'fresh' ? 'the generic RVC base to train a new model' : `the ${cloudModelSelection} checkpoint to fine-tune the existing model`} for {cloudTrainingEpochs} epochs.</p>
                    </li>
                    <li><strong className="text-gray-200">6. Leave it running.</strong> Press Ctrl+B, then D to detach. Reconnect later with <code className="text-sky-200">tmux attach -t digitalme</code>. Closing Jupyter after detaching does not stop tmux.</li>
                    <li><strong className="text-gray-200">7. Download the result.</strong> When training finishes, download <code className="text-sky-200">DOWNLOAD_ME_*.zip</code> from Jupyter. It contains Best, Latest, the RVC index, metrics, and logs.</li>
                    <li><strong className="text-gray-200">8. End billing safely.</strong> Confirm the result ZIP opens on your PC, then destroy the Vast.ai instance. Stopping alone can continue storage charges.</li>
                  </ol>
                  <a href="https://docs.vast.ai/pytorch" target="_blank" rel="noreferrer" className="inline-block text-sky-300 hover:text-sky-200 text-[11px]">Open the official Vast.ai PyTorch guide</a>
                </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-[#101010] border border-white/5 rounded-xl p-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-white mr-2">Consent & Privacy</span>
            <button onClick={() => runDashboardCommand('voice-consent', { action: 'status' })} className="px-3 py-2 bg-white/5 text-gray-300 rounded-lg text-xs">Consent Status</button>
            <button onClick={() => runDashboardCommand('voice-consent', { action: 'revoke' })} disabled={!selectedControlUser?.consented} className="px-3 py-2 bg-amber-500/10 disabled:opacity-40 text-amber-300 rounded-lg text-xs">Revoke</button>
          </div>

          {controlMessage && <div className="p-3 bg-black/30 border border-white/10 rounded-xl text-xs font-mono text-gray-200">{controlBusy ? '⏳ ' : ''}{controlMessage}</div>}
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
                    return evt.type === 'TRANSCRIPT_FINAL' || evt.type === 'TRANSCRIPT_PARTIAL' || evt.type === 'NON_SPEECH' || evt.type === 'BOT_RESPONSE';
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

                  if (evt.type === 'NON_SPEECH') {
                    return (
                      <div key={idx} className="p-3 bg-amber-500/5 rounded-xl border border-amber-500/20 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-amber-300">{evt.displayName || evt.username}</span>
                          <span className="text-[10px] font-mono text-gray-500">{timeStr}</span>
                        </div>
                        <p className="text-xs text-amber-100/80 pl-2">
                          {evt.displayText || '[เสียงรบกวน]'}
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
                            <span className="text-[10px] bg-[#5865F2]/20 text-[#5865F2] border border-[#5865F2]/40 px-2 py-0.5 rounded-full font-mono">Bot Voice Reply</span>
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
              <span>🔊</span> Test Configured TTS Bridge
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              Type any sentence below to test the configured Colab or local TTS endpoint.
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

        {/* Persistent Social Brain */}
        <div className="bg-[#161616] p-8 rounded-2xl border border-emerald-500/15 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white">Persistent Social Brain</h3>
              <p className="text-xs text-gray-400 mt-1">Learns from consented conversations: people, nicknames, relationships, games, activities, and evidence-backed facts.</p>
            </div>
            <button onClick={exportBrainVault} className="px-4 py-2 bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 rounded-xl text-xs">Update Obsidian Vault</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#101010] rounded-xl p-4 border border-white/5"><p className="text-[10px] text-gray-500 uppercase">Observations</p><p className="text-2xl font-bold text-white">{brainState?.totalObservations || 0}</p></div>
            <div className="bg-[#101010] rounded-xl p-4 border border-white/5"><p className="text-[10px] text-gray-500 uppercase">People</p><p className="text-2xl font-bold text-white">{brainState?.people?.length || 0}</p></div>
            <div className="bg-[#101010] rounded-xl p-4 border border-white/5"><p className="text-[10px] text-gray-500 uppercase">Relationships</p><p className="text-2xl font-bold text-white">{brainState?.relationships?.length || 0}</p></div>
            <div className="bg-[#101010] rounded-xl p-4 border border-white/5"><p className="text-[10px] text-gray-500 uppercase">Storage</p><p className="text-xs font-bold text-emerald-300 mt-2 truncate" title={brainState?.vaultPath}>{brainState?.vaultPath ? 'Local vault ready' : 'Waiting'}</p></div>
          </div>

          <div className="flex gap-2">
            <input value={brainQuery} onChange={(event) => setBrainQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void refreshControl(); }} placeholder="Search what people said, games, or activities..." className="flex-1 bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white" />
            <button onClick={refreshControl} className="px-5 py-2.5 bg-emerald-500/15 text-emerald-300 rounded-xl text-xs font-bold">Search Brain</button>
          </div>

          {brainState?.searchResults?.length > 0 && (
            <div className="bg-[#101010] border border-emerald-500/10 rounded-xl p-4 space-y-2 max-h-48 overflow-y-auto">
              {brainState.searchResults.map((item: any) => <div key={item.id} className="text-xs"><span className="text-emerald-300 font-bold">{item.speakerName}</span><span className="text-gray-500 mx-2">{new Date(item.timestamp).toLocaleString()}</span><span className="text-gray-200">{item.text}</span></div>)}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">People learned</p>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {(brainState?.people || []).map((person: any) => {
                  const games = Object.entries(person.games || {}).sort((a: any, b: any) => b[1].count - a[1].count).slice(0, 3).map(([name]) => name);
                  const activities = Object.entries(person.activities || {}).sort((a: any, b: any) => b[1].count - a[1].count).slice(0, 3).map(([name]) => name);
                  return <div key={person.userId} className="p-3 bg-[#101010] border border-white/5 rounded-xl">
                    <div><p className="text-sm font-bold text-white">{person.displayNames?.[0] || person.userId}</p><p className="text-[10px] text-gray-500">Called: {(person.aliases || []).slice(0, 6).join(', ') || 'unknown'} · {person.utteranceCount} utterances</p></div>
                    {(games.length > 0 || activities.length > 0) && <p className="text-[11px] text-gray-300 mt-2">{games.length ? `Games: ${games.join(', ')}` : ''}{games.length && activities.length ? ' · ' : ''}{activities.length ? `Activities: ${activities.join(', ')}` : ''}</p>}
                  </div>;
                })}
                {!brainState?.people?.length && <p className="text-xs text-gray-500 p-4">The brain will populate after consented users speak in VC.</p>}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Relationship graph evidence</p>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {(brainState?.relationships || []).slice(0, 30).map((relationship: any) => {
                  const names = relationship.userIds.map((id: string) => brainState.people?.find((person: any) => person.userId === id)?.displayNames?.[0] || id);
                  return <div key={relationship.id} className="p-3 bg-[#101010] border border-white/5 rounded-xl flex justify-between gap-3"><div><p className="text-xs font-bold text-white">{names.join(' ↔ ')}</p><p className="text-[10px] text-gray-500">Names used: {Object.keys(relationship.addressTerms || {}).join(', ') || 'not enough evidence yet'}</p></div><span className="text-xs font-mono text-emerald-300">{relationship.interactionCount}</span></div>;
                })}
                {!brainState?.relationships?.length && <p className="text-xs text-gray-500 p-4">Relationships appear as people address and reply to each other.</p>}
              </div>
            </div>
          </div>

          <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-xl text-[11px] text-amber-200/80">
            Learning is limited to users with active consent. Raw evidence stays local, versioned, searchable, and exportable to Obsidian for review.
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

          <div className="p-4 bg-[#111111] rounded-xl border border-[#5865F2]/30 space-y-3">
            <div>
              <p className="text-xs font-bold text-[#8ea1e1] uppercase tracking-wider">Active Clone Identity</p>
              <p className="text-[11px] text-gray-500 mt-1">The selected voice will recognize these names as itself and use the behavior examples saved below.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Discord User ID</label>
                <input value={personaUserId} onChange={(e) => setPersonaUserId(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#5865F2]" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Who the clone is</label>
                <input value={personaName} onChange={(e) => setPersonaName(e.target.value)} placeholder="Gam" className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#5865F2]" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Names friends call this person, separated by commas</label>
              <input value={personaAliases} onChange={(e) => setPersonaAliases(e.target.value)} placeholder="Gam, Gam0565, แกม, แก้ม" className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#5865F2]" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Personality description</label>
              <input value={personaDescription} onChange={(e) => setPersonaDescription(e.target.value)} placeholder="How Gam normally talks and behaves with friends" className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#5865F2]" />
            </div>
            <button onClick={handleSavePersona} disabled={isSavingPersona} className="w-full py-2.5 bg-[#5865F2] hover:bg-[#4752C4] disabled:bg-gray-800 text-white text-xs font-bold rounded-lg transition-colors">
              {isSavingPersona ? 'Saving identity...' : 'Save Clone Identity'}
            </button>
            {personaSuccess && <p className="text-xs text-green-400 font-mono">{personaSuccess}</p>}
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
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">🎙️ Consented Voice Samples ({voiceSamples.length}):</p>
              <span className={`text-[10px] font-mono ${recordRawAudio ? 'text-yellow-400' : 'text-gray-500'}`}>
                {recordRawAudio ? '● Global capture enabled; per-user grant required' : '○ Recording disabled by default'}
              </span>
            </div>
            {voiceSamples.length === 0 ? (
              <p className="text-xs text-gray-500 italic bg-[#111111] p-3 rounded-xl border border-white/5">
                {recordRawAudio
                  ? 'No voice samples captured yet. Use /train @member and have that person click Allow.'
                  : 'Raw capture is disabled. Consent records alone do not enable recording.'}
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
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em] px-1">Runtime Capabilities</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-4 bg-[#111111] border border-white/5 rounded-xl">
                  <div className="flex items-center gap-4">
                    <div>🎙️</div>
                    <div>
                      <p className="text-sm font-bold text-white">Opus Audio Receiver</p>
                      <p className="text-[10px] text-gray-500 uppercase">{status === 'Connected' ? 'Discord connected' : 'Standby'}</p>
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono ${status === 'Connected' ? 'text-green-400' : 'text-gray-500'}`}>{status === 'Connected' ? 'LISTENING READY' : 'NOT CONNECTED'}</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-[#111111] border border-white/5 rounded-xl">
                  <div className="flex items-center gap-4">
                    <div>🧠</div>
                    <div>
                      <p className="text-sm font-bold text-white">Social Brain</p>
                      <p className="text-[10px] text-gray-500 uppercase">Deterministic Thai rules</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-green-400">VERIFIED</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-[#111111] border border-white/5 rounded-xl">
                  <div className="flex items-center gap-4">
                    <div>🎭</div>
                    <div>
                      <p className="text-sm font-bold text-white">Response Generator (Personality)</p>
                      <p className="text-[10px] text-gray-500 uppercase">Fallback rules + optional local LLM</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-green-400">FALLBACK READY</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-[#111111] border border-white/5 rounded-xl">
                  <div className="flex items-center gap-4">
                    <div>🗣️</div>
                    <div>
                      <p className="text-sm font-bold text-white">RVC Voice Service</p>
                      <p className="text-[10px] text-gray-500 uppercase">Drive samples + queued training + cloned inference</p>
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono ${colabUrl && colabAuthenticated ? 'text-green-400' : 'text-yellow-400'}`}>{colabUrl && colabAuthenticated ? 'CONFIGURED' : 'SETUP NEEDED'}</span>
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
                  <div className="flex gap-3"><span className="text-gray-600">[00:00:04]</span> <span className={colabUrl ? 'text-green-400' : 'text-yellow-400'}>TTS</span> <span>{colabUrl ? `TTS bridge configured (${colabUrl}).` : 'No TTS bridge configured.'}</span></div>
                  <div className="flex gap-3 animate-pulse mt-4"><span className="text-gray-600">[{new Date().toLocaleTimeString('en-US', { hour12: false })}]</span> <span className="text-blue-400">INFO</span> <span className="text-white">{status === 'Connected' ? 'Waiting for Discord gateway events...' : 'Dashboard ready; Discord is disconnected.'}</span><span className="inline-block w-1.5 h-3 bg-white ml-1"></span></div>
                </div>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}
