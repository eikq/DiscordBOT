import fs from 'node:fs';
import path from 'node:path';
import type { ActionAuditEvent } from './types';

export class ActionAuditLog {
  constructor(private readonly filePath: string) {}

  public record(event: ActionAuditEvent): void {
    const line = `${JSON.stringify(sanitize(event))}\n`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, line, 'utf8');
  }

  public readAll(): ActionAuditEvent[] {
    if (!fs.existsSync(this.filePath)) return [];
    return fs.readFileSync(this.filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as ActionAuditEvent);
  }
}

export function defaultActionAuditPath(workspaceRoot = process.cwd()): string {
  return path.join(workspaceRoot, 'data', 'jarvis', 'audit', 'actions.jsonl');
}

function sanitize(event: ActionAuditEvent): ActionAuditEvent {
  return {
    v: 1,
    at: event.at,
    proposalId: event.proposalId,
    capabilityId: event.capabilityId,
    risk: event.risk,
    decision: event.decision,
    result: event.result,
    source: event.source,
    ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
    ...(event.targetClass ? { targetClass: event.targetClass } : {}),
  };
}
