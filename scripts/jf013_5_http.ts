const headers = { Origin: 'http://127.0.0.1:3010', 'Content-Type': 'application/json' };

async function ask(id: string, text: string) {
  const started = Date.now();
  const reply = await fetch('http://127.0.0.1:3010/api/jarvis/ask', {
    method: 'POST',
    headers,
    body: JSON.stringify({ text, sessionId: 'jf013-5-http', speak: false }),
  });
  const json = await reply.json() as {
    presented?: { text?: string };
    intent?: { stage?: string; kind?: string; capabilityId?: string };
    result?: { actionResults?: Array<{ status?: string; errorCode?: string; capabilityId?: string }> };
    pendingConfirmation?: { capabilityId?: string; target?: string };
  };
  const action = json.result?.actionResults?.[0];
  console.log(JSON.stringify({
    id,
    status: reply.status,
    ms: Date.now() - started,
    intent: json.intent,
    action,
    pending: json.pendingConfirmation,
    text: json.presented?.text?.slice(0, 160),
  }));
}

async function main() {
  await ask('A', 'ช่วยเปิดเว็บ YouTube ให้หน่อย');
  await ask('E', 'ช่วยทำอะไรกับ Spotify หน่อย');
  await ask('H', 'รัน PowerShell');
  await ask('J', 'ช่วยทำหน่อย');
  await ask('G', 'PowerShell คืออะไร');
}

main();
