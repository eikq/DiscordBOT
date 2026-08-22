const COMMUNITY_EXCLUDED_PATHS = new Set([
  '/api/jarvis/private-research',
  '/api/jarvis/command-center/night',
  '/api/jarvis/night',
  '/api/behavior',
  '/api/personas',
]);

const COMMUNITY_EXCLUDED_PREFIXES = [
  '/api/intelligence',
  '/api/bot',
  '/api/control',
  '/api/voice-export',
  '/api/voice-samples',
  '/api/voice/',
  '/api/brain',
  '/api/transcripts',
  '/api/colab',
  '/api/tts/',
];

export function communityRejectedHttpPath(pathname: string): boolean {
  const path = pathname.split('?')[0] || '';
  if (COMMUNITY_EXCLUDED_PATHS.has(path)) return true;
  return COMMUNITY_EXCLUDED_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix));
}

export function communityRejectedDemoScenario(scenario: string): boolean {
  return scenario !== 'research' && scenario !== 'coding';
}
