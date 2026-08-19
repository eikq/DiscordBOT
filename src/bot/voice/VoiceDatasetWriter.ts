import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { analyzeVoiceUtterance, type VoiceUtteranceAnalysis } from './VoiceUtteranceAnalyzer';

export interface VoiceTranscriptData {
  text: string;
  confidence: number;
  latencyMs: number;
  detectedLanguage?: string;
  model?: string;
  languageFallbackApplied?: boolean;
}

export interface SaveVoiceUtteranceInput {
  guildId: string;
  sessionId: string;
  learningSessionId?: string;
  eventId: string;
  userId: string;
  username: string;
  displayName: string;
  speechStartedAt: number;
  speechEndedAt: number;
  pcmBuffer: Buffer;
  transcript: VoiceTranscriptData | null;
  suspectedOverlap?: boolean;
}

export interface VoiceUtteranceRecord {
  schemaVersion: 2;
  id: string;
  guildId: string;
  sessionId: string;
  learningSessionId?: string;
  discordUserId: string;
  username: string;
  displayName: string;
  speechStartedAt: number;
  speechEndedAt: number;
  durationSeconds: number;
  audioFile: string;
  transcriptFile: string;
  metadataFile: string;
  audioSha256: string;
  audioBytes: number;
  transcriptStatus: 'complete' | 'unavailable';
  transcript: VoiceTranscriptData | null;
  languageHints: ['th', 'en'];
  consentVerifiedAtCapture: true;
  consent: {
    verified: true;
    verifiedAt: number;
    mechanism: 'discord_active_consent';
  };
  analysis: VoiceUtteranceAnalysis;
}

interface VoiceDatasetFile {
  schemaVersion: 2;
  speaker: {
    discordUserId: string;
    username: string;
    displayName: string;
  };
  updatedAt: number;
  utterances: VoiceUtteranceRecord[];
}

export interface SavedVoiceUtterance {
  record: VoiceUtteranceRecord;
  wavBuffer: Buffer;
  absoluteAudioPath: string;
}

export class VoiceDatasetWriter {
  constructor(private readonly samplesRoot = path.join(process.cwd(), 'data', 'voice_samples')) {}

  public save(input: SaveVoiceUtteranceInput): SavedVoiceUtterance {
    if (!/^\d{5,32}$/.test(input.userId)) {
      throw new Error('Refusing to write voice data for an invalid Discord user ID.');
    }
    if (!input.pcmBuffer.length) throw new Error('Cannot save an empty voice utterance.');

    const speakerDir = path.join(this.samplesRoot, input.userId);
    fs.mkdirSync(speakerDir, { recursive: true });

    const safeEventId = input.eventId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'speech';
    const utteranceId = `utterance_${input.speechStartedAt}_${safeEventId}`;
    const audioName = `${utteranceId}.wav`;
    const transcriptName = `${utteranceId}.txt`;
    const metadataName = `${utteranceId}.json`;
    const audioPath = path.join(speakerDir, audioName);
    const transcriptPath = path.join(speakerDir, transcriptName);
    const metadataPath = path.join(speakerDir, metadataName);
    const wavBuffer = this.createStereoWav(input.pcmBuffer);
    const durationSeconds = Number((input.pcmBuffer.length / (48_000 * 2 * 2)).toFixed(3));
    const analysis = analyzeVoiceUtterance(input.pcmBuffer, input.transcript, {
      suspectedOverlap: input.suspectedOverlap,
    });
    const record: VoiceUtteranceRecord = {
      schemaVersion: 2,
      id: utteranceId,
      guildId: input.guildId,
      sessionId: input.sessionId,
      learningSessionId: input.learningSessionId,
      discordUserId: input.userId,
      username: input.username,
      displayName: input.displayName,
      speechStartedAt: input.speechStartedAt,
      speechEndedAt: input.speechEndedAt,
      durationSeconds,
      audioFile: `/data/voice_samples/${input.userId}/${audioName}`,
      transcriptFile: `/data/voice_samples/${input.userId}/${transcriptName}`,
      metadataFile: `/data/voice_samples/${input.userId}/${metadataName}`,
      audioSha256: createHash('sha256').update(wavBuffer).digest('hex'),
      audioBytes: wavBuffer.length,
      transcriptStatus: input.transcript ? 'complete' : 'unavailable',
      transcript: input.transcript,
      languageHints: ['th', 'en'],
      consentVerifiedAtCapture: true,
      consent: {
        verified: true,
        verifiedAt: input.speechStartedAt,
        mechanism: 'discord_active_consent',
      },
      analysis,
    };

    fs.writeFileSync(audioPath, wavBuffer);
    fs.writeFileSync(transcriptPath, input.transcript?.text ?? '', 'utf8');
    this.writeJsonAtomic(metadataPath, record);
    this.appendUserDataset(speakerDir, input, record);
    this.appendCatalog(record, wavBuffer.length);
    return { record, wavBuffer, absoluteAudioPath: audioPath };
  }

  private appendUserDataset(
    speakerDir: string,
    input: SaveVoiceUtteranceInput,
    record: VoiceUtteranceRecord,
  ): void {
    const datasetPath = path.join(speakerDir, 'utterances.json');
    let utterances: VoiceUtteranceRecord[] = [];
    if (fs.existsSync(datasetPath)) {
      try {
        const previous = JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as Partial<VoiceDatasetFile>;
        if (Array.isArray(previous.utterances)) utterances = previous.utterances;
      } catch {
        utterances = [];
      }
    }
    utterances.push(record);
    const dataset: VoiceDatasetFile = {
      schemaVersion: 2,
      speaker: {
        discordUserId: input.userId,
        username: input.username,
        displayName: input.displayName,
      },
      updatedAt: Date.now(),
      utterances,
    };
    this.writeJsonAtomic(datasetPath, dataset);
  }

  private appendCatalog(record: VoiceUtteranceRecord, sizeBytes: number): void {
    fs.mkdirSync(this.samplesRoot, { recursive: true });
    const catalogPath = path.join(this.samplesRoot, 'catalog.json');
    let catalog: Array<Record<string, unknown>> = [];
    if (fs.existsSync(catalogPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        if (Array.isArray(parsed)) catalog = parsed;
      } catch {
        catalog = [];
      }
    }
    catalog.unshift({
      speaker: record.displayName,
      username: record.username,
      userId: record.discordUserId,
      file: record.audioFile,
      transcriptFile: record.transcriptFile,
      metadataFile: record.metadataFile,
      transcript: record.transcript?.text ?? null,
      transcriptStatus: record.transcriptStatus,
      sizeBytes,
      durationSec: record.durationSeconds,
      timestamp: record.speechStartedAt,
      eventId: record.id,
      learningSessionId: record.learningSessionId ?? null,
      qualityScore: record.analysis.quality.score,
      acceptedForVoiceTraining: record.analysis.quality.acceptedForVoiceTraining,
      acceptedForExpressiveTts: record.analysis.quality.acceptedForExpressiveTts,
      speakingStyle: record.analysis.prosody.style,
    });
    if (catalog.length > 300) catalog = catalog.slice(0, 300);
    this.writeJsonAtomic(catalogPath, catalog);
  }

  private writeJsonAtomic(filePath: string, value: unknown): void {
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporaryPath, filePath);
  }

  private createStereoWav(pcmBuffer: Buffer): Buffer {
    const wavHeader = Buffer.alloc(44);
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(2, 22);
    wavHeader.writeUInt32LE(48_000, 24);
    wavHeader.writeUInt32LE(48_000 * 2 * 2, 28);
    wavHeader.writeUInt16LE(2 * 2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(pcmBuffer.length, 40);
    return Buffer.concat([wavHeader, pcmBuffer]);
  }
}
