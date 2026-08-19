import { PrivateResearchGateway } from '../src/jarvis/research/private/privateGateway';

async function main(): Promise<void> {
  const health = await new PrivateResearchGateway().healthCheck();
  console.log(JSON.stringify(health, null, 2));
  process.exitCode = health.available ? 0 : 2;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
