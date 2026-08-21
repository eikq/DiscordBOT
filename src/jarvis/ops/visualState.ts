import type { JarvisOperationEvent, JarvisOperationEventType } from '../security/types';
import { JARVIS_VISUAL_STATES, type JarvisVisualState } from './types';

const TYPE_TO_STATE: Partial<Record<JarvisOperationEventType, JarvisVisualState>> = {
  UNDERSTANDING: 'UNDERSTANDING',
  PLANNING: 'PLANNING',
  SEARCH: 'WEB_SEARCH',
  NAVIGATE: 'FETCHING',
  SOURCE: 'FETCHING',
  EVIDENCE: 'COMPARING',
  COMPARE: 'COMPARING',
  VERIFY: 'VERIFYING',
  MODEL: 'MODEL_GENERATING',
  PRIVILEGE_REQUEST: 'WAITING_PERMISSION',
  PRIVILEGE_DENIED: 'WAITING_PERMISSION',
  PRIVILEGE_APPROVED: 'EXECUTING',
  CAPABILITY_REQUEST: 'EXECUTING',
  EXPERIENCE_CREATED: 'LEARNING',
  REFLECTION: 'REFLECTING',
  SKILL_PROPOSED: 'LEARNING',
  SKILL_TESTED: 'VERIFYING',
  SKILL_PROMOTED: 'EVOLVING',
  CANDIDATE_REJECTED: 'REFLECTING',
  ERROR: 'ERROR',
  TASK_RECEIVED: 'UNDERSTANDING',
  TASK_STEP: 'EXECUTING',
  TASK_RETRY: 'EXECUTING',
  TASK_CANCELLED: 'IDLE',
  TASK_BLOCKED: 'WAITING_PERMISSION',
  TASK_COMPLETED: 'RESPONDING',
  TASK_FAILED: 'ERROR',
  PERMISSION_WAITING: 'WAITING_PERMISSION',
  GOAL_WAITING_INPUT: 'WAITING_PERMISSION',
  NIGHT_CYCLE: 'EVOLVING',
  MONITOR: 'DEGRADED',
  DEVICE: 'IDLE',
  VISION: 'UNDERSTANDING',
  PROGRESS: 'EXECUTING',
  CANCELLED: 'IDLE',
  SPEECH: 'SPEAKING',
  LISTENING: 'LISTENING',
  MEMORY: 'MEMORY_RETRIEVAL',
  WORKSPACE: 'WORKSPACE_SEARCH',
  SIMULATION: 'UNDERSTANDING',
  AFFECT: 'IDLE',
  PRIVATE_ROUTE_CHECK: 'PRIVATE_RESEARCH',
  BROWSER_START: 'PRIVATE_RESEARCH',
  BROWSER_DESTROY: 'IDLE',
};

export function visualStateFromEvent(event: Pick<JarvisOperationEvent, 'type' | 'level' | 'visualState'>): JarvisVisualState {
  if (event.visualState && (JARVIS_VISUAL_STATES as readonly string[]).includes(event.visualState)) {
    return event.visualState as JarvisVisualState;
  }
  if (event.level === 'error') return 'ERROR';
  return TYPE_TO_STATE[event.type] ?? 'IDLE';
}

export function visualStateFromEvents(events: Array<Pick<JarvisOperationEvent, 'type' | 'level' | 'visualState' | 'at'>>): JarvisVisualState {
  const latest = events.at(-1);
  if (!latest) return 'IDLE';
  return visualStateFromEvent(latest);
}

export function operationalLabel(state: JarvisVisualState, progress?: { current: number; total: number }): string {
  const base = state.replaceAll('_', ' ');
  if (!progress || progress.total <= 0) return base;
  return `${base} — ${progress.current} / ${progress.total}`;
}
