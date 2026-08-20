import { randomBytes } from 'node:crypto';
import { looksLikeSecret } from '../security/redaction';
import type { PrivilegeActor } from '../security/types';
import type { JsonCollection } from './persistTypes';
import { shouldRecordSocialEvolution } from './socialFilter';
import type { ExperienceRecord } from './types';

export type CreateExperienceInput = Omit<ExperienceRecord, 'id' | 'createdAt'> & {
  id?: string;
  channel?: 'discord' | 'standalone' | 'system';
  eventKind?: string;
};

export class ExperienceStore {
  private readonly items = new Map<string, ExperienceRecord>();
  private readonly now: () => number;
  private readonly persist?: JsonCollection<ExperienceRecord>;

  constructor(now: () => number = () => Date.now(), persist?: JsonCollection<ExperienceRecord>) {
    this.now = now;
    this.persist = persist;
    for (const item of persist?.load() ?? []) this.items.set(item.id, item);
  }

  public create(input: CreateExperienceInput, actor: PrivilegeActor = 'system'): ExperienceRecord {
    assertExperienceWritable(input, actor);
    if (input.id && this.items.has(input.id)) {
      return { ...this.items.get(input.id)! };
    }
    const { channel: _channel, eventKind: _eventKind, ...rest } = input;
    const record: ExperienceRecord = {
      ...rest,
      id: input.id ?? `exp_${randomBytes(6).toString('hex')}`,
      createdAt: new Date(this.now()).toISOString(),
      lessons: input.lessons ?? [],
      actions: input.actions ?? [],
      tools: input.tools ?? [],
    };
    this.items.set(record.id, record);
    this.persist?.replace(this.list());
    return { ...record };
  }

  public createIfSignificant(input: CreateExperienceInput, actor: PrivilegeActor = 'system'): ExperienceRecord | null {
    assertExperienceWritable(input, actor);
    if (input.id && this.items.has(input.id)) {
      return { ...this.items.get(input.id)! };
    }
    if ((input.significance ?? 0.5) < 0.2) return null;
    return this.create(input, actor);
  }

  public get(id: string): ExperienceRecord | undefined {
    const item = this.items.get(id);
    return item ? { ...item } : undefined;
  }

  public similarFailures(cause: string): ExperienceRecord[] {
    const needle = cause.trim().toLowerCase();
    return [...this.items.values()]
      .filter(item => item.outcome === 'failure' && (item.cause || item.result).toLowerCase().includes(needle))
      .map(item => ({ ...item }));
  }

  public list(): ExperienceRecord[] {
    return [...this.items.values()].map(item => ({ ...item }));
  }
}

function assertExperienceWritable(input: CreateExperienceInput, actor: PrivilegeActor): void {
  if (actor === 'webpage' || actor === 'skill') {
    throw Object.assign(new Error('Untrusted content cannot write experience memory.'), { reasonCode: 'UNTRUSTED_MEMORY_WRITE' });
  }
  const text = [input.goal, input.situation, input.result, ...(input.lessons ?? [])].join(' ');
  if (looksLikeSecret(text)) {
    throw Object.assign(new Error('Experience text contained a secret and was rejected.'), { reasonCode: 'SECRET_IN_EXPERIENCE' });
  }
  if (input.channel === 'discord' || input.eventKind === 'message' || input.eventKind === 'discord_message') {
    if (!shouldRecordSocialEvolution({
      kind: input.eventKind ?? 'message',
      channel: input.channel ?? 'discord',
      significance: input.significance,
    })) {
      throw Object.assign(new Error('Discord messages are not evolution records.'), { reasonCode: 'SOCIAL_NOT_EVOLUTION' });
    }
  }
}
