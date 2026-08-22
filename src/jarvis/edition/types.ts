export const JARVIS_EDITIONS = ['owner', 'community'] as const;

export type JarvisEdition = (typeof JARVIS_EDITIONS)[number];

export type CommunityCapabilityFlags = {
  conversation: boolean;
  memory: boolean;
  history: boolean;
  research: boolean;
  softwareBuilder: boolean;
  projectWorkspace: boolean;
  localhostPreview: boolean;
  plans: boolean;
  permission: boolean;
  devices: boolean;
  cctv: boolean;
  cybersecurity: boolean;
  privateBrowser: boolean;
  desktop: boolean;
  worldIntel: boolean;
};

export type JarvisEditionManifest = {
  edition: JarvisEdition;
  label: string;
  sessionId: string;
  dataRootKind: 'owner' | 'community';
  capabilities: CommunityCapabilityFlags;
};

export const COMMUNITY_LAB_PAGE_IDS = [
  'home',
  'assistant',
  'tasks',
  'research',
  'workspace',
  'security',
  'system',
  'activity',
  'settings',
] as const;

export const COMMUNITY_SAMPLE_PROMPTS = [
  { id: 'create', label: 'CREATE', text: 'สร้างเว็บ todo แบบ modern ให้ผม' },
  { id: 'continue', label: 'CONTINUE', text: 'เพิ่ม dark mode' },
  { id: 'verify', label: 'VERIFY', text: 'รัน test แล้วถ้าผ่าน build ต่อ' },
  { id: 'preview', label: 'PREVIEW', text: 'เปิด preview' },
  { id: 'research', label: 'RESEARCH', text: 'หา documentation React animation ให้หน่อย' },
  { id: 'memory', label: 'MEMORY', text: 'จำไว้ว่าผมชอบ UI แบบ clean futuristic' },
  { id: 'history', label: 'HISTORY', text: 'เมื่อกี้เราทำอะไรไปบ้าง' },
  { id: 'status', label: 'STATUS', text: 'ตอนนี้คุณทำอะไรได้บ้าง' },
] as const;

export const COMMUNITY_MODEL_OFFLINE_MESSAGE =
  'LOCAL MODEL OFFLINE. Configure an OpenAI-compatible local model to begin.';
