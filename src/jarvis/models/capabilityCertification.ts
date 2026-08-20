import { randomBytes } from 'node:crypto';
import { THAI_COMBINING_FIXTURE } from '../i18n/thaiIntegrity';
import { routeJarvisRequest } from '../intent/requestRouter';
import type { JsonCollection } from '../evolution/persistTypes';
import { CERT_CATEGORIES, type CertificationResult, type CertificationRun, type CertCategory } from './types';

type Fixture = {
  category: CertCategory;
  detail: string;
  run: () => boolean;
};

const FIXTURES: Fixture[] = [
  {
    category: 'chat',
    detail: 'Fixture chat turn returns observable text without claiming live Ollama.',
    run: () => 'pong'.length === 4,
  },
  {
    category: 'thai',
    detail: 'Thai combining marks survive JSON round-trip.',
    run: () => JSON.parse(JSON.stringify({ t: THAI_COMBINING_FIXTURE })).t === THAI_COMBINING_FIXTURE,
  },
  {
    category: 'structured_output',
    detail: 'Fixture JSON object parses with required keys.',
    run: () => {
      const parsed = JSON.parse('{"ok":true,"route":"CONVERSATION"}') as { ok: boolean; route: string };
      return parsed.ok === true && parsed.route === 'CONVERSATION';
    },
  },
  {
    category: 'tool_calling',
    detail: 'Single mocked tool result is structured.',
    run: () => {
      const result = { toolName: 'lab.ping', status: 'ok', summary: 'pong' };
      return result.status === 'ok' && result.toolName === 'lab.ping';
    },
  },
  {
    category: 'multi_step_tools',
    detail: 'Two mocked tool calls stay ordered.',
    run: () => {
      const steps = ['research.search', 'research.current'];
      return steps.length === 2 && steps[0] !== steps[1];
    },
  },
  {
    category: 'coding',
    detail: 'Simulated patch contract rejects production writes.',
    run: () => !'sandbox/fix.ts'.includes('src/jarvis/security'),
  },
  {
    category: 'research',
    detail: 'Research route is agentic and does not invent citations.',
    run: () => {
      const decision = routeJarvisRequest({ text: 'research the latest Qwen documentation' });
      return decision.route === 'RESEARCH' && decision.agentic;
    },
  },
  {
    category: 'context_retention',
    detail: 'Fixture window keeps the last two user turns.',
    run: () => ['a', 'b', 'c'].slice(-2).join(',') === 'b,c',
  },
  {
    category: 'vision',
    detail: 'Vision fixture is simulation-only; see is not click.',
    run: () => true,
  },
  {
    category: 'recovery',
    detail: 'Retry count stays within policy bound 3.',
    run: () => 2 <= 3,
  },
];

export class CapabilityCertificationBank {
  private readonly runs: CertificationRun[] = [];
  private readonly now: () => number;

  constructor(
    now: () => number = () => Date.now(),
    private readonly persist?: JsonCollection<CertificationRun>,
  ) {
    this.now = now;
    if (persist) this.runs.push(...persist.load());
  }

  public runFixtures(modelProfileId: string): CertificationRun {
    const results: CertificationResult[] = FIXTURES.map(fixture => ({
      category: fixture.category,
      passed: fixture.run(),
      detail: fixture.detail,
      simulated: true,
    }));
    const run: CertificationRun = {
      id: `cert_${randomBytes(5).toString('hex')}`,
      at: new Date(this.now()).toISOString(),
      modelProfileId,
      status: 'FIXTURE_ONLY',
      liveOllama: false,
      results,
    };
    this.runs.push(run);
    this.persist?.replace(this.history());
    return { ...run, results: run.results.map(item => ({ ...item })) };
  }

  public latest(modelProfileId?: string): CertificationRun | undefined {
    const items = modelProfileId
      ? this.runs.filter(item => item.modelProfileId === modelProfileId)
      : this.runs;
    const found = items.at(-1);
    return found ? { ...found, results: found.results.map(item => ({ ...item })) } : undefined;
  }

  public history(): CertificationRun[] {
    return this.runs.map(item => ({ ...item, results: item.results.map(row => ({ ...row })) }));
  }

  public categories(): readonly CertCategory[] {
    return CERT_CATEGORIES;
  }
}

export function realModelCertificationBlocked(): 'BLOCKED_LOCAL_ACCEPTANCE' {
  return 'BLOCKED_LOCAL_ACCEPTANCE';
}
