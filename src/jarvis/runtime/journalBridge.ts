import type { ExecutionJournalCoordinator } from '../executionJournal/coordinator';
import type { ExecutionJournalRecord } from '../executionJournal/types';
import { sha256 } from '../executionJournal/fingerprints';
import type { AgentEvent, AgentRuntime } from './types';

const JOURNALED_RUNTIME_EVENTS = new Set([
  'tool.started',
  'tool.completed',
  'tool.failed',
  'approval.request',
  'approval.responded',
  'run.started',
  'run.steered',
  'run.stopping',
  'run.cancelled',
  'run.failed',
  'run.completed',
  'subagent.start',
  'subagent.complete',
]);

export class AgentRuntimeJournalBridge {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly journal: ExecutionJournalCoordinator,
  ) {}

  public recordEvent(operationId: string, event: AgentEvent): ExecutionJournalRecord {
    const current = this.requireOperation(operationId);
    if (!JOURNALED_RUNTIME_EVENTS.has(event.type)) return current;
    const evidenceRef = runtimeEvidenceRef(event);
    return this.journal.recordEvidence(operationId, [evidenceRef], 'system');
  }

  public async observeRun(
    operationId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<ExecutionJournalRecord> {
    this.requireOperation(operationId);
    for await (const event of this.runtime.streamEvents(runId, signal)) {
      this.recordEvent(operationId, event);
    }
    return this.requireOperation(operationId);
  }

  private requireOperation(operationId: string): ExecutionJournalRecord {
    const record = this.journal.get(operationId);
    if (!record) throw new Error(`Unknown JARVIS execution journal operation: ${operationId}`);
    return record;
  }
}

export function runtimeEvidenceRef(event: AgentEvent): string {
  const safeType = event.type.toLowerCase().replace(/[^a-z0-9._-]+/gu, '_').slice(0, 48) || 'event';
  const fingerprint = sha256(JSON.stringify({
    runtime: 'hermes',
    event: event.type,
    runId: event.runId,
    tool: event.tool || '',
    error: event.error === true || typeof event.error === 'string',
  })).slice(0, 24);
  return `runtime:hermes:${safeType}:${fingerprint}`;
}
