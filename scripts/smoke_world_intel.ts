import { McpResearchGateway } from '../src/bot/research/McpResearchGateway';

const gateway = new McpResearchGateway();
try {
  const status = await gateway.getStatus();
  if (!status.connected || status.availableTools < 100) {
    throw new Error(`world-intel-mcp is not healthy: ${JSON.stringify(status)}`);
  }
  const result = await gateway.execute({ name: 'intel_status', arguments: {} });
  if (!result.content.includes('untrusted_tool_output')) {
    throw new Error('World intelligence result did not pass through the untrusted-data boundary.');
  }
  console.log(`world-intel-mcp ready: ${status.availableTools} tools, ${status.allowedTools.length} allowed`);
} finally {
  await gateway.close();
}
