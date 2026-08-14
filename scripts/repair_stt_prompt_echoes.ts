import fs from 'node:fs';
import path from 'node:path';
import { SocialMemoryBrain } from '../src/bot/memory/SocialMemoryBrain';
import { transcriptHallucinationReason } from '../src/bot/stt/TranscriptQuality';

const root = process.cwd();
const apply = process.argv.includes('--apply');
const brainRoot = path.join(root, 'data', 'brain');
const statePath = path.join(brainRoot, 'brain_state.json');
const evidencePath = path.join(brainRoot, 'observations.jsonl');
const sampleRoot = path.join(root, 'data', 'voice_samples');
const learningRoot = path.join(root, 'data', 'learning_sessions');

type Observation = {
  id: string;
  speakerUserId: string;
  text: string;
  transcriptConfidence?: number;
};

const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as any;
const evidence = fs.existsSync(evidencePath)
  ? fs.readFileSync(evidencePath, 'utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line) as Observation)
  : (state.recentObservations || []) as Observation[];
const rejected = evidence.filter(item => transcriptHallucinationReason(item.text));
const rejectedIds = new Set(rejected.map(item => item.id));
const rejectedBySpeaker = new Map<string, Observation[]>();
for (const item of rejected) {
  const entries = rejectedBySpeaker.get(item.speakerUserId) || [];
  entries.push(item);
  rejectedBySpeaker.set(item.speakerUserId, entries);
}

let rejectedSampleRecords = 0;
const sampleJsonPaths = fs.existsSync(sampleRoot)
  ? fs.readdirSync(sampleRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => {
      const directory = path.join(sampleRoot, entry.name);
      return fs.readdirSync(directory)
        .filter(file => /^utterance_.+\.json$/u.test(file))
        .map(file => path.join(directory, file));
    })
  : [];
for (const metadataPath of sampleJsonPaths) {
  const record = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as any;
  if (!record.transcript?.text || !transcriptHallucinationReason(record.transcript.text)) continue;
  rejectedSampleRecords++;
}

console.log(`[stt-repair] ${rejected.length} corrupted brain observations and ${rejectedSampleRecords} sample transcripts found.`);
if (!apply) {
  console.log('[stt-repair] Preview only. Re-run with --apply to back up and repair them.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:.]/gu, '').replace('T', '-').replace('Z', 'Z');
const backupRoot = path.join(root, '.runtime', `stt-repair-backup-${stamp}`);
fs.mkdirSync(backupRoot, { recursive: true });
for (const source of [statePath, evidencePath, path.join(sampleRoot, 'catalog.json')]) {
  if (!fs.existsSync(source)) continue;
  fs.copyFileSync(source, path.join(backupRoot, path.basename(source)));
}
const vaultPath = path.join(brainRoot, 'vault');
if (fs.existsSync(vaultPath)) fs.cpSync(vaultPath, path.join(backupRoot, 'vault'), { recursive: true });

const cleanedEvidence = evidence.filter(item => !rejectedIds.has(item.id));
state.recentObservations = (state.recentObservations || []).filter((item: Observation) => !transcriptHallucinationReason(item.text));
state.totalObservations = cleanedEvidence.length;
state.updatedAt = Date.now();

for (const [speakerId, person] of Object.entries(state.people || {}) as Array<[string, any]>) {
  const removed = rejectedBySpeaker.get(speakerId) || [];
  person.utteranceCount = Math.max(0, Number(person.utteranceCount || 0) - removed.length);
  const style = person.style || {};
  for (const observation of removed) {
    const text = observation.text || '';
    style.totalCharacters = Math.max(0, Number(style.totalCharacters || 0) - [...text].length);
    style.thaiCharacterCount = Math.max(0, Number(style.thaiCharacterCount || 0) - (text.match(/[\u0E00-\u0E7F]/gu) || []).length);
    style.englishWordCount = Math.max(0, Number(style.englishWordCount || 0) - (text.match(/[a-z]+/giu) || []).length);
    if (/[?？]|(?:ปะ|ไหม|มั้ย)(?:\s|$)/iu.test(text)) {
      style.questionCount = Math.max(0, Number(style.questionCount || 0) - 1);
    }
    for (const term of ['กู', 'มึง', 'เออ', 'ว่ะ', 'วะ', 'อะ', 'ปะ', 'ขก', '555']) {
      if (!text.toLocaleLowerCase().includes(term) || !style.informalTerms?.[term]) continue;
      style.informalTerms[term] = Math.max(0, style.informalTerms[term] - 1);
      if (style.informalTerms[term] === 0) delete style.informalTerms[term];
    }
  }
  style.shortReplies = Object.fromEntries(
    Object.entries(style.shortReplies || {}).filter(([text]) => !transcriptHallucinationReason(text)),
  );
  person.facts = (person.facts || []).filter((fact: any) => !rejectedIds.has(fact.evidenceId));
}

for (const relationship of Object.values(state.relationships || {}) as any[]) {
  const originalEvidence = relationship.evidenceIds || [];
  relationship.evidenceIds = originalEvidence.filter((id: string) => !rejectedIds.has(id));
  relationship.interactionCount = Math.max(0, Number(relationship.interactionCount || 0) - (originalEvidence.length - relationship.evidenceIds.length));
}

fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
fs.writeFileSync(evidencePath, cleanedEvidence.map(item => JSON.stringify(item)).join('\n') + (cleanedEvidence.length ? '\n' : ''), 'utf8');

const catalogPath = path.join(sampleRoot, 'catalog.json');
const catalog = fs.existsSync(catalogPath) ? JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as any[] : [];
for (const metadataPath of sampleJsonPaths) {
  const record = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as any;
  if (!record.transcript?.text || !transcriptHallucinationReason(record.transcript.text)) continue;
  const relative = path.relative(root, metadataPath);
  fs.mkdirSync(path.join(backupRoot, path.dirname(relative)), { recursive: true });
  fs.copyFileSync(metadataPath, path.join(backupRoot, relative));
  const transcriptPath = path.resolve(root, String(record.transcriptFile || '').replace(/^[/\\]+/u, ''));
  if (fs.existsSync(transcriptPath)) {
    const transcriptRelative = path.relative(root, transcriptPath);
    fs.mkdirSync(path.join(backupRoot, path.dirname(transcriptRelative)), { recursive: true });
    fs.copyFileSync(transcriptPath, path.join(backupRoot, transcriptRelative));
    fs.writeFileSync(transcriptPath, '[เสียงรบกวน]\n', 'utf8');
  }
  record.transcript = null;
  record.transcriptStatus = 'rejected_asr_hallucination';
  if (record.analysis?.transcript) {
    record.analysis.transcript = {
      ...record.analysis.transcript,
      available: false,
      confidence: null,
      characterCount: 0,
      estimatedWordCount: 0,
      hasThai: false,
      hasEnglish: false,
    };
  }
  if (record.analysis?.quality) {
    record.analysis.quality.acceptedForExpressiveTts = false;
    record.analysis.quality.expressiveTtsReasons = Array.from(new Set([
      ...(record.analysis.quality.expressiveTtsReasons || []),
      'transcript_rejected_as_asr_hallucination',
    ]));
  }
  fs.writeFileSync(metadataPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  const catalogEntry = catalog.find(item => item.metadataFile === record.metadataFile || item.eventId === record.id);
  if (catalogEntry) {
    catalogEntry.transcript = '[เสียงรบกวน]';
    catalogEntry.transcriptStatus = 'rejected_asr_hallucination';
  }
}

for (const directory of fs.readdirSync(sampleRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
  const manifestPath = path.join(sampleRoot, directory.name, 'utterances.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as any;
  if (!(manifest.utterances || []).some((record: any) => record.transcript?.text && transcriptHallucinationReason(record.transcript.text))) {
    continue;
  }
  const manifestRelative = path.relative(root, manifestPath);
  fs.mkdirSync(path.join(backupRoot, path.dirname(manifestRelative)), { recursive: true });
  fs.copyFileSync(manifestPath, path.join(backupRoot, manifestRelative));
  for (const record of manifest.utterances || []) {
    if (!record.transcript?.text || !transcriptHallucinationReason(record.transcript.text)) continue;
    record.transcript = null;
    record.transcriptStatus = 'rejected_asr_hallucination';
    if (record.analysis?.transcript) record.analysis.transcript.available = false;
    if (record.analysis?.quality) {
      record.analysis.quality.acceptedForExpressiveTts = false;
      record.analysis.quality.expressiveTtsReasons = Array.from(new Set([
        ...(record.analysis.quality.expressiveTtsReasons || []),
        'transcript_rejected_as_asr_hallucination',
      ]));
    }
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

if (fs.existsSync(learningRoot)) {
  for (const entry of fs.readdirSync(learningRoot).filter(file => file.endsWith('.json'))) {
    const learningPath = path.join(learningRoot, entry);
    const learning = JSON.parse(fs.readFileSync(learningPath, 'utf8')) as any;
    const affected = (learning.utterances || []).filter((record: any) => record.transcript && transcriptHallucinationReason(record.transcript));
    if (!affected.length) continue;
    const learningRelative = path.relative(root, learningPath);
    fs.mkdirSync(path.join(backupRoot, path.dirname(learningRelative)), { recursive: true });
    fs.copyFileSync(learningPath, path.join(backupRoot, learningRelative));
    for (const record of affected) {
      record.transcript = null;
      record.transcriptConfidence = null;
      record.acceptedForExpressiveTts = false;
      record.rejectionReasons = Array.from(new Set([
        ...(record.rejectionReasons || []),
        'transcript_rejected_as_asr_hallucination',
      ]));
    }
    fs.writeFileSync(learningPath, `${JSON.stringify(learning, null, 2)}\n`, 'utf8');
  }
}

new SocialMemoryBrain(brainRoot).rebuildVault();
console.log(`[stt-repair] Repair complete. Backup: ${backupRoot}`);
