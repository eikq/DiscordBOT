const sessionId = 'live-sem-presence';
const origin = 'http://127.0.0.1:3000';

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
  const body = await response.json() as {
    intent?: { kind?: string; detail?: string; capabilityId?: string };
    presented?: { text?: string };
    result?: { suggestedContent?: string };
    pendingConfirmation?: {
      capabilityId?: string;
      target?: string;
      proposalId?: string;
      token?: string;
      reason?: string;
    };
  };
  return {
    label: text,
    status: response.status,
    text,
    kind: body.intent?.kind ?? null,
    detail: body.intent?.detail ?? null,
    capability: body.intent?.capabilityId ?? null,
    spoken: String(body.presented?.text || body.result?.suggestedContent || '').slice(0, 260),
    pending: body.pendingConfirmation?.capabilityId ?? null,
    pendingTarget: body.pendingConfirmation?.target ?? null,
    token: body.pendingConfirmation?.token ? 'yes' : 'no',
    reason: body.pendingConfirmation?.reason ?? null,
  };
}

async function main() {
  const page = await fetch(`${origin}/jarvis`);
  const rows = [{ label: 'GET /jarvis', status: page.status }];
  for (const text of [
    'open roblox website in notebook monitor',
    'Move it to the right monitor.',
    'Bring it back.',
    'What do you remember about my monitors?',
    'When I say notebook monitor, I mean the built-in laptop display.',
    'What do you remember about my monitors?',
    'Jarvis เปิด Roblox website บน laptop display',
    'Search Roblox and click the first game',
  ]) {
    rows.push(await ask(text));
  }
  console.log(JSON.stringify(rows, null, 2));
}

void main();
