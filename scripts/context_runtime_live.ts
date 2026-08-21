const origin = process.env.JARVIS_LIVE_ORIGIN || 'http://127.0.0.1:3010';
const sessionId = process.env.JARVIS_LIVE_SESSION || 'live-ctx-2026-08-21';

type AskBody = {
  intent?: { kind?: string; capabilityId?: string; detail?: string };
  presented?: { text?: string };
  result?: {
    suggestedContent?: string;
    actionResults?: Array<{ status?: string; summary?: string; errorCode?: string; capabilityId?: string }>;
  };
  pendingConfirmation?: {
    capabilityId?: string;
    proposalId?: string;
    token?: string;
    reason?: string;
    target?: string;
  };
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
  if (!response.ok) {
    throw new Error(`ask ${response.status} for ${text}`);
  }
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

function summarize(label: string, body: AskBody) {
  const action = body.result?.actionResults?.[0];
  return {
    label,
    kind: body.intent?.kind ?? null,
    capability: body.intent?.capabilityId ?? null,
    detail: body.intent?.detail ?? null,
    spoken: String(body.presented?.text || body.result?.suggestedContent || '').slice(0, 420),
    pending: body.pendingConfirmation?.capabilityId ?? null,
    pendingTarget: body.pendingConfirmation?.target ?? null,
    actionStatus: action?.status ?? null,
    actionSummary: action?.summary ?? null,
    errorCode: action?.errorCode ?? null,
  };
}

async function main() {
  const page = await fetch(`${origin}/jarvis`);
  const rows: unknown[] = [{ label: 'GET /jarvis', status: page.status, origin, sessionId }];
  const phrases = process.argv.slice(2);
  if (!phrases.length) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const text of phrases) {
    if (text === '--confirm-last') continue;
    const asked = await ask(text);
    rows.push(summarize(text, asked));
    if (asked.pendingConfirmation?.proposalId && asked.pendingConfirmation.token && phrases.includes('--confirm-last')) {
      rows.push(summarize(`confirm:${text}`, await confirm(asked.pendingConfirmation)));
    }
  }
  console.log(JSON.stringify(rows, null, 2));
}

void main();
