const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'env_assignment', pattern: /(?:DISCORD_TOKEN|API_KEY|OPENAI_API_KEY|BEARER|PASSWORD|SECRET|TOKEN)\s*[=:]\s*\S+/giu },
  { name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu },
  { name: 'url_userinfo', pattern: /(?<=:\/\/)[^/\s:@]+:[^@\s/]+(?=@)/giu },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g },
  { name: 'discord_token', pattern: /\b[MN][A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}\b/g },
  { name: 'cookie_header', pattern: /(?:Cookie|Set-Cookie)\s*[:=]\s*[^\s]+/giu },
  { name: 'password_field', pattern: /("password"\s*:\s*")[^"]+"/giu },
];

const SECRET_PATH_HINT = /(?:^|[\\/])\.env(?:\.[A-Za-z0-9_-]+)?$|(?:^|[\\/])(?:data[\\/]brain|data[\\/]memory|voice_samples)[\\/]/iu;

export function redactSecrets(value: string): string {
  let out = value;
  for (const { pattern } of SECRET_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out.replace(SECRET_PATH_HINT, '[REDACTED_PATH]');
}

export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.slice(0, 32).map(item => redactDeep(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|cookie|authorization|api[_-]?key|\.env/iu.test(key)) {
        out[key] = '[REDACTED]';
        continue;
      }
      out[key] = redactDeep(item, depth + 1);
    }
    return out;
  }
  return value;
}

export function looksLikeSecret(value: string): boolean {
  if (!value) return false;
  if (SECRET_PATH_HINT.test(value)) return true;
  return SECRET_PATTERNS.some(item => new RegExp(item.pattern.source, item.pattern.flags.replace('g', '')).test(value));
}
