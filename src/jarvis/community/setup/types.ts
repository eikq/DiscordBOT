export const COMMUNITY_SETUP_SCHEMA = 1 as const;
export const COMMUNITY_SERVICE_IDS = ['jarvis-core', 'local-ai'] as const;
export type CommunityServiceId = (typeof COMMUNITY_SERVICE_IDS)[number];
export type CommunityLanguage = 'th' | 'en';
export type CommunityProfile = 'minimal' | 'standard' | 'custom';
export type CloseBehavior = 'keep-model' | 'stop-owned-model';
export type ModelMode = 'endpoint' | 'managed';

export type CommunityModelSetup = {
  mode: ModelMode;
  baseUrl: string;
  modelId: string;
  hasApiKey: boolean;
  llamaServerPath?: string;
  ggufPath?: string;
  contextSize?: number;
  port?: number;
  alias?: string;
};

export type CommunitySetupState = {
  schemaVersion: typeof COMMUNITY_SETUP_SCHEMA;
  completed: boolean;
  language: CommunityLanguage;
  profile: CommunityProfile;
  autoStart: boolean;
  closeBehavior: CloseBehavior;
  managedServiceIds: CommunityServiceId[];
  model: CommunityModelSetup;
  updatedAt: string;
};

export const DEFAULT_COMMUNITY_SETUP: CommunitySetupState = {
  schemaVersion: COMMUNITY_SETUP_SCHEMA,
  completed: false,
  language: 'th',
  profile: 'standard',
  autoStart: true,
  closeBehavior: 'keep-model',
  managedServiceIds: ['jarvis-core'],
  model: {
    mode: 'endpoint',
    baseUrl: 'http://127.0.0.1:8086/v1',
    modelId: 'local-model',
    hasApiKey: false,
    port: 8086,
    contextSize: 4096,
  },
  updatedAt: new Date(0).toISOString(),
};

export function isCommunityServiceId(value: string): value is CommunityServiceId {
  return (COMMUNITY_SERVICE_IDS as readonly string[]).includes(value);
}
