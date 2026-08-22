import fs from 'node:fs';
import path from 'node:path';
import type { ConversationSessionRecord, ConversationTurnRecord } from '../../bot/memory/jarvis/conversationStore';
import type { JarvisMemoryStore } from '../../bot/memory/jarvis/store';
import type { SemanticFactRecord } from '../../bot/memory/jarvis/types';
import type { BuildPlan } from '../build/types';
import { OWNER_PREF_PREFIX, listOwnerAliases } from './ownerSemantics';

export function defaultObsidianVaultPath(): string {
  return path.join(process.cwd(), 'data', 'jarvis', 'obsidian');
}

export type ObsidianProjectionInput = {
  vaultPath?: string;
  store: JarvisMemoryStore;
  sessions: ConversationSessionRecord[];
  turnsBySession: Record<string, ConversationTurnRecord[]>;
  plans?: BuildPlan[];
};

export function projectObsidianVault(input: ObsidianProjectionInput): string {
  const root = input.vaultPath || defaultObsidianVaultPath();
  fs.mkdirSync(path.join(root, 'Daily'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Conversations'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Memory'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Projects'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Plans'), { recursive: true });

  const facts = input.store.listFacts({ limit: 80 }).filter(item => item.status === 'active');
  const aliases = listOwnerAliases(input.store);
  const prefs = facts.filter(item => item.factKey.startsWith(OWNER_PREF_PREFIX));
  const recent = input.sessions.slice(0, 8);
  const activePlans = (input.plans || []).filter(plan => plan.status !== 'COMPLETED' && plan.status !== 'FAILED');

  write(path.join(root, 'Home.md'), homeMarkdown(recent, activePlans, prefs));
  write(path.join(root, 'Memory', 'Owner.md'), ownerMarkdown(aliases.map(item => `${item.phrase} → ${item.target}`), prefs));
  write(path.join(root, 'Projects', 'JARVIS.md'), '# JARVIS\n\nLocal standalone assistant. SQLite remains canonical. This vault is a view.\n');
  write(path.join(root, 'Daily', `${isoDate(Date.now())}.md`), dailyMarkdown(recent, activePlans));

  for (const session of recent) {
    write(path.join(root, 'Conversations', `${safeFile(session.id)}.md`), conversationMarkdown(session, input.turnsBySession[session.id] || []));
  }
  for (const plan of activePlans) {
    write(path.join(root, 'Plans', `${safeFile(plan.goalId)}.md`), planMarkdown(plan));
  }
  return root;
}

function homeMarkdown(
  sessions: ConversationSessionRecord[],
  plans: BuildPlan[],
  prefs: SemanticFactRecord[],
): string {
  return [
    '# Home',
    '',
    '## Recent conversations',
    ...sessions.map(item => `- [[Conversations/${safeFile(item.id)}|${item.title || item.id}]]`),
    '',
    '## Active plans',
    ...(plans.length ? plans.map(item => `- [[Plans/${safeFile(item.goalId)}|${item.title}]]`) : ['- None']),
    '',
    '## Important memories',
    ...(prefs.length ? prefs.slice(0, 8).map(item => `- ${item.predicate}: ${item.objectValue}`) : ['- [[Memory/Owner]]']),
    '',
    '## Projects',
    '- [[Projects/JARVIS]]',
    '',
  ].join('\n');
}

function ownerMarkdown(aliases: string[], prefs: SemanticFactRecord[]): string {
  return [
    '# Owner',
    '',
    '## Preferences',
    ...(prefs.length ? prefs.map(item => `- ${item.predicate}: ${item.objectValue}`) : ['- None stored.']),
    '',
    '## Aliases',
    ...(aliases.length ? aliases.map(item => `- ${item}`) : ['- None stored.']),
    '',
  ].join('\n');
}

function conversationMarkdown(session: ConversationSessionRecord, turns: ConversationTurnRecord[]): string {
  const day = isoDate(session.createdAt);
  const lines = [
    `# Conversation — ${day}`,
    '',
    `Model: [[Qwen3.8 Cyber]]`,
    '',
  ];
  for (const turn of turns) {
    lines.push(`## ${turn.role}`);
    lines.push(turn.visibleText || '_(incomplete)_');
    lines.push('');
  }
  lines.push('## Related');
  lines.push('- [[Projects/JARVIS]]');
  if (session.activeGoalId) lines.push(`- [[Plans/${safeFile(session.activeGoalId)}]]`);
  lines.push('');
  return lines.join('\n');
}

function planMarkdown(plan: BuildPlan): string {
  return [
    `# ${plan.title}`,
    '',
    plan.summary,
    '',
    `Status: ${plan.status}`,
    `Stack: ${plan.suggestedStack}`,
    '',
    '## Stages',
    ...plan.stages.map(stage => `- ${stage.title}: ${stage.status}`),
    '',
  ].join('\n');
}

function dailyMarkdown(sessions: ConversationSessionRecord[], plans: BuildPlan[]): string {
  return [
    `# ${isoDate(Date.now())}`,
    '',
    ...sessions.slice(0, 5).map(item => `- [[Conversations/${safeFile(item.id)}|${item.title}]]`),
    ...plans.slice(0, 3).map(item => `- Plan: [[Plans/${safeFile(item.goalId)}|${item.title}]]`),
    '',
  ].join('\n');
}

function write(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

function isoDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function safeFile(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, '_').slice(0, 80);
}
