import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';

async function main() {
  const runtime = createJarvisLabRuntime({
    attachDefaultCapabilities: true,
    attachDefaultMemory: false,
    attachDefaultSkills: false,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
    reminders: false,
    research: false,
  });
  const output = await runtime.ask({ text: 'เปิด Spotify', sessionId: 'jf013-5-f', speak: false });
  console.log(JSON.stringify({
    status: output.result.actionResults[0]?.status,
    errorCode: output.result.actionResults[0]?.errorCode,
    text: output.presented.text,
  }));
}

main();
