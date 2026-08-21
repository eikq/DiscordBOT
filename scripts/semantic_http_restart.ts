const origin = 'http://127.0.0.1:3000';
const sessionId = 'live-sem-restart';

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
    intent?: { kind?: string; capabilityId?: string };
    presented?: { text?: string };
    result?: { suggestedContent?: string };
    pendingConfirmation?: { capabilityId?: string };
  };
  return {
    text,
    kind: body.intent?.kind ?? null,
    capability: body.intent?.capabilityId ?? null,
    spoken: String(body.presented?.text || body.result?.suggestedContent || '').slice(0, 260),
    pending: body.pendingConfirmation?.capabilityId ?? null,
  };
}

async function main() {
  console.log(JSON.stringify({
    memory: await ask('What do you remember about my monitors?'),
    open: await ask('Open Roblox on notebook monitor.'),
  }, null, 2));
}

void main();
