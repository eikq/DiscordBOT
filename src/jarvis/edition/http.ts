const COMMUNITY_EXCLUDED_PATHS = new Set([
  '/api/jarvis/private-research',
  '/api/jarvis/command-center/night',
]);

export function communityRejectedHttpPath(pathname: string): boolean {
  const path = pathname.split('?')[0] || '';
  return COMMUNITY_EXCLUDED_PATHS.has(path);
}

export function communityRejectedDemoScenario(scenario: string): boolean {
  return scenario !== 'research' && scenario !== 'coding';
}
