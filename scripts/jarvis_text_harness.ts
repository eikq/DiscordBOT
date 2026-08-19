import { runStandaloneTextTurn } from '../src/jarvis/standalone/textHarness';

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

function readText(args: string[]): string {
  const positional = args.filter((arg, index) => {
    if (arg.startsWith('--')) return false;
    if (index > 0 && args[index - 1]?.startsWith('--')) return false;
    return true;
  });
  return positional.join(' ').trim();
}

async function main() {
  const args = process.argv.slice(2);
  const text = readText(args);
  if (!text) {
    console.error('Usage: npm run jarvis:ask -- <text> [--persona id] [--voice id]');
    process.exitCode = 1;
    return;
  }

  const output = await runStandaloneTextTurn({
    text,
    personaProfileId: readFlag(args, '--persona'),
    voiceProfileId: readFlag(args, '--voice'),
  });

  process.stdout.write(`${JSON.stringify({
    requestId: output.request.requestId,
    source: output.request.source,
    answerIntent: output.result.answerIntent,
    suggestedContent: output.result.suggestedContent,
    presentedText: output.presented.text,
    personaProfileId: output.presented.personaProfileId,
    voiceProfileId: output.presented.voiceProfileId,
    toolResults: output.result.toolResults,
    memoryRefs: output.result.memoryRefs,
    uncertainty: output.result.uncertainty,
  }, null, 2)}\n`);
}

void main();
