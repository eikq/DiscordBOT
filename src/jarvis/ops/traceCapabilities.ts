import type { ActionResult, ToolResultRef } from '../core/types';
import type { TraceCapabilityRef } from './traceTypes';

export function traceCapabilitiesFromTurn(input: {
  actionResults?: ActionResult[];
  toolResults?: ToolResultRef[];
}): TraceCapabilityRef[] {
  const refs: TraceCapabilityRef[] = [];
  const seen = new Set<string>();
  for (const action of input.actionResults ?? []) {
    const id = (action.capabilityId || action.name || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    refs.push({
      id,
      status: action.status === 'completed' ? 'ok' : action.status,
      ...(action.risk ? { risk: action.risk } : {}),
    });
  }
  for (const tool of input.toolResults ?? []) {
    const id = String(tool.toolName || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    refs.push({
      id,
      status: tool.status,
    });
  }
  return refs;
}

export function traceCapabilitiesFromWork(
  toolResults: Array<{ capability: string; status: string; risk?: string }>,
): TraceCapabilityRef[] {
    const byId = new Map<string, TraceCapabilityRef>();
    for (const item of toolResults) {
      const id = String(item.capability || '').trim();
      if (!id) continue;
      byId.set(id, {
        id,
        status: item.status,
        ...(item.risk ? { risk: item.risk } : {}),
      });
    }
    return [...byId.values()];
}
