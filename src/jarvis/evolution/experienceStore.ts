import { randomBytes } from 'node:crypto';
import { looksLikeSecret } from '../security/redaction';
import type { PrivilegeActor } from '../security/types';
import type { ExperienceRecord } from './types';

export type CreateExperienceInput = Omit<ExperienceRecord, 'id' | 'createdAt'> & { id?: string };

export class ExperienceStore {
  private readonly items = new Map<string, ExperienceRecord>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  public create(input: CreateExperienceInput, actor: PrivilegeActor = 'system'): ExperienceRecord {
    if (actor === 'webpage' || actor === 'skill') {
      throw Object.assign(new Error('Untrusted content cannot write experience memory.'), { reasonCode: 'UNTRUSTED_MEMORY_WRITE' });
    }
    const text = [input.goal, input.situation, input.result, ...(input.lessons ?? [])].join(' ');
    if (looksLikeSecret(text)) {
      throw Object.assign(new Error('Experience text contained a secret and was rejected.'), { reasonCode: 'SECRET_IN_EXPERIENCE' });
    }
    const record: ExperienceRecord = {
      ...input,
      id: input.id ?? `exp_${randomBytes(6).toString('hex')}`,
      createdAt: new Date(this.now()).toISOString(),
      lessons: input.lessons ?? [],
      actions: input.actions ?? [],
      tools: input.tools ?? [],
    };
    this.items.set(record.id, record);
    return { ...record };
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
