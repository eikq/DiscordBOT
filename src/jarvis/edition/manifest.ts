import { isOwnerOnlyCapability } from '../capabilities/distribution';
import { isForbiddenGenericShell } from '../security/constants';
import type { CommunityCapabilityFlags, JarvisEdition, JarvisEditionManifest } from './types';

const COMMUNITY_BLOCKED_PREFIXES = [
  'devices.',
  'camera.',
  'cctv.',
  'phone.',
  'screen.',
  'cyber.',
  'cybersecurity.',
  'securityAcademy.',
  'desktop.',
  'intel.',
  'world-intel.',
] as const;

const COMMUNITY_BLOCKED_IDS = new Set([
  'research.privateBrowse',
  'jarvis.startService',
  'jarvis.stopService',
  'jarvis.restartService',
]);

export function communityCapabilityFlags(): CommunityCapabilityFlags {
  return {
    conversation: true,
    memory: true,
    history: true,
    research: true,
    softwareBuilder: true,
    projectWorkspace: true,
    localhostPreview: true,
    plans: true,
    permission: true,
    devices: false,
    cctv: false,
    cybersecurity: false,
    privateBrowser: false,
    desktop: false,
    worldIntel: false,
  };
}

export function jarvisEditionManifest(edition: JarvisEdition): JarvisEditionManifest {
  if (edition === 'community') {
    return {
      edition,
      label: 'JARVIS Community',
      sessionId: 'jarvis-lab',
      dataRootKind: 'community',
      capabilities: communityCapabilityFlags(),
    };
  }
  return {
    edition,
    label: 'JARVIS Owner',
    sessionId: 'jarvis-lab',
    dataRootKind: 'owner',
    capabilities: {
      ...communityCapabilityFlags(),
      devices: true,
      cctv: true,
      cybersecurity: true,
      privateBrowser: true,
      desktop: true,
      worldIntel: true,
    },
  };
}

export function isCommunityCapabilityAllowed(id: string): boolean {
  if (isForbiddenGenericShell(id)) return false;
  if (COMMUNITY_BLOCKED_IDS.has(id)) return false;
  if (COMMUNITY_BLOCKED_PREFIXES.some(prefix => id.startsWith(prefix))) return false;
  if (isOwnerOnlyCapability(id)) return false;
  return true;
}

export function communityCapabilitySummaryText(): string {
  return [
    'Jarvis Community ช่วยได้เรื่อง conversation, research, memory/history,',
    'วางแผนและสร้างซอฟต์แวร์หรือเว็บ, แล้วก็ test / build / preview บน localhost',
    'งานที่แก้ไฟล์ต้องขอสิทธิ์ก่อน และอยู่แค่ใน Community sandbox',
  ].join(' ');
}

export function communityUnavailablePrivateText(): string {
  return 'That capability is not part of Jarvis Community Edition.';
}
