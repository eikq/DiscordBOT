export const COMMUNITY_SERVICE_STATES = [
  'NOT_CONFIGURED',
  'STOPPED',
  'STARTING',
  'RUNNING',
  'DEGRADED',
  'STOPPING',
  'FAILED',
  'EXTERNAL',
  'UNKNOWN',
] as const;

export type CommunityServiceState = (typeof COMMUNITY_SERVICE_STATES)[number];

export type CommunityOwnershipRecord = {
  serviceId: 'jarvis-core' | 'local-ai';
  pid: number;
  startedAt: string;
  executablePath: string;
  commandProfileId: 'community-core-v1' | 'llama-server-gguf-v1';
  ownedByJarvis: true;
};

export type CommunityServiceRecord = {
  id: 'jarvis-core' | 'local-ai';
  displayNameTh: string;
  displayNameEn: string;
  descriptionTh: string;
  descriptionEn: string;
  required: boolean;
  optional: boolean;
  state: CommunityServiceState;
  ownedByJarvis: boolean;
  canStop: boolean;
  canStart: boolean;
  pid?: number;
  ramBytes?: number;
  health?: string;
  noteTh?: string;
  noteEn?: string;
};
