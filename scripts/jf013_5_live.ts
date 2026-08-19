import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';

const sessionId = 'jf013-5-live';

async function run() {
  const runtime = createJarvisLabRuntime({
    attachDefaultCapabilities: true,
    attachDefaultMemory: false,
    attachDefaultSkills: true,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
  });
  const cases: Array<{ id: string; text: string }> = [
    { id: 'A', text: 'ช่วยเปิดเว็บ YouTube ให้หน่อย' },
    { id: 'B', text: 'เช็คราคา RTX 5090 ตอนนี้ให้หน่อย' },
    { id: 'C', text: 'ช่วยดู ASR หน่อย' },
    { id: 'D1', text: 'ASR เป็นไง' },
    { id: 'D2', text: 'รีสตาร์ตมัน' },
    { id: 'E', text: 'ช่วยทำอะไรกับ Spotify หน่อย' },
    { id: 'F', text: 'เปิด Spotify' },
    { id: 'G', text: 'PowerShell คืออะไร' },
    { id: 'H', text: 'รัน PowerShell' },
    { id: 'I', text: 'หาอะไรเกี่ยวกับ NVIDIA ให้หน่อย' },
    { id: 'J', text: 'ช่วยทำหน่อย' },
  ];
  for (const item of cases) {
    const started = Date.now();
    const output = await runtime.ask({ text: item.text, sessionId, speak: false });
    const action = output.result.actionResults[0];
    console.log(JSON.stringify({
      id: item.id,
      ms: Date.now() - started,
      intent: output.intent,
      answerIntent: output.result.answerIntent,
      action: action && {
        capabilityId: action.capabilityId,
        status: action.status,
        errorCode: action.errorCode,
        summary: action.summary?.slice(0, 180),
      },
      pending: output.pendingConfirmation && {
        capabilityId: output.pendingConfirmation.capabilityId,
        target: output.pendingConfirmation.target,
      },
      text: output.presented.text.slice(0, 220),
    }));
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
