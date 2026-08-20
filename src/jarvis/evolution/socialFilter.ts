export function shouldRecordSocialEvolution(input: {
  kind?: string;
  channel?: 'discord' | 'standalone' | 'system';
  significance?: number;
  meaningful?: boolean;
}): boolean {
  if (input.channel === 'discord' && input.kind === 'message') return false;
  if (input.kind === 'discord_message') return false;
  if (input.meaningful === false) return false;
  return (input.significance ?? 0) >= 0.2;
}
