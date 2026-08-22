import type { CompactCapability, InteractionContext } from './types';

export const SEMANTIC_RESOLVER_SYSTEM = [
  'You map a user request to ONE registered Jarvis capability or a clarification.',
  'Return JSON only. No markdown.',
  'Shape: {"kind":"CAPABILITY|CLARIFICATION|CONVERSATION|UNSUPPORTED|FORBIDDEN","capabilityId":"optional","arguments":{},"confidence":"HIGH|MEDIUM|LOW","reasonCode":"CODE","userMessage":"optional Thai or English"}',
  'capabilityId must be copied from the catalog. Never invent an id.',
  'Never decide permission, never allow or confirm, never include command, path, pid, method, headers, body, cookie, or tokens.',
  'Interpretation is not authority. Do not execute.',
  'If Active project/plan/goal is provided, use it as the default target. Do not ask for a slug when exactly one active project is set.',
  'Project preview is project.startDevServer, never desktop.openScopedResource.',
  'Rebuild of the current project is project.build, never project.createWorkspace.',
  'Follow-ups like continue/do it/the first one/it/this site refer to Active context.',
  'If details are missing, kind=CLARIFICATION and ask one short question.',
  'If no catalog item can help, kind=UNSUPPORTED and say so briefly.',
  'Talking about a blocked tool is CONVERSATION. Requesting to run it is FORBIDDEN.',
  'Do not claim an action already happened.',
].join(' ');

export function buildSemanticUserPrompt(
  text: string,
  catalog: CompactCapability[],
  context?: InteractionContext | null,
): string {
  const lines = catalog.map(item => `- ${item.id}: ${item.shortDescription} args=${item.argumentSchemaSummary} risk=${item.sideEffectClass} avail=${item.availability}`);
  return [
    'Catalog:',
    ...lines,
    context?.lastCapabilityId ? `Recent capability: ${context.lastCapabilityId}` : '',
    context?.lastServiceId ? `Recent service: ${context.lastServiceId}` : '',
    context?.activeProjectSlug ? `Active project: ${context.activeProjectSlug}` : '',
    context?.activePlanId ? `Active plan: ${context.activePlanId}` : '',
    context?.activeGoalId ? `Active goal: ${context.activeGoalId}` : '',
    context?.activePreviewUrl ? `Active preview: ${context.activePreviewUrl}` : '',
    context?.recentResearchQuery ? `Recent research query: ${context.recentResearchQuery}` : '',
    context?.recentDocumentQuery ? `Recent workspace query: ${context.recentDocumentQuery}` : '',
    context?.recentWorkspaceId ? `Recent workspace: ${context.recentWorkspaceId}` : '',
    `User: ${text}`,
  ].filter(Boolean).join('\n');
}

export async function runSemanticResolver(
  generateText: (request: { systemPrompt?: string; userPrompt: string; temperature?: number; maxTokens?: number }) => Promise<string | null>,
  text: string,
  catalog: CompactCapability[],
  context?: InteractionContext | null,
): Promise<unknown> {
  const raw = await generateText({
    systemPrompt: SEMANTIC_RESOLVER_SYSTEM,
    userPrompt: buildSemanticUserPrompt(text, catalog, context),
    temperature: 0,
    maxTokens: 180,
  });
  if (!raw?.trim()) throw new Error('SEMANTIC_EMPTY');
  return parseSemanticJson(raw);
}

export function parseSemanticJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/iu, '').replace(/```$/u, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('SEMANTIC_JSON');
  return JSON.parse(trimmed.slice(start, end + 1));
}
