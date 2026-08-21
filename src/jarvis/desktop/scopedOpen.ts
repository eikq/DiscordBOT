import { hostAllowed, urlHost } from './webAllowlist';
import type { DisplayInfo, DisplaySelector } from './monitorTopology';
import { resolveDisplaySelector } from './monitorTopology';

export type ScopedResourceKind = 'application' | 'url';

export type ScopedResource = {
  kind: ScopedResourceKind;
  applicationId?: string;
  url?: string;
  label: string;
};

export type ScopedOpenInput = {
  resource: ScopedResource;
  display?: DisplaySelector | null;
  displays?: DisplayInfo[];
  currentDisplayId?: string;
};

export type ScopedOpenPlan =
  | {
      ok: true;
      resource: ScopedResource;
      display?: DisplayInfo;
      placement: 'none' | 'requested';
      reasonCode: 'ALLOWLISTED_APPLICATION' | 'ALLOWLISTED_WEB' | 'SESSION_WEB_GRANT';
    }
  | {
      ok: false;
      reasonCode:
        | 'UNKNOWN_APPLICATION'
        | 'DOMAIN_NOT_ALLOWLISTED'
        | 'INVALID_URL'
        | 'DISPLAY_AMBIGUOUS'
        | 'DISPLAY_NOT_FOUND'
        | 'DISPLAY_TOPOLOGY_UNKNOWN'
        | 'DISPLAY_SELECTOR_MISSING'
        | 'KNOWN_ALIAS_TARGET_OFFLINE'
        | 'UNSUPPORTED_DESKTOP_SCOPE';
      message: string;
      openAllowed?: boolean;
      canPropose?: boolean;
    };

const CLICK_TYPE = /\b(click|type|submit|drag|fill this in|คลิก|พิมพ์|ส่งฟอร์ม)\b/iu;

export function planScopedOpen(
  input: ScopedOpenInput,
  options: {
    applicationIds: readonly string[];
    allowlistedHosts?: readonly string[];
    sessionAllows?: (url: string) => boolean;
  },
): ScopedOpenPlan {
  if (CLICK_TYPE.test(input.resource.label)) {
    return {
      ok: false,
      reasonCode: 'UNSUPPORTED_DESKTOP_SCOPE',
      message: 'That would require CLICK/TYPE/SUBMIT, which is not enabled. I can only open an allowlisted app or site.',
    };
  }
  if (input.resource.kind === 'application') {
    const id = input.resource.applicationId || '';
    if (!options.applicationIds.includes(id)) {
      return {
        ok: false,
        reasonCode: 'UNKNOWN_APPLICATION',
        message: `${input.resource.label || 'That application'} is not on the open allowlist.`,
      };
    }
    return withDisplay({
      ok: true,
      resource: input.resource,
      placement: input.display ? 'requested' : 'none',
      reasonCode: 'ALLOWLISTED_APPLICATION',
    }, input);
  }
  const url = input.resource.url || '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reasonCode: 'INVALID_URL', message: 'That is not a valid URL I can open.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reasonCode: 'INVALID_URL', message: 'Only http(s) URLs can be opened.' };
  }
  const host = urlHost(parsed.href);
  if (!host || !hostAllowed(host, options.allowlistedHosts)) {
    if (options.sessionAllows?.(parsed.href)) {
      return withDisplay({
        ok: true,
        resource: { ...input.resource, url: parsed.href },
        placement: input.display ? 'requested' : 'none',
        reasonCode: 'SESSION_WEB_GRANT',
      }, input);
    }
    return {
      ok: false,
      reasonCode: 'DOMAIN_NOT_ALLOWLISTED',
      message: scopedWebOpenMessage(input.resource.label),
      canPropose: true,
    };
  }
  return withDisplay({
    ok: true,
    resource: { ...input.resource, url: parsed.href },
    placement: input.display ? 'requested' : 'none',
    reasonCode: 'ALLOWLISTED_WEB',
  }, input);
}

function withDisplay(
  plan: Extract<ScopedOpenPlan, { ok: true }>,
  input: ScopedOpenInput,
): ScopedOpenPlan {
  if (!input.display) return plan;
  if (!input.displays) {
    return {
      ok: false,
      reasonCode: 'DISPLAY_TOPOLOGY_UNKNOWN',
      message: 'I can open that, but I cannot verify monitor placement yet.',
      openAllowed: true,
    };
  }
  const resolved = resolveDisplaySelector(input.displays, input.display, input.currentDisplayId);
  if (resolved.ok === false) {
    return {
      ok: false,
      reasonCode: resolved.reasonCode,
      message: resolved.message,
      openAllowed: resolved.reasonCode === 'DISPLAY_TOPOLOGY_UNKNOWN',
    };
  }
  return { ...plan, display: resolved.display };
}

export function scopedWebOpenMessage(label: string, displayRaw?: string, language?: 'th' | 'en'): string {
  const cleaned = (label || 'that site').replace(/\s+(official\s+)?website$/iu, '').trim() || 'that site';
  const site = /^[a-z0-9._-]+$/u.test(cleaned)
    ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
    : cleaned;
  const thai = language === 'th' || /[\u0E00-\u0E7F]/.test(`${label} ${displayRaw || ''}`);
  if (thai) {
    return `ผมพบเว็บทางการของ ${site} แล้ว แต่โดเมนนี้ยังไม่อยู่ใน allowlist ปัจจุบัน ถ้าอนุมัติ ผมเปิดให้ครั้งนี้ได้ครับ`;
  }
  const where = displayRaw ? ' on the requested screen' : '';
  return `I found ${site}'s official site. That domain is not on my current allowlist. I can open it${where} this once if you approve.`;
}

export function structuredBlockExplanation(reasonCode: string, fallback: string): string {
  switch (reasonCode) {
    case 'DOMAIN_NOT_ALLOWLISTED':
      return fallback || scopedWebOpenMessage('that site');
    case 'UNKNOWN_APPLICATION':
      return 'That application is not on the open allowlist.';
    case 'DISPLAY_AMBIGUOUS':
      return fallback;
    case 'DISPLAY_NOT_FOUND':
      return fallback;
    case 'DISPLAY_TOPOLOGY_UNKNOWN':
      return 'I cannot verify the monitor layout, so I will not pretend the window moved.';
    case 'UNSUPPORTED_DESKTOP_SCOPE':
      return 'This action would require broader desktop control (CLICK/TYPE/SUBMIT), which stays locked.';
    default:
      return fallback || 'I cannot do that with the current scoped desktop policy.';
  }
}
