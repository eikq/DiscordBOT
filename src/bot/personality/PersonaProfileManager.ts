import fs from 'node:fs';
import path from 'node:path';

export interface PersonaProfile {
  userId: string;
  displayName: string;
  aliases: string[];
  description: string;
  updatedAt: number;
}

interface PersonaProfileFile {
  version: 1;
  profiles: PersonaProfile[];
}

export class PersonaProfileManager {
  private readonly filePath: string;

  constructor(filePath = path.join(process.cwd(), 'data', 'personas.json')) {
    this.filePath = filePath;
  }

  public get(userId: string): PersonaProfile | null {
    return this.read().profiles.find(profile => profile.userId === userId) ?? null;
  }

  public resolve(userId: string, fallbackDisplayName: string): PersonaProfile {
    return this.get(userId) ?? {
      userId,
      displayName: fallbackDisplayName,
      aliases: this.deriveAliases(fallbackDisplayName),
      description: '',
      updatedAt: 0,
    };
  }

  public save(userId: string, displayName: string, aliases: string[], description = ''): PersonaProfile {
    if (!/^\d{5,30}$/.test(userId)) throw new Error('Persona user ID must be a Discord snowflake.');
    const cleanName = this.cleanText(displayName, 80);
    if (!cleanName) throw new Error('Persona name is required.');

    const data = this.read();
    const cleanAliases = this.uniqueAliases([
      cleanName,
      ...this.deriveAliases(cleanName),
      ...aliases,
    ]);
    const profile: PersonaProfile = {
      userId,
      displayName: cleanName,
      aliases: cleanAliases,
      description: this.cleanText(description, 500),
      updatedAt: Date.now(),
    };
    const index = data.profiles.findIndex(item => item.userId === userId);
    if (index >= 0) data.profiles[index] = profile;
    else data.profiles.push(profile);
    this.write(data);
    return profile;
  }

  public ensure(userId: string, displayName: string): PersonaProfile {
    const existing = this.get(userId);
    if (existing) return existing;
    return this.save(userId, displayName, this.deriveAliases(displayName));
  }

  public list(): PersonaProfile[] {
    return this.read().profiles;
  }

  private deriveAliases(displayName: string): string[] {
    const normalized = displayName.replace(/[_\-.]+/gu, ' ').replace(/\s+/gu, ' ').trim();
    const withoutDigits = normalized.replace(/\d+/gu, '').replace(/\s+/gu, ' ').trim();
    return this.uniqueAliases([displayName, normalized, withoutDigits]);
  }

  private uniqueAliases(values: string[]): string[] {
    const aliases: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const clean = this.cleanText(value, 40);
      const key = clean.toLocaleLowerCase();
      if (clean.length < 2 || seen.has(key)) continue;
      seen.add(key);
      aliases.push(clean);
      if (aliases.length >= 12) break;
    }
    return aliases;
  }

  private cleanText(value: string, maxLength: number): string {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maxLength);
  }

  private read(): PersonaProfileFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, profiles: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<PersonaProfileFile>;
      const profiles = Array.isArray(parsed.profiles)
        ? parsed.profiles.filter(this.isValidProfile)
        : [];
      return { version: 1, profiles };
    } catch {
      return { version: 1, profiles: [] };
    }
  }

  private write(data: PersonaProfileFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  private readonly isValidProfile = (value: unknown): value is PersonaProfile => {
    if (!value || typeof value !== 'object') return false;
    const profile = value as Partial<PersonaProfile>;
    return typeof profile.userId === 'string'
      && typeof profile.displayName === 'string'
      && Array.isArray(profile.aliases)
      && profile.aliases.every(alias => typeof alias === 'string')
      && typeof profile.description === 'string'
      && typeof profile.updatedAt === 'number';
  };
}
