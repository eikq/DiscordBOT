import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LearnedVoiceStyle } from './VoiceUtteranceAnalyzer';
import type { VoiceUtteranceRecord } from './VoiceDatasetWriter';

export type LearningSessionStatus =
  | 'listening'
  | 'processing'
  | 'training'
  | 'ready'
  | 'insufficient_data'
  | 'failed'
  | 'interrupted';

export interface LearningSessionCounters {
  capturedClips: number;
  capturedSeconds: number;
  acceptedVoiceClips: number;
  acceptedVoiceSeconds: number;
  acceptedExpressiveClips: number;
  rejectedClips: number;
  transcribedClips: number;
  styleCounts: Record<LearnedVoiceStyle, number>;
  rejectionReasons: Record<string, number>;
}

export interface LearningSessionRecord {
  schemaVersion: 1;
  id: string;
  guildId: string;
  targetUserId: string;
  targetUsername: string;
  targetDisplayName: string;
  startedByUserId: string;
  notificationChannelId?: string;
  status: LearningSessionStatus;
  startedAt: number;
  stoppedAt?: number;
  updatedAt: number;
  stopReason?: string;
  datasetVersionId?: string;
  datasetManifestFile?: string;
  training?: {
    decision: 'fresh' | 'finetune' | 'wait' | 'none';
    modelSelection?: 'best' | 'latest';
    epochs?: number;
    jobId?: string;
    reason: string;
    updatedAt: number;
  };
  counters: LearningSessionCounters;
  utterances: LearningSessionUtteranceSummary[];
}

export interface LearningSessionUtteranceSummary {
  id: string;
  speechStartedAt: number;
  durationSeconds: number;
  transcript: string | null;
  transcriptConfidence: number | null;
  qualityScore: number;
  acceptedForVoiceTraining: boolean;
  acceptedForExpressiveTts: boolean;
  rejectionReasons: string[];
  style: LearnedVoiceStyle;
  styleConfidence: number;
  audioFile: string;
  metadataFile: string;
  audioSha256: string;
}

export interface DatasetVersionManifest {
  schemaVersion: 1;
  versionId: string;
  createdAt: number;
  sourceLearningSessionId: string;
  speaker: {
    discordUserId: string;
    username: string;
    displayName: string;
  };
  qualityPolicy: {
    voiceTraining: 'analysis.quality.acceptedForVoiceTraining';
    expressiveTts: 'analysis.quality.acceptedForExpressiveTts';
    speakerVerification: 'discord_ssrc_plus_active_consent';
  };
  summary: LearningSessionCounters & {
    voiceAcceptanceRate: number;
    expressiveAcceptanceRate: number;
  };
  acceptedVoiceTrainingUtteranceIds: string[];
  acceptedExpressiveTtsUtteranceIds: string[];
  utterances: LearningSessionUtteranceSummary[];
}

export interface AutomaticTrainingDecisionInput {
  modelReady: boolean;
  serviceDurationSeconds: number;
  newAcceptedSeconds: number;
  jobStatus?: 'queued' | 'training' | 'stopping' | 'ready' | 'failed' | null;
  minimumFreshSeconds: number;
  minimumFinetuneSeconds: number;
}

export interface AutomaticTrainingDecision {
  action: 'fresh' | 'finetune' | 'wait' | 'none';
  reason: string;
}

export function decideAutomaticTraining(input: AutomaticTrainingDecisionInput): AutomaticTrainingDecision {
  if (input.jobStatus === 'queued' || input.jobStatus === 'training' || input.jobStatus === 'stopping') {
    return { action: 'wait', reason: `A training job is already ${input.jobStatus}.` };
  }
  if (input.modelReady) {
    if (input.newAcceptedSeconds >= input.minimumFinetuneSeconds) {
      return {
        action: 'finetune',
        reason: `${input.newAcceptedSeconds.toFixed(1)} new clean seconds are ready for fine-tuning.`,
      };
    }
    return {
      action: 'none',
      reason: `Need ${input.minimumFinetuneSeconds.toFixed(0)} new clean seconds; session has ${input.newAcceptedSeconds.toFixed(1)}.`,
    };
  }
  if (input.serviceDurationSeconds >= input.minimumFreshSeconds) {
    return {
      action: 'fresh',
      reason: `${input.serviceDurationSeconds.toFixed(1)} total clean seconds are ready for the first model.`,
    };
  }
  return {
    action: 'none',
    reason: `Need ${input.minimumFreshSeconds.toFixed(0)} total clean seconds; service has ${input.serviceDurationSeconds.toFixed(1)}.`,
  };
}

export class LearningSessionController {
  private readonly activeByGuild = new Map<string, string>();
  private readonly sessions = new Map<string, LearningSessionRecord>();

  constructor(
    private readonly root = path.join(process.cwd(), 'data', 'learning_sessions'),
    private readonly voiceSamplesRoot = path.join(process.cwd(), 'data', 'voice_samples'),
  ) {
    fs.mkdirSync(this.root, { recursive: true });
    this.loadExistingSessions();
  }

  public start(input: {
    guildId: string;
    targetUserId: string;
    targetUsername: string;
    targetDisplayName: string;
    startedByUserId: string;
    notificationChannelId?: string;
  }): LearningSessionRecord {
    const existing = this.getActive(input.guildId);
    if (existing) {
      if (existing.targetUserId !== input.targetUserId) {
        throw new Error(`A learning session is already listening to ${existing.targetDisplayName}. Stop it first.`);
      }
      return existing;
    }
    const now = Date.now();
    const session: LearningSessionRecord = {
      schemaVersion: 1,
      id: `learn_${now}_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      guildId: input.guildId,
      targetUserId: input.targetUserId,
      targetUsername: input.targetUsername,
      targetDisplayName: input.targetDisplayName,
      startedByUserId: input.startedByUserId,
      notificationChannelId: input.notificationChannelId,
      status: 'listening',
      startedAt: now,
      updatedAt: now,
      counters: emptyCounters(),
      utterances: [],
    };
    this.sessions.set(session.id, session);
    this.activeByGuild.set(session.guildId, session.id);
    this.persist(session);
    return structuredClone(session);
  }

  public getActive(guildId: string): LearningSessionRecord | null {
    const id = this.activeByGuild.get(guildId);
    const session = id ? this.sessions.get(id) : undefined;
    return session ? structuredClone(session) : null;
  }

  public get(sessionId: string): LearningSessionRecord | null {
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(session) : null;
  }

  public listRecent(limit = 20): LearningSessionRecord[] {
    return [...this.sessions.values()]
      .sort((first, second) => second.startedAt - first.startedAt)
      .slice(0, Math.max(1, limit))
      .map(session => structuredClone(session));
  }

  public recordUtterance(guildId: string, record: VoiceUtteranceRecord): LearningSessionRecord | null {
    const sessionId = this.activeByGuild.get(guildId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session || session.status !== 'listening' || session.targetUserId !== record.discordUserId) return null;
    if (session.utterances.some(item => item.id === record.id)) return structuredClone(session);

    const summary = toUtteranceSummary(record);
    session.utterances.push(summary);
    const counters = session.counters;
    counters.capturedClips++;
    counters.capturedSeconds = round(counters.capturedSeconds + record.durationSeconds);
    if (record.analysis.quality.acceptedForVoiceTraining) {
      counters.acceptedVoiceClips++;
      counters.acceptedVoiceSeconds = round(counters.acceptedVoiceSeconds + record.durationSeconds);
    } else {
      counters.rejectedClips++;
      for (const reason of record.analysis.quality.reasons) {
        counters.rejectionReasons[reason] = (counters.rejectionReasons[reason] ?? 0) + 1;
      }
    }
    if (record.analysis.quality.acceptedForExpressiveTts) counters.acceptedExpressiveClips++;
    if (record.transcriptStatus === 'complete') counters.transcribedClips++;
    const style = record.analysis.prosody.style;
    counters.styleCounts[style] = (counters.styleCounts[style] ?? 0) + 1;
    session.updatedAt = Date.now();
    this.persist(session);
    return structuredClone(session);
  }

  public stop(guildId: string, reason = 'requested'): LearningSessionRecord | null {
    const sessionId = this.activeByGuild.get(guildId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) return null;
    session.status = 'processing';
    session.stoppedAt = Date.now();
    session.updatedAt = session.stoppedAt;
    session.stopReason = reason;
    this.activeByGuild.delete(guildId);

    const manifest = this.createDatasetVersion(session);
    session.datasetVersionId = manifest.versionId;
    session.datasetManifestFile = `/data/voice_samples/${session.targetUserId}/versions/${manifest.versionId}.json`;
    this.persist(session);
    return structuredClone(session);
  }

  public setTrainingDecision(
    sessionId: string,
    input: {
      decision: 'fresh' | 'finetune' | 'wait' | 'none';
      reason: string;
      modelSelection?: 'best' | 'latest';
      epochs?: number;
      jobId?: string;
      status?: LearningSessionStatus;
    },
  ): LearningSessionRecord | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.training = {
      decision: input.decision,
      reason: input.reason,
      modelSelection: input.modelSelection,
      epochs: input.epochs,
      jobId: input.jobId,
      updatedAt: Date.now(),
    };
    session.status = input.status ?? (input.decision === 'fresh' || input.decision === 'finetune' || input.decision === 'wait'
      ? 'training'
      : 'insufficient_data');
    session.updatedAt = Date.now();
    this.persist(session);
    return structuredClone(session);
  }

  public markFailed(sessionId: string, reason: string): LearningSessionRecord | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.status = 'failed';
    session.training = {
      decision: session.training?.decision ?? 'none',
      reason,
      modelSelection: session.training?.modelSelection,
      epochs: session.training?.epochs,
      jobId: session.training?.jobId,
      updatedAt: Date.now(),
    };
    session.updatedAt = Date.now();
    this.persist(session);
    return structuredClone(session);
  }

  public markReady(sessionId: string, reason = 'Training completed and a model is ready.'): LearningSessionRecord | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.status = 'ready';
    session.training = {
      decision: session.training?.decision ?? 'none',
      reason,
      modelSelection: session.training?.modelSelection,
      epochs: session.training?.epochs,
      jobId: session.training?.jobId,
      updatedAt: Date.now(),
    };
    session.updatedAt = Date.now();
    this.persist(session);
    return structuredClone(session);
  }

  private loadExistingSessions(): void {
    const resumable: LearningSessionRecord[] = [];
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const filePath = path.join(this.root, entry.name);
        const session = JSON.parse(fs.readFileSync(filePath, 'utf8')) as LearningSessionRecord;
        if (!session.id || !session.guildId || !session.targetUserId) continue;
        if (session.status === 'processing') {
          session.status = 'interrupted';
          session.stopReason = 'application_restarted';
          session.stoppedAt ??= Date.now();
          session.updatedAt = Date.now();
          this.persist(session);
        }
        this.sessions.set(session.id, session);
        if (session.status === 'listening') resumable.push(session);
      } catch (error) {
        console.warn(`[LearningSession] Could not read ${entry.name}: ${String(error)}`);
      }
    }

    // Local restarts should not silently discard an active capture session.
    // Resume only the newest listening session per guild; older duplicates are
    // interrupted defensively.
    if (process.env.LEARNING_RESUME_AFTER_RESTART !== 'false') {
      for (const session of resumable.sort((a, b) => b.updatedAt - a.updatedAt)) {
        if (!this.activeByGuild.has(session.guildId)) {
          this.activeByGuild.set(session.guildId, session.id);
          continue;
        }
        session.status = 'interrupted';
        session.stopReason = 'superseded_by_newer_resumed_session';
        session.stoppedAt ??= Date.now();
        session.updatedAt = Date.now();
        this.persist(session);
      }
    } else {
      for (const session of resumable) {
        session.status = 'interrupted';
        session.stopReason = 'application_restarted';
        session.stoppedAt ??= Date.now();
        session.updatedAt = Date.now();
        this.persist(session);
      }
    }
  }

  private createDatasetVersion(session: LearningSessionRecord): DatasetVersionManifest {
    const versionId = `dataset_${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}_${session.id.slice(-8)}`;
    const versionsDir = path.join(this.voiceSamplesRoot, session.targetUserId, 'versions');
    fs.mkdirSync(versionsDir, { recursive: true });
    const denominator = Math.max(1, session.counters.capturedClips);
    const manifest: DatasetVersionManifest = {
      schemaVersion: 1,
      versionId,
      createdAt: Date.now(),
      sourceLearningSessionId: session.id,
      speaker: {
        discordUserId: session.targetUserId,
        username: session.targetUsername,
        displayName: session.targetDisplayName,
      },
      qualityPolicy: {
        voiceTraining: 'analysis.quality.acceptedForVoiceTraining',
        expressiveTts: 'analysis.quality.acceptedForExpressiveTts',
        speakerVerification: 'discord_ssrc_plus_active_consent',
      },
      summary: {
        ...structuredClone(session.counters),
        voiceAcceptanceRate: round(session.counters.acceptedVoiceClips / denominator, 4),
        expressiveAcceptanceRate: round(session.counters.acceptedExpressiveClips / denominator, 4),
      },
      acceptedVoiceTrainingUtteranceIds: session.utterances.filter(item => item.acceptedForVoiceTraining).map(item => item.id),
      acceptedExpressiveTtsUtteranceIds: session.utterances.filter(item => item.acceptedForExpressiveTts).map(item => item.id),
      utterances: structuredClone(session.utterances),
    };
    this.writeJsonAtomic(path.join(versionsDir, `${versionId}.json`), manifest);
    return manifest;
  }

  private persist(session: LearningSessionRecord): void {
    this.writeJsonAtomic(path.join(this.root, `${session.id}.json`), session);
  }

  private writeJsonAtomic(filePath: string, value: unknown): void {
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporaryPath, filePath);
  }
}

function emptyCounters(): LearningSessionCounters {
  return {
    capturedClips: 0,
    capturedSeconds: 0,
    acceptedVoiceClips: 0,
    acceptedVoiceSeconds: 0,
    acceptedExpressiveClips: 0,
    rejectedClips: 0,
    transcribedClips: 0,
    styleCounts: { casual: 0, question: 0, excited: 0, soft: 0, annoyed: 0, unknown: 0 },
    rejectionReasons: {},
  };
}

function toUtteranceSummary(record: VoiceUtteranceRecord): LearningSessionUtteranceSummary {
  return {
    id: record.id,
    speechStartedAt: record.speechStartedAt,
    durationSeconds: record.durationSeconds,
    transcript: record.transcript?.text ?? null,
    transcriptConfidence: record.transcript?.confidence ?? null,
    qualityScore: record.analysis.quality.score,
    acceptedForVoiceTraining: record.analysis.quality.acceptedForVoiceTraining,
    acceptedForExpressiveTts: record.analysis.quality.acceptedForExpressiveTts,
    rejectionReasons: [...record.analysis.quality.reasons],
    style: record.analysis.prosody.style,
    styleConfidence: record.analysis.prosody.styleConfidence,
    audioFile: record.audioFile,
    metadataFile: record.metadataFile,
    audioSha256: record.audioSha256,
  };
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
