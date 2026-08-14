import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { VoiceServiceClient } from '../src/bot/voice/VoiceServiceClient';

dotenv.config({ quiet: true });

if (!process.env.VOICE_API_TOKEN) {
  const tokenPath = path.resolve('.runtime', 'voice_api_token');
  if (fs.existsSync(tokenPath)) process.env.VOICE_API_TOKEN = fs.readFileSync(tokenPath, 'utf8').trim();
}

type JsonObject = Record<string, any>;

function atomicJson(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filePath);
}

function withoutLegacyOverlap(values: unknown): string[] {
  return Array.isArray(values)
    ? values.filter(value => typeof value === 'string' && value !== 'overlapping_speakers')
    : [];
}

function recomputeCounters(utterances: JsonObject[]): JsonObject {
  const counters: JsonObject = {
    capturedClips: utterances.length,
    capturedSeconds: 0,
    acceptedVoiceClips: 0,
    acceptedVoiceSeconds: 0,
    acceptedExpressiveClips: 0,
    rejectedClips: 0,
    transcribedClips: 0,
    styleCounts: { casual: 0, question: 0, excited: 0, soft: 0, annoyed: 0, unknown: 0 },
    rejectionReasons: {},
  };
  for (const item of utterances) {
    const duration = Number(item.durationSeconds || 0);
    counters.capturedSeconds += duration;
    if (item.acceptedForVoiceTraining) {
      counters.acceptedVoiceClips++;
      counters.acceptedVoiceSeconds += duration;
    } else {
      counters.rejectedClips++;
      for (const reason of withoutLegacyOverlap(item.rejectionReasons)) {
        counters.rejectionReasons[reason] = (counters.rejectionReasons[reason] || 0) + 1;
      }
    }
    if (item.acceptedForExpressiveTts) counters.acceptedExpressiveClips++;
    if (typeof item.transcript === 'string' && item.transcript.trim()) counters.transcribedClips++;
    const style = Object.hasOwn(counters.styleCounts, item.style) ? item.style : 'unknown';
    counters.styleCounts[style]++;
  }
  counters.capturedSeconds = Number(counters.capturedSeconds.toFixed(3));
  counters.acceptedVoiceSeconds = Number(counters.acceptedVoiceSeconds.toFixed(3));
  return counters;
}

const sessionId = process.argv.find(value => value.startsWith('learn_'));
const upload = process.argv.includes('--upload');
if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
  throw new Error('Usage: tsx scripts/reclassify_isolated_discord_session.ts learn_SESSION_ID [--upload]');
}

const projectRoot = process.cwd();
const sessionPath = path.join(projectRoot, 'data', 'learning_sessions', `${sessionId}.json`);
if (!fs.existsSync(sessionPath)) throw new Error(`Learning session not found: ${sessionId}`);
const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as JsonObject;
const speakerDir = path.join(projectRoot, 'data', 'voice_samples', String(session.targetUserId));
const datasetPath = path.join(speakerDir, 'utterances.json');
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as JsonObject;
const sessionIds = new Set((session.utterances || []).map((item: JsonObject) => item.id));
const recovered: JsonObject[] = [];
const acceptedRecords: JsonObject[] = [];
const recordsById = new Map<string, JsonObject>();

for (const record of dataset.utterances || []) {
  if (!sessionIds.has(record.id) && record.learningSessionId !== sessionId) continue;
  const quality = record.analysis?.quality;
  if (!quality) continue;
  const previouslyAccepted = quality.acceptedForVoiceTraining === true;
  quality.reasons = withoutLegacyOverlap(quality.reasons);
  quality.expressiveTtsReasons = withoutLegacyOverlap(quality.expressiveTtsReasons);
  quality.acceptedForVoiceTraining = quality.reasons.length === 0;
  quality.acceptedForExpressiveTts = quality.expressiveTtsReasons.length === 0;
  recordsById.set(record.id, record);
  if (!previouslyAccepted && quality.acceptedForVoiceTraining) recovered.push(record);
  if (quality.acceptedForVoiceTraining) acceptedRecords.push(record);
  const metadataPath = path.join(speakerDir, path.basename(String(record.metadataFile || `${record.id}.json`)));
  atomicJson(metadataPath, record);
}

dataset.updatedAt = Date.now();
atomicJson(datasetPath, dataset);

for (const summary of session.utterances || []) {
  const record = recordsById.get(summary.id);
  if (record) {
    summary.acceptedForVoiceTraining = record.analysis.quality.acceptedForVoiceTraining;
    summary.acceptedForExpressiveTts = record.analysis.quality.acceptedForExpressiveTts;
    summary.rejectionReasons = [...record.analysis.quality.reasons];
  } else {
    summary.rejectionReasons = withoutLegacyOverlap(summary.rejectionReasons);
    summary.acceptedForVoiceTraining = summary.rejectionReasons.length === 0;
  }
}
session.counters = recomputeCounters(session.utterances || []);
session.updatedAt = Date.now();
atomicJson(sessionPath, session);

const catalogPath = path.join(projectRoot, 'data', 'voice_samples', 'catalog.json');
if (fs.existsSync(catalogPath)) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as JsonObject[];
  for (const item of catalog) {
    const record = recordsById.get(String(item.eventId || ''));
    if (!record) continue;
    item.acceptedForVoiceTraining = record.analysis.quality.acceptedForVoiceTraining;
    item.acceptedForExpressiveTts = record.analysis.quality.acceptedForExpressiveTts;
  }
  atomicJson(catalogPath, catalog);
}

let uploaded = 0;
if (upload && acceptedRecords.length > 0) {
  const client = new VoiceServiceClient();
  if (!client.isConfigured()) throw new Error('Voice service is not configured for recovered-sample upload.');
  for (const record of acceptedRecords) {
    const audioPath = path.join(speakerDir, path.basename(String(record.audioFile)));
    await client.uploadSample({
      guildId: String(record.guildId || session.guildId),
      userId: String(session.targetUserId),
      displayName: String(session.targetDisplayName || session.targetUserId),
      filename: path.basename(audioPath),
      wavBuffer: fs.readFileSync(audioPath),
    });
    uploaded++;
  }
}

console.log(JSON.stringify({
  sessionId,
  targetUserId: session.targetUserId,
  capturedClips: session.counters.capturedClips,
  acceptedVoiceClips: session.counters.acceptedVoiceClips,
  acceptedVoiceSeconds: session.counters.acceptedVoiceSeconds,
  recoveredClips: recovered.length,
  uploaded,
  rejectionReasons: session.counters.rejectionReasons,
}, null, 2));
