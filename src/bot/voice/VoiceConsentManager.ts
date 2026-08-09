import fs from 'node:fs';
import path from 'node:path';

export interface VoiceConsentRecord {
  guildId: string;
  userId: string;
  displayName: string;
  active: boolean;
  consentedAt: number;
  revokedAt?: number;
}

interface VoiceConsentFile {
  version: 1;
  records: VoiceConsentRecord[];
}

export class VoiceConsentManager {
  private readonly filePath: string;
  private readonly samplesRoot: string;

  constructor(
    filePath = path.join(process.cwd(), 'data', 'voice_consents.json'),
    samplesRoot = path.join(process.cwd(), 'data', 'voice_samples'),
  ) {
    this.filePath = filePath;
    this.samplesRoot = path.resolve(samplesRoot);
  }

  public grant(guildId: string, userId: string, displayName: string): VoiceConsentRecord {
    const data = this.read();
    const now = Date.now();
    const record: VoiceConsentRecord = {
      guildId,
      userId,
      displayName,
      active: true,
      consentedAt: now,
    };
    const index = data.records.findIndex(item => item.guildId === guildId && item.userId === userId);
    if (index >= 0) data.records[index] = record;
    else data.records.push(record);
    this.write(data);
    return record;
  }

  public revoke(guildId: string, userId: string): VoiceConsentRecord | null {
    const data = this.read();
    const record = data.records.find(item => item.guildId === guildId && item.userId === userId);
    if (!record) return null;
    record.active = false;
    record.revokedAt = Date.now();
    this.write(data);
    return record;
  }

  public revokeAll(userId: string): number {
    const data = this.read();
    let count = 0;
    const now = Date.now();
    for (const record of data.records) {
      if (record.userId === userId && record.active) {
        record.active = false;
        record.revokedAt = now;
        count++;
      }
    }
    if (count > 0) this.write(data);
    return count;
  }

  public hasActiveConsent(guildId: string, userId: string): boolean {
    return this.read().records.some(item => (
      item.guildId === guildId && item.userId === userId && item.active
    ));
  }

  public hasActiveConsentAnywhere(userId: string): boolean {
    return this.read().records.some(item => item.userId === userId && item.active);
  }

  public get(guildId: string, userId: string): VoiceConsentRecord | null {
    return this.read().records.find(item => item.guildId === guildId && item.userId === userId) ?? null;
  }

  public listActive(): VoiceConsentRecord[] {
    return this.read().records.filter(item => item.active);
  }

  public deleteLocalSpeakerData(userId: string): number {
    if (!/^\d{5,30}$/.test(userId)) {
      throw new Error('Invalid Discord user ID.');
    }

    const samplesRoot = this.samplesRoot;
    const speakerPath = path.resolve(samplesRoot, userId);
    if (path.dirname(speakerPath) !== samplesRoot) {
      throw new Error('Refusing to delete a path outside the voice sample directory.');
    }

    let deletedFiles = 0;
    if (fs.existsSync(speakerPath)) {
      deletedFiles = fs.readdirSync(speakerPath).filter(name => name.toLowerCase().endsWith('.wav')).length;
      fs.rmSync(speakerPath, { recursive: true, force: true });
    }

    const catalogPath = path.join(samplesRoot, 'catalog.json');
    if (fs.existsSync(catalogPath)) {
      try {
        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as Array<{ userId?: string; file?: string }>;
        for (const item of Array.isArray(catalog) ? catalog : []) {
          if (item.userId !== userId || !item.file) continue;
          const candidate = path.resolve(samplesRoot, item.file.replace(/^\/+/, '').replace(/^data[\\/]voice_samples[\\/]/, '').replace(/\//g, path.sep));
          if (!candidate.startsWith(samplesRoot + path.sep) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
          fs.rmSync(candidate, { force: true });
          deletedFiles++;
          const parent = path.dirname(candidate);
          if (parent !== samplesRoot && path.dirname(parent) === samplesRoot && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
            fs.rmdirSync(parent);
          }
        }
        const retained = Array.isArray(catalog) ? catalog.filter(item => item.userId !== userId) : [];
        fs.writeFileSync(catalogPath, JSON.stringify(retained, null, 2));
      } catch {
        // A corrupt catalog must not prevent deletion of the actual biometric files.
      }
    }

    return deletedFiles;
  }

  private read(): VoiceConsentFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, records: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<VoiceConsentFile>;
      return {
        version: 1,
        records: Array.isArray(parsed.records) ? parsed.records.filter(this.isValidRecord) : [],
      };
    } catch {
      return { version: 1, records: [] };
    }
  }

  private write(data: VoiceConsentFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  private readonly isValidRecord = (value: unknown): value is VoiceConsentRecord => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<VoiceConsentRecord>;
    return typeof record.guildId === 'string'
      && typeof record.userId === 'string'
      && typeof record.displayName === 'string'
      && typeof record.active === 'boolean'
      && typeof record.consentedAt === 'number';
  };
}
