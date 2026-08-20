/**
 * Jarvis may notice and suggest. It must not automatically take dangerous action.
 * Example: "GPU load has remained unusually high" → notify/suggest.
 * Not: kill processes, physical auto-act, or self-approve.
 */
export const PROACTIVE_NOTICE_POLICY = {
  mayNotify: true,
  maySuggest: true,
  mayAutoAct: false,
  mayKillProcesses: false,
  physicalAutoAct: false,
} as const;

export type ProactiveNotice = {
  summary: string;
  notify: boolean;
  suggest: boolean;
  autoAct: false;
  killProcesses: false;
  physicalAct: false;
};

export function evaluateProactiveNotice(summary: string): ProactiveNotice {
  return {
    summary,
    notify: true,
    suggest: true,
    autoAct: false,
    killProcesses: false,
    physicalAct: false,
  };
}

export function gpuHighLoadNotice(): ProactiveNotice {
  return evaluateProactiveNotice('GPU load has remained unusually high');
}
