import fs from 'node:fs';
import path from 'node:path';
import type { NightTask, TaskAttemptRecord } from './types';
import { NightStateStore } from './NightStateStore';

export type EscalationPacket = {
  taskId: string;
  path: string;
  body: string;
  cloud: { attempted: boolean; ok: boolean; reason: string };
};

export interface CloudEscalationAdapter {
  enabled: boolean;
  submit(packet: { taskId: string; body: string }): Promise<{ ok: boolean; reason: string }>;
}

export class DisabledCloudEscalation implements CloudEscalationAdapter {
  readonly enabled = false;
  async submit(): Promise<{ ok: boolean; reason: string }> {
    return { ok: false, reason: 'Cloud/Codex escalation is disabled or unavailable. Local packet saved; continuing independent tasks.' };
  }
}

export function renderEscalationPacket(input: {
  task: NightTask;
  problem: string;
  command?: string;
  error?: string;
  files: string[];
  attempts: TaskAttemptRecord[];
  diffSummary: string;
  lastPassing?: string;
  recommended: string;
}): string {
  const attemptLines = input.attempts.map((attempt) => {
    return '- attempt ' + attempt.attempt + ' worker=' + attempt.workerId + ' passed=' + attempt.passed + ' ' + attempt.summary;
  });
  const changes = input.attempts.map((attempt, index) => {
    if (index === 0) return '- attempt 1: ' + attempt.summary;
    return '- attempt ' + attempt.attempt + ': ' + attempt.summary;
  });
  return [
    '# Escalation Packet',
    '',
    'Task: ' + input.task.id + ' — ' + input.task.title,
    'Timestamp: ' + new Date().toISOString(),
    '',
    '## Goal',
    input.task.goal,
    '',
    '## Acceptance criteria',
    input.task.acceptanceCommands.map((command) => '- `' + command + '`').join('\n'),
    '',
    '## Current problem',
    input.problem,
    '',
    '## Exact failing command',
    input.command || '(none)',
    '',
    '## Exact error',
    (input.error || '(none)').slice(0, 4000),
    '',
    '## Relevant files',
    input.files.map((file) => '- ' + file).join('\n') || '- (none)',
    '',
    '## Current diff summary',
    input.diffSummary || '(no scoped diff)',
    '',
    '## Attempts made',
    attemptLines.join('\n') || '- none',
    '',
    '## What changed between attempts',
    changes.join('\n') || '- none',
    '',
    '## Suspected root cause',
    input.problem,
    '',
    '## Last known passing state',
    input.lastPassing || 'Unknown / not recorded',
    '',
    '## Constraints',
    '- NIGHT_SAFE only; no git push; no destructive git; no .env or private data; no Discord/CCTV/deploy',
    '- Cloud escalation is optional and must not block other tasks',
    '',
    '## Recommended next action',
    input.recommended,
    '',
  ].join('\n');
}

export class NightEscalation {
  constructor(
    private readonly store: NightStateStore,
    private readonly cloud: CloudEscalationAdapter = new DisabledCloudEscalation(),
  ) {}

  async create(input: Parameters<typeof renderEscalationPacket>[0]): Promise<EscalationPacket> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(this.store.escalationsDir, input.task.id + '-' + stamp + '.md');
    const body = renderEscalationPacket(input);
    fs.mkdirSync(this.store.escalationsDir, { recursive: true });
    fs.writeFileSync(file, body, 'utf8');
    let cloud = { attempted: false, ok: false, reason: 'not attempted' };
    if (this.cloud.enabled) {
      const result = await this.cloud.submit({ taskId: input.task.id, body });
      cloud = { attempted: true, ok: result.ok, reason: result.reason };
    } else {
      const result = await this.cloud.submit({ taskId: input.task.id, body });
      cloud = { attempted: false, ok: false, reason: result.reason };
    }
    return { taskId: input.task.id, path: file, body, cloud };
  }
}