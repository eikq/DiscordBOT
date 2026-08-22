/**
 * Convert a model completion into owner-visible text.
 * Raw chain-of-thought / reasoning_content is never returned.
 */

const THINK_BLOCK = /<think\b[^>]*>[\s\S]*?<\/think>/giu;
const DANGLING_THINK = /<think\b[^>]*>[\s\S]*$/giu;

export function visibleModelText(
  content: unknown,
  reasoningContent?: unknown,
): string | null {
  void reasoningContent;
  const raw = typeof content === 'string' ? content : '';
  const visible = raw.replace(THINK_BLOCK, '').replace(DANGLING_THINK, '').trim();
  return visible || null;
}

export function messageHasHiddenReasoning(message: Record<string, unknown> | undefined): boolean {
  if (!message) return false;
  const reasoning = message.reasoning_content ?? message.reasoning;
  return typeof reasoning === 'string' && reasoning.trim().length > 0;
}

export function parseOpenAiToolCalls(value: unknown): Array<{
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: Record<string, unknown>) => {
    const fn = entry?.function && typeof entry.function === 'object'
      ? entry.function as Record<string, unknown>
      : entry;
    const name = typeof fn?.name === 'string' ? fn.name.trim() : '';
    if (!name) return [];
    let args: unknown = fn?.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
    return [{
      id: typeof entry.id === 'string' ? entry.id : undefined,
      name,
      arguments: args as Record<string, unknown>,
    }];
  });
}
