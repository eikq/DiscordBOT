export const RESEARCH_PRIVATE_BROWSE = 'research.privateBrowse';

export const PRIVATE_RESEARCH_CAPABILITY_IDS = [RESEARCH_PRIVATE_BROWSE] as const;

export const OWNER_BROWSER_CHANNELS = [
  'chrome',
  'msedge',
  'chrome-beta',
  'msedge-beta',
  'msedge-dev',
  'chrome-dev',
] as const;

export const BLOCKED_BROWSER_ACTIONS = [
  'login',
  'account_create',
  'purchase',
  'payment',
  'upload',
  'send_message',
  'post_comment',
  'sensitive_form',
  'save_password',
  'install_extension',
  'download_executable',
  'camera',
  'microphone',
  'geolocation',
  'clipboard',
] as const;

export const ALLOWED_BROWSER_ACTIONS = [
  'navigate',
  'read_page',
  'scroll',
  'render_javascript',
  'follow_public_link',
  'search',
  'extract_text',
  'extract_structured',
  'collect_source_metadata',
  'temporary_screenshot',
] as const;

export const BLOCKED_DOWNLOAD_EXTENSIONS = [
  '.exe',
  '.msi',
  '.ps1',
  '.bat',
  '.cmd',
  '.scr',
  '.dll',
  '.jar',
  '.com',
  '.pif',
  '.vbs',
  '.js',
  '.wsf',
] as const;

export const RESEARCH_DEPTHS = ['none', 'quick', 'standard', 'deep', 'forensic'] as const;

export function isPrivateResearchCapabilityId(id: string): boolean {
  return (PRIVATE_RESEARCH_CAPABILITY_IDS as readonly string[]).includes(id);
}

export function isResearchDepth(value: unknown): value is typeof RESEARCH_DEPTHS[number] {
  return typeof value === 'string' && (RESEARCH_DEPTHS as readonly string[]).includes(value);
}
