import fs from 'node:fs';
import path from 'node:path';

const KEYS = [
  'JARVIS_EDITION',
  'JARVIS_STANDALONE',
  'HOST',
  'PORT',
  'JARVIS_LLM_BASE_URL',
  'JARVIS_LLM_MODEL',
  'JARVIS_LLM_API_KEY',
] as const;

export function writeCommunityEnvFile(
  patch: Partial<Record<(typeof KEYS)[number], string | undefined>>,
  workspaceRoot = process.cwd(),
): { path: string; wroteKey: boolean } {
  const file = path.join(workspaceRoot, '.env.community');
  const example = path.join(workspaceRoot, '.env.community.example');
  let current = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8')
    : fs.existsSync(example)
      ? fs.readFileSync(example, 'utf8')
      : 'JARVIS_EDITION=community\nJARVIS_STANDALONE=1\nHOST=127.0.0.1\nPORT=3012\n';
  const set = (key: string, value: string) => {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    current = pattern.test(current) ? current.replace(pattern, line) : `${current.trimEnd()}\n${line}\n`;
  };
  set('JARVIS_EDITION', 'community');
  set('JARVIS_STANDALONE', '1');
  set('HOST', '127.0.0.1');
  if (patch.PORT) set('PORT', patch.PORT);
  if (patch.JARVIS_LLM_BASE_URL) set('JARVIS_LLM_BASE_URL', patch.JARVIS_LLM_BASE_URL);
  if (patch.JARVIS_LLM_MODEL) set('JARVIS_LLM_MODEL', patch.JARVIS_LLM_MODEL);
  let wroteKey = false;
  if (typeof patch.JARVIS_LLM_API_KEY === 'string' && patch.JARVIS_LLM_API_KEY.trim()) {
    set('JARVIS_LLM_API_KEY', patch.JARVIS_LLM_API_KEY.trim());
    wroteKey = true;
  }
  fs.writeFileSync(file, current.endsWith('\n') ? current : `${current}\n`, 'utf8');
  return { path: file, wroteKey };
}
