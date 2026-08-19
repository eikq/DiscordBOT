const headers = {
  Origin: 'http://127.0.0.1:3010',
  'Content-Type': 'application/json',
};

type Source = {
  domain: string;
  sourceClass: string;
  status: string;
  publishedAt?: string | null;
  fetchedAt?: string | null;
  title?: string;
};

async function ask(label: string, body: Record<string, unknown>) {
  const started = Date.now();
  const reply = await fetch('http://127.0.0.1:3010/api/jarvis/ask', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId: 'jf013-lab-live', oneTurn: true, speak: false, ...body }),
  });
  const ms = Date.now() - started;
  const json = await reply.json() as {
    presented?: { text?: string };
    result?: {
      suggestedContent?: string;
      actionResults?: Array<{ reasonCode?: string; status?: string }>;
      verifiedFacts?: Array<{ immutableForPresentation?: boolean; key?: string; label?: string; text?: string }>;
    };
    research?: {
      attached?: boolean;
      healthy?: boolean;
      last?: {
        cached?: boolean;
        query?: string;
        stages?: unknown[];
        sources?: Source[];
        evidence?: unknown[];
        citations?: unknown[];
        disagreements?: unknown[];
        uncertainty?: string[];
      };
    };
    error?: string;
    reasonCode?: string;
  };
  const last = json.research?.last;
  const sources = (last?.sources ?? []).map((source) => ({
    domain: source.domain,
    class: source.sourceClass,
    status: source.status,
    publishedAt: source.publishedAt ?? null,
    fetchedAt: source.fetchedAt ?? null,
    title: (source.title || '').slice(0, 80),
  }));
  const summary = {
    label,
    http: reply.status,
    ms,
    error: json.error,
    reasonCode: json.reasonCode,
    answer: String(json.presented?.text || json.result?.suggestedContent || '').slice(0, 320),
    action: json.result?.actionResults?.[0]?.reasonCode || json.result?.actionResults?.[0]?.status || null,
    attached: json.research?.attached,
    healthy: json.research?.healthy,
    cached: last?.cached ?? null,
    query: last?.query ?? null,
    stages: last?.stages ?? [],
    sourceCount: sources.length,
    evidenceCount: last?.evidence?.length ?? 0,
    citations: last?.citations?.length ?? 0,
    disagreements: last?.disagreements?.length ?? 0,
    uncertainty: last?.uncertainty ?? [],
    sources,
    immutableFacts: (json.result?.verifiedFacts || [])
      .filter((fact) => fact.immutableForPresentation)
      .map((fact) => fact.key || fact.label || fact.text?.slice(0, 80)),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n---\n`);
  return summary;
}

async function snap() {
  const reply = await fetch('http://127.0.0.1:3010/api/jarvis/research');
  const json = await reply.json() as {
    attached?: boolean;
    healthy?: boolean;
    reason?: string;
    last?: { query?: string; sources?: Source[]; stages?: unknown[] };
  };
  process.stdout.write(`${JSON.stringify({
    label: 'SNAPSHOT',
    attached: json.attached,
    healthy: json.healthy,
    reason: json.reason,
    lastQuery: json.last?.query,
    lastSources: (json.last?.sources ?? []).map((source) => source.domain),
    stages: json.last?.stages,
  }, null, 2)}\n---\n`);
}

async function main() {
  await snap();
  await ask('A_CURRENT', { text: 'Jarvis วันนี้มีข่าวอะไรเกี่ยวกับ RTX 5090' });
  await ask('C_COMPARE', { text: 'เทียบข้อมูลจากหลายแหล่ง' });
  await ask('D_FRESHNESS', { text: 'ข้อมูลนี้ล่าสุดเมื่อไร' });
  await ask('B_OFFICIAL', { text: 'หาเฉพาะแหล่งข้อมูลทางการ RTX 5090' });
  await ask('E_PDF', {
    text: 'fetch unsupported',
    capabilityCalls: [{
      id: 'research.fetchSource',
      input: { url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' },
    }],
  });
  await ask('F_LOCALHOST', {
    text: 'fetch localhost',
    capabilityCalls: [{
      id: 'research.fetchSource',
      input: { url: 'http://127.0.0.1:3010' },
    }],
  });
  await ask('HELLO', { text: 'สวัสดีครับ' });
  await snap();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
