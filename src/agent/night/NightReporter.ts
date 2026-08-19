import fs from 'node:fs';
import path from 'node:path';
import type { NightConfig, NightRunState } from './types';
import { NightStateStore } from './NightStateStore';

export function reportDateStamp(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

export function renderMorningReport(state: NightRunState, config: NightConfig): string {
  const records = Object.values(state.tasks);
  const completed = records.filter((item) => item.status === 'PASS');
  const blocked = records.filter((item) => item.status === 'BLOCKED' || item.status === 'FAILED_LIMIT' || item.status === 'BLOCKED_PROVIDER');
  const human = records.filter((item) => item.status === 'NEEDS_HUMAN_VERIFY');
  const tests = records.flatMap((item) => item.attempts.flatMap((attempt) => attempt.acceptance || []));
  const workerLines = records.map((item) => {
    const last = item.attempts[item.attempts.length - 1];
    const cursorAttempts = item.attempts.filter((attempt) => attempt.providerKind === 'cursor-cli').length;
    const qwenAttempts = item.attempts.filter((attempt) => attempt.providerKind === 'local-qwen').length;
    const failures = item.attempts
      .filter((attempt) => attempt.providerFailure)
      .map((attempt) => attempt.providerFailure!.code);
    return [
      '### ' + item.taskId + ' — ' + item.title,
      '- Status: ' + item.status,
      '- Worker: ' + (last?.workerId || 'none'),
      '- Cursor/Grok attempts: ' + cursorAttempts,
      '- Local Qwen attempts: ' + qwenAttempts,
      '- Provider failures: ' + (failures.join(', ') || 'none'),
      '- Files: ' + (item.filesChanged.join(', ') || 'none'),
      '- Attempts: ' + item.attempts.length + ' / durationMs ' + item.durationMs,
      item.blockedReason ? '- Blocked: ' + item.blockedReason : '',
      item.escalationPath ? '- Escalation: ' + item.escalationPath : '',
    ].filter(Boolean).join('\n');
  });
  return [
    '# Night Report',
    '',
    'Date: ' + reportDateStamp(new Date(state.startedAt)),
    '',
    '## Run',
    '- start: ' + state.startedAt,
    '- end: ' + (state.endedAt || state.updatedAt),
    '- status: ' + state.status,
    '- runId: ' + state.runId,
    '- workspace: ' + state.workspaceRoot,
    '- branch: ' + (state.branch || 'unknown'),
    '- profile: DEV_NIGHT',
    '- workspaceMode: ' + config.workspaceMode,
    '- cursorModel: ' + (config.cursorModel || config.workerProviders.find((item) => item.kind === 'cursor-cli')?.model || 'unset'),
    '- localQwenFallback: ' + String(config.localQwenFallback),
    '- codexFallback: ' + String(config.codexFallback),
    '- stopOnProviderFailure: ' + String(config.stopOnProviderFailure),
    '- Qwen context tokens: ' + state.qwenContextTokens,
    '- providers: ' + config.workerProviders.map((item) => item.id + ':' + item.kind).join(', '),
    '- agentSlots: 1',
    '',
    '## Completed tasks',
    completed.map((item) => workerLines[records.indexOf(item)]).join('\n\n') || '- none',
    '',
    '## All tasks',
    workerLines.join('\n\n') || '- none',
    '',
    '## Blocked / needs human verify',
    blocked.concat(human).map((item) => '- ' + item.taskId + ': ' + (item.blockedReason || item.status)).join('\n') || '- none',
    '',
    '## Tests',
    tests.map((item) => '- `' + item.command + '` exit ' + item.exitCode).join('\n') || '- none',
    '',
    '## Safety',
    state.safetyEvents.map((item) => '- ' + item.kind + ': ' + item.detail).join('\n') || '- none',
    '',
    '## Git',
    '- no-push confirmed: yes',
    '- auto-commit: not performed (v1 requires allowGitCommit + ownerApprovedGitCommit; both default false)',
    '- night worktree left intact for owner review; do not merge automatically',
    '- primary dirty repo is controller-only and must remain untouched',
    '',
    '## Resources',
    state.resourceNotes.map((item) => '- ' + item).join('\n') || '- none recorded',
    '',
    operatorNotesSection(state.workspaceRoot),
    '## Owner actions this morning',
    '- Read this report and any escalation packets under `.agent/night/escalations/`',
    '- Review diffs in the night workspace; do not push from the agent',
    '- Re-run failed acceptance commands before merging anything',
    '- Decide whether blocked tasks should be rewritten as smaller NIGHT_SAFE items',
    '',
  ].join('\n');
}

function operatorNotesSection(workspaceRoot: string): string {
  const file = path.join(workspaceRoot, '.agent', 'night', 'operator-notes.md');
  if (!fs.existsSync(file)) return '';
  const body = fs.readFileSync(file, 'utf8').trim();
  if (!body) return '';
  return ['## Operator preflight notes', '', body, '', ''].join('\n');
}

export class NightReporter {
  constructor(private readonly store: NightStateStore) {}

  write(state: NightRunState, config: NightConfig, now = new Date()): string {
    const body = renderMorningReport(state, config);
    fs.mkdirSync(this.store.reportsDir, { recursive: true });
    const file = path.join(this.store.reportsDir, 'NIGHT_REPORT-' + reportDateStamp(now) + '.md');
    fs.writeFileSync(file, body, 'utf8');
    return file;
  }
}