import fs from 'node:fs';
import path from 'node:path';
import { TranscriptFinalEvent } from '../types/events';
import type { VoiceUtteranceRecord } from '../voice/VoiceDatasetWriter';
import { transcriptHallucinationReason } from '../stt/TranscriptQuality';
import { mirrorSocialSnapshot } from './jarvis/dualWrite';
import type { JarvisMemoryStore } from './jarvis/store';

interface TopicStat {
  count: number;
  lastSeen: number;
  evidenceIds: string[];
}

export interface SocialBrainPerson {
  userId: string;
  displayNames: string[];
  aliases: string[];
  utteranceCount: number;
  firstSeen: number;
  lastSeen: number;
  games: Record<string, TopicStat>;
  activities: Record<string, TopicStat>;
  facts: SocialBrainFact[];
  style: {
    totalCharacters: number;
    questionCount: number;
    thaiCharacterCount: number;
    englishWordCount: number;
    informalTerms: Record<string, number>;
    shortReplies: Record<string, number>;
    voiceSampleCount: number;
    cleanVoiceSeconds: number;
    pitchMedianHzTotal: number;
    pitchMedianHzCount: number;
    pitchRangeHzTotal: number;
    pitchRangeHzCount: number;
    speakingRateTotal: number;
    speakingRateCount: number;
    averagePauseMsTotal: number;
    averagePauseMsCount: number;
    energyVariationDbTotal: number;
    energyVariationDbCount: number;
    learnedVoiceStyles: Record<string, number>;
  };
}

export interface SocialBrainFact {
  id: string;
  text: string;
  confidence: number;
  observedAt: number;
  lastObservedAt: number;
  evidenceId: string;
  evidenceIds: string[];
  confirmations: number;
  status: 'active' | 'superseded';
  key?: string;
  polarity?: 'positive' | 'negative' | 'statement';
  supersededBy?: string;
}

export interface SocialBrainRelationship {
  id: string;
  userIds: [string, string];
  interactionCount: number;
  lastInteractionAt: number;
  addressTerms: Record<string, number>;
  evidenceIds: string[];
}

export interface SocialBrainObservation {
  id: string;
  guildId: string;
  sessionId: string;
  speakerUserId: string;
  speakerName: string;
  text: string;
  timestamp: number;
  games: string[];
  activities: string[];
  mentionedUserIds: string[];
  transcriptConfidence: number;
}

interface SocialBrainState {
  version: 1;
  updatedAt: number;
  people: Record<string, SocialBrainPerson>;
  relationships: Record<string, SocialBrainRelationship>;
  recentObservations: SocialBrainObservation[];
  totalObservations: number;
}

const GAME_ALIASES: Record<string, string[]> = {
  Valorant: ['valorant', 'valo', 'วาโล', 'วาโลแรนท์'],
  Minecraft: ['minecraft', 'มายคราฟ'],
  Roblox: ['roblox', 'โรบล็อก'],
  'League of Legends': ['league of legends', 'league', 'lol', 'ลีค', 'ลีก'],
  'Overwatch 2': ['overwatch', 'ow2', 'โอเวอร์วอช'],
  'Counter-Strike 2': ['counter-strike', 'counter strike', 'cs2'],
  Fortnite: ['fortnite', 'ฟอร์ทไนท์'],
  GTA: ['gta', 'gta v', 'จีทีเอ'],
  'Dota 2': ['dota', 'dota 2', 'โดต้า'],
  'Apex Legends': ['apex', 'เอเป็กซ์'],
};

const ACTIVITY_ALIASES: Record<string, string[]> = {
  gaming: ['เล่นเกม', 'เข้าเกม', 'gaming'],
  eating: ['กินข้าว', 'กินไร', 'หาไรกิน', 'ข้าวยัง'],
  sleeping: ['นอน', 'ไปนอน', 'ง่วง'],
  studying: ['เรียน', 'อ่านหนังสือ', 'ทำการบ้าน'],
  working: ['ทำงาน', 'เข้างาน', 'เลิกงาน'],
  watching: ['ดูหนัง', 'ดูซีรีส์', 'ดูอนิเมะ', 'ดูยูทูบ'],
  music: ['ฟังเพลง', 'ร้องเพลง'],
};

export type SocialMemoryBrainOptions = {
  canonicalStore?: JarvisMemoryStore;
};

export class SocialMemoryBrain {
  private readonly root: string;
  private readonly statePath: string;
  private readonly evidencePath: string;
  private readonly vaultRoot: string;
  private readonly canonicalStore?: JarvisMemoryStore;
  private state: SocialBrainState;
  private vaultTimer?: NodeJS.Timeout;

  constructor(root = path.join(process.cwd(), 'data', 'brain'), options: SocialMemoryBrainOptions = {}) {
    this.root = path.resolve(root);
    this.statePath = path.join(this.root, 'brain_state.json');
    this.evidencePath = path.join(this.root, 'observations.jsonl');
    this.vaultRoot = path.join(this.root, 'vault');
    this.canonicalStore = options.canonicalStore;
    fs.mkdirSync(this.root, { recursive: true });
    this.state = this.load();
  }

  public recordTranscript(
    guildId: string,
    event: TranscriptFinalEvent,
    recentTranscripts: TranscriptFinalEvent[],
  ): SocialBrainObservation | null {
    if (process.env.MEMORY_ENABLED === 'false' || !event.rawText.trim()) return null;
    if (event.verified === false || transcriptHallucinationReason(event.rawText)) {
      console.warn(`[SocialMemory] Rejected unverified/hallucinated transcript from memory: "${event.rawText}"`);
      return null;
    }
    const observationId = `${event.sessionId}:${event.eventId}`;
    if (this.state.recentObservations.some(item => item.id === observationId)) return null;

    const person = this.ensurePerson(event.discordUserId, event.displayName, event.username, event.timestamp);
    person.utteranceCount++;
    person.lastSeen = event.timestamp;
    const reliableTranscript = event.confidence >= 0.55;
    if (reliableTranscript) this.updateStyle(person, event.rawText);
    const games = reliableTranscript ? this.extractTopics(event.rawText, GAME_ALIASES) : [];
    const activities = reliableTranscript ? this.extractTopics(event.rawText, ACTIVITY_ALIASES) : [];
    if (reliableTranscript) {
      if (games.length > 0 && !activities.includes('gaming')) activities.push('gaming');
      for (const game of games) this.bumpTopic(person.games, game, observationId, event.timestamp);
      for (const activity of activities) this.bumpTopic(person.activities, activity, observationId, event.timestamp);
      this.extractFact(person, event.rawText, observationId, event.timestamp, event.confidence);
    }

    const mentionedUserIds: string[] = [];
    for (const candidate of reliableTranscript ? Object.values(this.state.people) : []) {
      if (candidate.userId === event.discordUserId) continue;
      const usedAlias = [...candidate.aliases, ...candidate.displayNames]
        .find(alias => this.containsAlias(event.rawText, alias));
      if (!usedAlias) continue;
      mentionedUserIds.push(candidate.userId);
      this.bumpRelationship(event.discordUserId, candidate.userId, event.timestamp, observationId, usedAlias);
    }

    const previous = reliableTranscript ? [...recentTranscripts]
      .reverse()
      .find(item => item.eventId !== event.eventId && item.discordUserId !== event.discordUserId && event.timestamp - item.timestamp <= 120_000)
      : undefined;
    if (previous) this.bumpRelationship(event.discordUserId, previous.discordUserId, event.timestamp, observationId);

    const observation: SocialBrainObservation = {
      id: observationId,
      guildId,
      sessionId: event.sessionId,
      speakerUserId: event.discordUserId,
      speakerName: event.displayName,
      text: event.rawText.trim(),
      timestamp: event.timestamp,
      games,
      activities,
      mentionedUserIds,
      transcriptConfidence: event.confidence,
    };
    this.state.recentObservations.push(observation);
    this.state.recentObservations = this.state.recentObservations.slice(-2_000);
    this.state.totalObservations++;
    this.state.updatedAt = Date.now();
    fs.appendFileSync(this.evidencePath, `${JSON.stringify(observation)}\n`, 'utf8');
    this.save();
    this.scheduleVaultWrite();
    this.mirrorCanonical();
    return observation;
  }

  public registerAliases(userId: string, displayName: string, aliases: string[]): void {
    const person = this.ensurePerson(userId, displayName, displayName, Date.now());
    person.aliases = this.unique([...person.aliases, displayName, ...aliases]);
    person.lastSeen = Math.max(person.lastSeen, Date.now());
    this.state.updatedAt = Date.now();
    this.save();
    this.scheduleVaultWrite();
    this.mirrorCanonical();
  }

  public recordVoiceStyle(record: VoiceUtteranceRecord): void {
    if (process.env.MEMORY_ENABLED === 'false' || !record.analysis.quality.acceptedForVoiceTraining) return;
    const person = this.ensurePerson(
      record.discordUserId,
      record.displayName,
      record.username,
      record.speechStartedAt,
    );
    this.normalizeStyle(person);
    const style = person.style;
    const prosody = record.analysis.prosody;
    style.voiceSampleCount++;
    style.cleanVoiceSeconds = this.round(style.cleanVoiceSeconds + record.durationSeconds);
    if (prosody.pitchMedianHz !== null) {
      style.pitchMedianHzTotal += prosody.pitchMedianHz;
      style.pitchMedianHzCount++;
    }
    if (prosody.pitchRangeHz !== null) {
      style.pitchRangeHzTotal += prosody.pitchRangeHz;
      style.pitchRangeHzCount++;
    }
    if (prosody.speakingRateWordsPerSecond !== null) {
      style.speakingRateTotal += prosody.speakingRateWordsPerSecond;
      style.speakingRateCount++;
    }
    style.averagePauseMsTotal += prosody.averagePauseMs;
    style.averagePauseMsCount++;
    style.energyVariationDbTotal += prosody.energyVariationDb;
    style.energyVariationDbCount++;
    style.learnedVoiceStyles[prosody.style] = (style.learnedVoiceStyles[prosody.style] ?? 0) + 1;
    person.lastSeen = Math.max(person.lastSeen, record.speechEndedAt);
    this.state.updatedAt = Date.now();
    this.save();
    this.scheduleVaultWrite();
  }

  public getSnapshot() {
    return {
      updatedAt: this.state.updatedAt,
      totalObservations: this.state.totalObservations,
      people: Object.values(this.state.people).sort((a, b) => b.lastSeen - a.lastSeen),
      relationships: Object.values(this.state.relationships).sort((a, b) => b.interactionCount - a.interactionCount),
      recentObservations: this.state.recentObservations.slice(-100).reverse(),
      vaultPath: this.vaultRoot,
    };
  }

  public rebuildVault(): void {
    this.writeVault();
  }

  public search(query: string, limit = 30): SocialBrainObservation[] {
    const terms = this.tokenize(query);
    if (terms.length === 0) return this.state.recentObservations.slice(-limit).reverse();
    return this.state.recentObservations
      .map(observation => {
        const haystack = `${observation.speakerName} ${observation.text} ${observation.games.join(' ')} ${observation.activities.join(' ')}`.toLowerCase();
        return { observation, score: terms.filter(term => haystack.includes(term)).length };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.observation.timestamp - a.observation.timestamp)
      .slice(0, limit)
      .map(item => item.observation);
  }

  public getContextForTurn(events: TranscriptFinalEvent[], maxCharacters = 900): string {
    const speakerIds = new Set(events.slice(-8).map(event => event.discordUserId));
    const lines: string[] = [];
    for (const userId of speakerIds) {
      const person = this.state.people[userId];
      if (!person) continue;
      const games = this.topTopics(person.games, 3);
      const activities = this.topTopics(person.activities, 3);
      const facts = person.facts.filter(fact => fact.status !== 'superseded').slice(-3).map(fact => fact.text);
      const averageLength = person.utteranceCount > 0 ? Math.round(person.style.totalCharacters / person.utteranceCount) : 0;
      const informalTerms = Object.entries(person.style.informalTerms).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([term]) => term);
      const voiceStyle = this.summarizeVoiceStyle(person);
      const details = [
        games.length ? `games=${games.join(', ')}` : '',
        activities.length ? `activities=${activities.join(', ')}` : '',
        facts.length ? `facts=${facts.join(' | ')}` : '',
        averageLength ? `speech-style=about ${averageLength} chars${informalTerms.length ? `, common slang ${informalTerms.join(', ')}` : ''}` : '',
        voiceStyle ? `voice-prosody=${voiceStyle}` : '',
      ].filter(Boolean).join('; ');
      if (details) lines.push(`${person.displayNames[0] || userId}: ${details}`);
    }
    return lines.join('\n').slice(0, maxCharacters);
  }

  public deleteUser(userId: string): boolean {
    if (!this.state.people[userId]) return false;
    delete this.state.people[userId];
    for (const [relationshipId, relationship] of Object.entries(this.state.relationships)) {
      if (relationship.userIds.includes(userId)) delete this.state.relationships[relationshipId];
    }
    this.state.recentObservations = this.state.recentObservations.filter(item => item.speakerUserId !== userId && !item.mentionedUserIds.includes(userId));
    if (fs.existsSync(this.evidencePath)) {
      const retained = fs.readFileSync(this.evidencePath, 'utf8').split(/\r?\n/).filter(Boolean)
        .filter(line => {
          try {
            const item = JSON.parse(line) as SocialBrainObservation;
            return item.speakerUserId !== userId && !item.mentionedUserIds?.includes(userId);
          } catch { return false; }
        });
      fs.writeFileSync(this.evidencePath, retained.length ? `${retained.join('\n')}\n` : '', 'utf8');
    }
    this.state.updatedAt = Date.now();
    this.save();
    this.writeVault();
    return true;
  }

  public exportVault(): string {
    this.writeVault();
    return this.vaultRoot;
  }

  private ensurePerson(userId: string, displayName: string, username: string, timestamp: number): SocialBrainPerson {
    const existing = this.state.people[userId];
    const aliases = this.unique([displayName, username, this.baseAlias(displayName), this.baseAlias(username)]);
    if (existing) {
      existing.displayNames = this.unique([displayName, username, ...existing.displayNames]);
      existing.aliases = this.unique([...existing.aliases, ...aliases]);
      return existing;
    }
    const person: SocialBrainPerson = {
      userId,
      displayNames: this.unique([displayName, username]),
      aliases,
      utteranceCount: 0,
      firstSeen: timestamp,
      lastSeen: timestamp,
      games: {},
      activities: {},
      facts: [],
      style: this.emptyStyle(),
    };
    this.state.people[userId] = person;
    return person;
  }

  private bumpTopic(target: Record<string, TopicStat>, topic: string, evidenceId: string, timestamp: number): void {
    const stat = target[topic] || { count: 0, lastSeen: 0, evidenceIds: [] };
    stat.count++;
    stat.lastSeen = timestamp;
    stat.evidenceIds = this.unique([...stat.evidenceIds, evidenceId]).slice(-20);
    target[topic] = stat;
  }

  private bumpRelationship(fromUserId: string, toUserId: string, timestamp: number, evidenceId: string, addressTerm?: string): void {
    const userIds = [fromUserId, toUserId].sort() as [string, string];
    const id = userIds.join(':');
    const relationship = this.state.relationships[id] || {
      id, userIds, interactionCount: 0, lastInteractionAt: 0, addressTerms: {}, evidenceIds: [],
    };
    relationship.interactionCount++;
    relationship.lastInteractionAt = timestamp;
    relationship.evidenceIds = this.unique([...relationship.evidenceIds, evidenceId]).slice(-50);
    if (addressTerm) relationship.addressTerms[addressTerm] = (relationship.addressTerms[addressTerm] || 0) + 1;
    this.state.relationships[id] = relationship;
  }

  private extractFact(
    person: SocialBrainPerson,
    text: string,
    evidenceId: string,
    timestamp: number,
    transcriptConfidence: number,
  ): void {
    if (transcriptConfidence < 0.55) return;
    if (!/(?:ชอบ|ไม่ชอบ|เกลียด|เล่นบ่อย|เลิกเล่น|ทำงาน|เรียน|usually|like|hate|work|study)/iu.test(text)) return;
    const normalized = text.trim().slice(0, 240);
    const preference = this.detectPreference(text);
    const factKey = preference?.key ?? `statement:${normalized.toLocaleLowerCase()}`;
    const polarity = preference?.polarity ?? 'statement';
    const matching = person.facts.find(fact => fact.status !== 'superseded' && fact.key === factKey && fact.polarity === polarity);
    if (matching) {
      matching.confirmations = (matching.confirmations || 1) + 1;
      matching.confidence = Math.min(0.98, Math.max(matching.confidence, transcriptConfidence * 0.8) + 0.04);
      matching.lastObservedAt = timestamp;
      matching.evidenceIds = this.unique([...(matching.evidenceIds || [matching.evidenceId]), evidenceId]).slice(-20);
      return;
    }
    const id = `${evidenceId}:fact:${person.facts.length + 1}`;
    const fact: SocialBrainFact = {
      id,
      text: normalized,
      confidence: this.round(Math.min(0.9, transcriptConfidence * 0.85)),
      observedAt: timestamp,
      lastObservedAt: timestamp,
      evidenceId,
      evidenceIds: [evidenceId],
      confirmations: 1,
      status: 'active',
      key: factKey,
      polarity,
    };
    for (const previous of person.facts) {
      if (previous.status === 'superseded' || previous.key !== factKey || previous.polarity === polarity) continue;
      previous.status = 'superseded';
      previous.supersededBy = id;
      previous.confidence = this.round(previous.confidence * 0.4);
    }
    person.facts.push(fact);
    person.facts = person.facts.slice(-50);
  }

  private updateStyle(person: SocialBrainPerson, text: string): void {
    this.normalizeStyle(person);
    person.style.totalCharacters += [...text].length;
    if (/[?？]|(?:ปะ|ไหม|มั้ย)(?:\s|$)/iu.test(text)) person.style.questionCount++;
    person.style.thaiCharacterCount += (text.match(/[\u0E00-\u0E7F]/gu) || []).length;
    person.style.englishWordCount += (text.match(/[a-z]+/giu) || []).length;
    for (const term of ['กู', 'มึง', 'เออ', 'ว่ะ', 'วะ', 'อะ', 'ปะ', 'ขก', '555']) {
      if (text.toLowerCase().includes(term)) person.style.informalTerms[term] = (person.style.informalTerms[term] || 0) + 1;
    }
    const clean = text.trim();
    if ([...clean].length <= 40) person.style.shortReplies[clean] = (person.style.shortReplies[clean] || 0) + 1;
    person.style.shortReplies = Object.fromEntries(Object.entries(person.style.shortReplies).sort((a, b) => b[1] - a[1]).slice(0, 50));
  }

  private emptyStyle(): SocialBrainPerson['style'] {
    return {
      totalCharacters: 0,
      questionCount: 0,
      thaiCharacterCount: 0,
      englishWordCount: 0,
      informalTerms: {},
      shortReplies: {},
      voiceSampleCount: 0,
      cleanVoiceSeconds: 0,
      pitchMedianHzTotal: 0,
      pitchMedianHzCount: 0,
      pitchRangeHzTotal: 0,
      pitchRangeHzCount: 0,
      speakingRateTotal: 0,
      speakingRateCount: 0,
      averagePauseMsTotal: 0,
      averagePauseMsCount: 0,
      energyVariationDbTotal: 0,
      energyVariationDbCount: 0,
      learnedVoiceStyles: {},
    };
  }

  private normalizeStyle(person: SocialBrainPerson): void {
    const defaults = this.emptyStyle();
    person.style = { ...defaults, ...(person.style || {} as SocialBrainPerson['style']) };
    person.style.informalTerms ||= {};
    person.style.shortReplies ||= {};
    person.style.learnedVoiceStyles ||= {};
  }

  private normalizeFacts(person: SocialBrainPerson): void {
    person.facts = (person.facts || []).map((fact, index) => ({
      ...fact,
      id: fact.id || `${fact.evidenceId}:legacy:${index + 1}`,
      lastObservedAt: fact.lastObservedAt || fact.observedAt,
      evidenceIds: fact.evidenceIds?.length ? fact.evidenceIds : [fact.evidenceId],
      confirmations: fact.confirmations || 1,
      status: fact.status || 'active',
      polarity: fact.polarity || 'statement',
      key: fact.key || `statement:${fact.text.toLocaleLowerCase()}`,
    }));
  }

  private detectPreference(text: string): { key: string; polarity: 'positive' | 'negative' } | null {
    const lower = text.toLocaleLowerCase();
    const negative = /(?:ไม่ชอบ|เกลียด|เลิกเล่น|don't like|do not like|hate|quit)/iu.test(lower);
    const positive = !negative && /(?:ชอบ|เล่นบ่อย|like|love|usually play)/iu.test(lower);
    if (!negative && !positive) return null;
    const dictionaries = [GAME_ALIASES, ACTIVITY_ALIASES];
    for (const dictionary of dictionaries) {
      for (const [topic, aliases] of Object.entries(dictionary)) {
        if (!aliases.some(alias => lower.includes(alias.toLocaleLowerCase()))) continue;
        return { key: `preference:${topic.toLocaleLowerCase()}`, polarity: negative ? 'negative' : 'positive' };
      }
    }
    return null;
  }

  private extractTopics(text: string, dictionary: Record<string, string[]>): string[] {
    const lower = text.toLowerCase();
    return Object.entries(dictionary)
      .filter(([, aliases]) => aliases.some(alias => lower.includes(alias.toLowerCase())))
      .map(([topic]) => topic);
  }

  private containsAlias(text: string, alias: string): boolean {
    const clean = alias.trim().toLowerCase();
    if (clean.length < 2) return false;
    const lower = text.toLowerCase();
    if (/^[a-z0-9_. -]+$/iu.test(clean)) {
      const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, 'iu').test(lower);
    }
    return lower.includes(clean);
  }

  private topTopics(topics: Record<string, TopicStat>, limit: number): string[] {
    return Object.entries(topics).sort((a, b) => b[1].count - a[1].count).slice(0, limit).map(([name]) => name);
  }

  private tokenize(value: string): string[] {
    return value.toLowerCase().split(/[\s,.;:!?()[\]{}"']+/u).map(item => item.trim()).filter(item => item.length >= 2);
  }

  private baseAlias(value: string): string {
    return value.replace(/\d+/gu, '').replace(/[_\-.]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  }

  private unique(values: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const clean = String(value || '').trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      result.push(clean);
    }
    return result;
  }

  private scheduleVaultWrite(): void {
    if (this.vaultTimer) clearTimeout(this.vaultTimer);
    this.vaultTimer = setTimeout(() => this.writeVault(), 500);
  }

  private writeVault(): void {
    fs.mkdirSync(path.join(this.vaultRoot, 'People'), { recursive: true });
    const people = Object.values(this.state.people).sort((a, b) => b.lastSeen - a.lastSeen);
    const relationships = Object.values(this.state.relationships).sort((a, b) => b.interactionCount - a.interactionCount);
    const links = people.map(person => `- [[People/${this.personFile(person)}|${person.displayNames[0] || person.userId}]] — ${person.utteranceCount} utterances`).join('\n');
    const index = `# Digital Me Social Brain\n\nUpdated: ${new Date(this.state.updatedAt).toISOString()}\n\n- Observations: ${this.state.totalObservations}\n- People: ${people.length}\n- Relationships: ${relationships.length}\n\n## People\n\n${links || '- No learned people yet.'}\n\n## Strongest relationships\n\n${relationships.slice(0, 20).map(item => `- ${this.personName(item.userIds[0])} ↔ ${this.personName(item.userIds[1])}: ${item.interactionCount} interactions`).join('\n') || '- None yet.'}\n`;
    fs.writeFileSync(path.join(this.vaultRoot, 'Brain Dashboard.md'), index, 'utf8');

    for (const person of people) {
      const related = relationships.filter(item => item.userIds.includes(person.userId));
      const recent = this.state.recentObservations.filter(item => item.speakerUserId === person.userId).slice(-20).reverse();
      const averageLength = person.utteranceCount > 0 ? Math.round(person.style.totalCharacters / person.utteranceCount) : 0;
      const voiceStyle = this.summarizeVoiceStyle(person);
      const activeFacts = person.facts.filter(fact => fact.status !== 'superseded');
      const note = `---\ndiscord_user_id: "${person.userId}"\naliases: [${person.aliases.map(alias => JSON.stringify(alias)).join(', ')}]\nlast_seen: ${new Date(person.lastSeen).toISOString()}\n---\n\n# ${person.displayNames[0] || person.userId}\n\n## Speaking style\n\n- Average utterance: ${averageLength} characters\n- Questions: ${person.style.questionCount}\n- Common informal terms: ${Object.entries(person.style.informalTerms).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([term, count]) => `${term} (${count})`).join(', ') || 'None yet'}\n- Frequent short replies: ${Object.entries(person.style.shortReplies).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reply, count]) => `${reply} (${count})`).join(', ') || 'None yet'}\n- Learned acoustic style: ${voiceStyle || 'Not enough clean voice samples yet'}\n\n## Games\n\n${this.topicMarkdown(person.games)}\n\n## Activities\n\n${this.topicMarkdown(person.activities)}\n\n## Learned facts\n\n${activeFacts.slice().reverse().map(fact => `- ${fact.text} (confidence ${fact.confidence.toFixed(2)}, confirmations ${fact.confirmations}) ^${fact.evidenceId.replace(/[^a-z0-9-]/giu, '-')}`).join('\n') || '- None yet.'}\n\n## Superseded facts\n\n${person.facts.filter(fact => fact.status === 'superseded').slice(-10).reverse().map(fact => `- ~~${fact.text}~~ (superseded by newer contradictory evidence)`).join('\n') || '- None.'}\n\n## Relationships\n\n${related.map(item => {
        const otherId = item.userIds.find(id => id !== person.userId) || person.userId;
        const terms = Object.entries(item.addressTerms).sort((a, b) => b[1] - a[1]).map(([term]) => term).slice(0, 5);
        return `- [[${this.personFile(this.state.people[otherId])}|${this.personName(otherId)}]] — ${item.interactionCount} interactions${terms.length ? `; called: ${terms.join(', ')}` : ''}`;
      }).join('\n') || '- None yet.'}\n\n## Recent evidence\n\n${recent.map(item => `- ${new Date(item.timestamp).toISOString()}: ${item.text}`).join('\n') || '- None yet.'}\n`;
      fs.writeFileSync(path.join(this.vaultRoot, 'People', `${this.personFile(person)}.md`), note, 'utf8');
    }
  }

  private topicMarkdown(topics: Record<string, TopicStat>): string {
    const rows = Object.entries(topics).sort((a, b) => b[1].count - a[1].count);
    return rows.map(([name, stat]) => `- ${name}: ${stat.count} mentions (last ${new Date(stat.lastSeen).toISOString()})`).join('\n') || '- None yet.';
  }

  private summarizeVoiceStyle(person: SocialBrainPerson): string {
    this.normalizeStyle(person);
    const style = person.style;
    if (style.voiceSampleCount < 1) return '';
    const parts = [`${style.cleanVoiceSeconds.toFixed(1)}s clean audio`];
    if (style.pitchMedianHzCount) parts.push(`median pitch ${(style.pitchMedianHzTotal / style.pitchMedianHzCount).toFixed(0)}Hz`);
    if (style.pitchRangeHzCount) parts.push(`pitch range ${(style.pitchRangeHzTotal / style.pitchRangeHzCount).toFixed(0)}Hz`);
    if (style.speakingRateCount) parts.push(`${(style.speakingRateTotal / style.speakingRateCount).toFixed(2)} words/s`);
    if (style.averagePauseMsCount) parts.push(`average pause ${(style.averagePauseMsTotal / style.averagePauseMsCount).toFixed(0)}ms`);
    const dominantStyles = Object.entries(style.learnedVoiceStyles)
      .sort((first, second) => second[1] - first[1])
      .slice(0, 3)
      .map(([name, count]) => `${name}:${count}`);
    if (dominantStyles.length) parts.push(`styles ${dominantStyles.join(', ')}`);
    return parts.join(', ');
  }

  private personName(userId: string): string {
    return this.state.people[userId]?.displayNames[0] || userId;
  }

  private personFile(person: SocialBrainPerson | undefined): string {
    if (!person) return 'Unknown';
    const name = (person.displayNames[0] || 'User').replace(/[<>:"/\\|?*#^[\]]/gu, '').trim().slice(0, 60) || 'User';
    return `${name}-${person.userId.slice(-6)}`;
  }

  private mirrorCanonical(): void {
    if (!this.canonicalStore) return;
    try {
      mirrorSocialSnapshot(this.canonicalStore, this.getSnapshot());
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[SocialMemory] Canonical dual-write skipped: ${detail}`);
    }
  }

  private save(): void {
    const temporary = `${this.statePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(temporary, this.statePath);
  }

  private load(): SocialBrainState {
    if (fs.existsSync(this.statePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as SocialBrainState;
        if (parsed?.version === 1 && parsed.people && parsed.relationships) {
          for (const person of Object.values(parsed.people)) {
            this.normalizeStyle(person);
            this.normalizeFacts(person);
          }
          return parsed;
        }
      } catch {
        // Start a fresh derived index; the append-only evidence file remains untouched.
      }
    }
    return { version: 1, updatedAt: Date.now(), people: {}, relationships: {}, recentObservations: [], totalObservations: 0 };
  }

  private round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }
}
