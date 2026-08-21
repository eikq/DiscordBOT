const origin = process.env.JARVIS_LIVE_ORIGIN || 'http://127.0.0.1:3010';
const sessionId = process.env.JARVIS_LIVE_SESSION || 'live-ctx-hk-2026-08-22';

async function ask(text: string) {
  const response = await fetch(`${origin}/api/jarvis/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      text,
      sessionId,
      speak: false,
      actionSource: 'text',
      personaProfileId: 'jarvis',
      voiceProfileId: 'jarvis',
    }),
  });
  return response.json() as Promise<Record<string, any>>;
}

async function confirm(pending: { proposalId: string; token: string }) {
  const response = await fetch(`${origin}/api/jarvis/actions/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      proposalId: pending.proposalId,
      token: pending.token,
      sessionId,
      speak: false,
      actionSource: 'ui',
    }),
  });
  return { http: response.status, body: await response.json() as Record<string, any> };
}

function brief(label: string, body: Record<string, any>) {
  const action = body.result?.actionResults?.[0];
  return {
    label,
    kind: body.intent?.kind ?? null,
    capability: body.intent?.capabilityId ?? null,
    spoken: String(body.presented?.text || body.result?.suggestedContent || '').slice(0, 500),
    pending: body.pendingConfirmation?.capabilityId ?? null,
    status: action?.status ?? null,
    summary: action?.summary ?? null,
    error: action?.errorCode ?? null,
  };
}

async function main() {
  const rows: unknown[] = [];
  const research = await ask('Research the latest Qwen documentation.');
  rows.push(brief('H-research', research));
  const official = await ask('Which source is official?');
  rows.push(brief('I-official', official));
  const openSource = await ask('Open that source.');
  rows.push(brief('J-open-source', openSource));
  if (openSource.pendingConfirmation?.proposalId && openSource.pendingConfirmation.token) {
    const confirmed = await confirm(openSource.pendingConfirmation);
    rows.push({ http: confirmed.http, ...brief('J-confirm', confirmed.body) });
  }
  const named = await ask('Open the qwencloud source.');
  rows.push(brief('J-named-source', named));
  if (named.pendingConfirmation?.proposalId && named.pendingConfirmation.token) {
    const confirmedNamed = await confirm(named.pendingConfirmation);
    rows.push({ http: confirmedNamed.http, ...brief('J-named-confirm', confirmedNamed.body) });
  }
  const remember = await ask('We are working on the Jarvis project.');
  rows.push(brief('K-remember', remember));
  const openProject = await ask('Open the project in Cursor.');
  rows.push(brief('K-open', openProject));
  console.log(JSON.stringify(rows, null, 2));
}

void main();
