import { configuredAgentRuntime, resolveHermesRuntimeConfig } from './config';
import { HermesRuntimeAdapter } from './HermesRuntimeAdapter';
import type { AgentRuntime } from './types';

export * from './types';
export * from './config';
export { HermesRuntimeAdapter, HermesRuntimeError } from './HermesRuntimeAdapter';
export type { HermesRuntimeAdapterOptions } from './HermesRuntimeAdapter';

export function createConfiguredAgentRuntime(env: NodeJS.ProcessEnv = process.env): AgentRuntime | undefined {
  if (configuredAgentRuntime(env) !== 'hermes') return undefined;
  return new HermesRuntimeAdapter(resolveHermesRuntimeConfig(env));
}export * from './binding';
export * from './journalBridge';
