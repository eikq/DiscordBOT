import type { RESEARCH_DEPTHS } from './constants';

export type ResearchDepth = typeof RESEARCH_DEPTHS[number];

export type PrivateRouteComponent = 'up' | 'missing' | 'down' | 'unknown';

export type PrivateRouteHealth = {
  virtualBox: PrivateRouteComponent;
  gateway: PrivateRouteComponent;
  workstation: PrivateRouteComponent;
  tor: PrivateRouteComponent;
  isolationOk: boolean;
  available: boolean;
  reasonCode: string;
  detail: string;
};

export type BrowserLaunchOptions = {
  channel?: string;
  userDataDir?: string;
  persistent?: boolean;
  executablePath?: string;
};

export type PrivateBrowseRequest = {
  url?: string;
  query?: string;
  depth?: ResearchDepth;
};

export type PrivateBrowseResult = {
  status: 'ok' | 'unavailable' | 'denied';
  reasonCode: string;
  userMessage: string;
  available: false | true;
  usedOwnerBrowser: false;
  usedHostPlaywrightFallback: false;
  evidence?: string;
};

export type BrowserActionDecision =
  | { ok: true; action: string }
  | { ok: false; reasonCode: string; userMessage: string };

export type UntrustedWebInterpretation = {
  kind: 'untrusted_data';
  text: string;
  injectionSignals: string[];
  capabilityRequests: [];
  privilegeRequests: [];
  filesystemRequests: [];
  ignoredAsInstruction: true;
};
