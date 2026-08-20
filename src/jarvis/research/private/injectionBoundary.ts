import { webpageTextAsData } from '../htmlText';
import type { UntrustedWebInterpretation } from './types';

const INJECTION_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: 'ignore_instructions', pattern: /ignore (?:your|all|previous|system) instructions/iu },
  { code: 'ignore_owner_policy', pattern: /ignore owner policy/iu },
  { code: 'grant_capability', pattern: /(?:grant|enable|request).{0,40}(?:capability|privilege|admin|shell)/iu },
  { code: 'confirmation_token', pattern: /(?:use this |here is (?:your )?)confirmation token/iu },
  { code: 'read_env', pattern: /read .{0,40}(?:\.env|discord token|api key)/iu },
  { code: 'host_filesystem', pattern: /(?:c:\\users|\/etc\/passwd|read host files)/iu },
  { code: 'install_software', pattern: /install (?:this program|software|virtualbox|an? extension)/iu },
  { code: 'open_localhost', pattern: /open localhost/iu },
  { code: 'write_memory', pattern: /write .{0,40}(?:trusted skill|durable memory|system prompt|owner-trusted)/iu },
];

export function interpretWebContent(text: string): UntrustedWebInterpretation {
  const injectionSignals = INJECTION_PATTERNS
    .filter(item => item.pattern.test(text))
    .map(item => item.code);
  return {
    kind: 'untrusted_data',
    text: webpageTextAsData(text, 400),
    injectionSignals,
    capabilityRequests: [],
    privilegeRequests: [],
    filesystemRequests: [],
    ignoredAsInstruction: true,
  };
}

export function webContentMayInvokeCapability(): false {
  return false;
}

export function webContentMayRequestPrivilege(): false {
  return false;
}

export function webContentMayReadHostFilesystem(): false {
  return false;
}
