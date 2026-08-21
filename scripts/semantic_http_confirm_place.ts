const origin = 'http://127.0.0.1:3000';
const sessionId = 'live-sem-place';

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
  return response.json() as Promise<{
    intent?: { kind?: string; capabilityId?: string; detail?: string };
    presented?: { text?: string };
    result?: { suggestedContent?: string; actionResults?: Array<{ status?: string; summary?: string; errorCode?: string }> };
    pendingConfirmation?: { capabilityId?: string; proposalId?: string; token?: string; reason?: string };
  }>;
}

function summarize(label: string, body: Awaited<ReturnType<typeof ask>>) {
  const action = body.result?.actionResults?.[0];
  return {
    label,
    kind: body.intent?.kind ?? null,
    capability: body.intent?.capabilityId ?? null,
    spoken: String(body.presented?.text || body.result?.suggestedContent || '').slice(0, 280),
    pending: body.pendingConfirmation?.capabilityId ?? null,
    actionStatus: action?.status ?? null,
    actionSummary: action?.summary ?? null,
    errorCode: action?.errorCode ?? null,
  };
}

async function main() {
  const opened = await ask('open roblox website in notebook monitor');
  const rows = [summarize('open', opened)];
  if (opened.pendingConfirmation?.proposalId && opened.pendingConfirmation.token) {
    const confirmed = await fetch(`${origin}/api/jarvis/actions/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        proposalId: opened.pendingConfirmation.proposalId,
        token: opened.pendingConfirmation.token,
        sessionId,
        speak: false,
        actionSource: 'ui',
      }),
    });
    const body = await confirmed.json() as Awaited<ReturnType<typeof ask>>;
    rows.push(summarize('confirm-open', body));
  }
  rows.push(summarize('move', await ask('Move it to the right monitor.')));
  rows.push(summarize('back', await ask('Bring it back.')));
  console.log(JSON.stringify(rows, null, 2));
}

void main();
