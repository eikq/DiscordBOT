const origin = process.env.JARVIS_LIVE_ORIGIN || 'http://127.0.0.1:3010';
const sessionId = process.env.JARVIS_LIVE_SESSION || 'live-ctx-f-2026-08-22';

type AskBody = {
  intent?: { kind?: string; capabilityId?: string; detail?: string };
  presented?: { text?: string };
  result?: {
    suggestedContent?: string;
    actionResults?: Array<{
      status?: string;
      summary?: string;
      errorCode?: string;
      capabilityId?: string;
      structured?: Record<string, unknown>;
    }>;
  };
  pendingConfirmation?: {
    capabilityId?: string;
    proposalId?: string;
    token?: string;
    target?: string;
  };
  research?: { last?: { query?: string; sources?: Array<{ url?: string; title?: string }> } };
};

async function ask(text: string): Promise<AskBody> {
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
  if (!response.ok) throw new Error(`ask ${response.status} for ${text}`);
  return response.json() as Promise<AskBody>;
}

async function confirm(pending: NonNullable<AskBody['pendingConfirmation']>): Promise<AskBody> {
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
  return response.json() as Promise<AskBody>;
}

function brief(label: string, body: AskBody) {
  const action = body.result?.actionResults?.[0];
  return {
    label,
    kind: body.intent?.kind ?? null,
    capability: body.intent?.capabilityId ?? action?.capabilityId ?? null,
    spoken: String(body.presented?.text || body.result?.suggestedContent || '').slice(0, 500),
    pending: body.pendingConfirmation?.capabilityId ?? null,
    status: action?.status ?? null,
    summary: action?.summary ?? null,
    error: action?.errorCode ?? null,
    structured: action?.structured ?? null,
    researchQuery: body.research?.last?.query ?? null,
    researchSources: (body.research?.last?.sources ?? []).slice(0, 4).map(item => item.url || item.title),
  };
}

async function main() {
  const flow = (process.env.JARVIS_LIVE_FLOW || 'deg').toLowerCase();
  const rows: unknown[] = [{ origin, sessionId, flow }];
  if (flow === 'containment' || flow === 'all') {
    rows.push(brief('check-it', await ask('Check it.')));
    rows.push(brief('yes', await ask('Yes.')));
  }
  if (flow === 'deg' || flow === 'all') {
    const opened = await ask('Open Roblox website in notebook monitor.');
    rows.push(brief('D-open', opened));
    if (opened.pendingConfirmation?.proposalId && opened.pendingConfirmation.token) {
      rows.push(brief('D-confirm', await confirm(opened.pendingConfirmation)));
    }
    rows.push(brief('E-move', await ask('Move it to the right monitor.')));
    rows.push(brief('F-back', await ask('Bring it back.')));
    rows.push(brief('G-youtube', await ask('Open YouTube there too.')));
  }
  if (flow === 'hk' || flow === 'all') {
    rows.push(brief('H-research', await ask('Research the latest Qwen documentation.')));
    rows.push(brief('I-official', await ask('Which source is official?')));
    const openSource = await ask('Open that source.');
    rows.push(brief('J-open-source', openSource));
    if (openSource.pendingConfirmation?.proposalId && openSource.pendingConfirmation.token) {
      rows.push(brief('J-confirm', await confirm(openSource.pendingConfirmation)));
    }
    rows.push(brief('K-remember', await ask('We are working on the Jarvis project.')));
    rows.push(brief('K-open', await ask('Open the project in Cursor.')));
  }
  console.log(JSON.stringify(rows, null, 2));
}

void main();
