import type { JarvisRequestRoute } from '../intent/requestRouter';
import type { ModelRouteIntent, ModelWorkload } from './types';
import { MODEL_WORKLOADS } from './types';

const ALIASES: Record<string, ModelWorkload> = {
  casual_chat: 'casual',
  voice: 'voice_realtime',
};

export function normalizeWorkload(intent: ModelRouteIntent | string): ModelWorkload {
  const alias = ALIASES[intent];
  if (alias) return alias;
  if ((MODEL_WORKLOADS as readonly string[]).includes(intent)) return intent as ModelWorkload;
  return 'casual';
}

export function workloadFromRoute(route: string, objective = ''): ModelWorkload {
  const text = objective.toLowerCase();
  if (route === 'RESEARCH' || /\bresearch\b|ค้นคว้า/u.test(text)) return 'research';
  if (route === 'INFORMATION') return 'information';
  if (route === 'WORK' || /\bfix\b|\bimplement\b|\bpatch\b|coding|code/u.test(text)) return 'coding';
  if (/vision|look at (the )?screen|see this (panel|window)|วิเคราะห์ภาพ/u.test(text)) return 'vision';
  if (/realtime|voice|พูด|ไมค์/u.test(text)) return 'voice_realtime';
  if (route === 'CONVERSATION') return 'casual';
  return 'casual';
}

export function workloadFromRequestRoute(route: JarvisRequestRoute, objective?: string): ModelWorkload {
  return workloadFromRoute(route, objective);
}
