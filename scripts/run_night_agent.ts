import path from 'node:path';
import { CodingWorkerRouter } from '../src/agent/coding/CodingWorkerRouter';
import { preflightCursorCli } from '../src/agent/coding/cursorPreflight';
import { loadContextFiles, NightOrchestrator } from '../src/agent/night/NightOrchestrator';
import { loadNightConfig, loadNightTasks } from '../src/agent/night/loadConfig';
import { NightWorkspace } from '../src/agent/night/NightWorkspace';

const cwd = process.cwd();
const { config, path: configPath } = loadNightConfig(cwd);
const cursor = config.workerProviders.find((item) => item.kind === 'cursor-cli' && item.enabled);
const grokOnly = !config.localQwenFallback && !config.codexFallback;

if (cursor && (config.stopOnProviderFailure || grokOnly)) {
  const requested = (config.cursorModel || cursor.model || '').trim();
  if (grokOnly && requested !== 'cursor-grok-4.6-xhigh-fast') {
    console.error('NOT READY — Grok-only tonight requires exact model cursor-grok-4.6-xhigh-fast.');
    console.error('Do not use Auto. Do not use cursor-grok-4.6-high-fast.');
    process.exit(2);
  }
  const preflight = preflightCursorCli({ requestedModel: requested });
  console.log('Night Agent Cursor preflight');
  console.log('executable: ' + (preflight.executable || 'MISSING'));
  console.log('version:    ' + (preflight.version || 'unknown'));
  console.log('auth:       ' + (preflight.authenticated ? 'YES' : 'NO'));
  console.log('model:      ' + (preflight.modelId || requested || 'UNRESOLVED'));
  console.log('available:  ' + (preflight.availableModels.join(', ') || '(none listed)'));
  if (!preflight.ok) {
    console.error('');
    console.error('NOT READY — Cursor/Grok provider is not startable.');
    for (const blocker of preflight.blockers) console.error('  ' + blocker);
    console.error('Do not start Local Qwen. Do not guess a model id.');
    process.exit(2);
  }
}

const { tasks, path: tasksPath } = loadNightTasks(config, cwd);
if (tasks.length === 0) {
  console.error('No tasks in ' + tasksPath + '. Run npm run agent:night:prepare and add NIGHT_SAFE tasks.');
  process.exit(1);
}

const workspace = NightWorkspace.fromConfig(config, cwd);
if (config.workspaceMode === 'isolated-worktree') {
  const controller = path.resolve(config.controllerRoot || cwd);
  if (path.resolve(workspace.root) === controller) {
    console.error('NOT READY — isolated-worktree mode cannot target the controller repo.');
    console.error('Set workspaceRoot to the night worktree path.');
    process.exit(2);
  }
}

console.log('Night Agent run');
console.log('config:    ' + configPath);
console.log('tasks:     ' + tasksPath);
console.log('workspace: ' + workspace.root);
console.log('mode:      ' + config.workspaceMode);
console.log('provider:  ' + (cursor ? 'cursor-cli' : config.workerProviders.map((item) => item.kind).join(',')));
console.log('model:     ' + (config.cursorModel || cursor?.model || '(none)'));
console.log('fallback:  Qwen ' + (config.localQwenFallback ? 'ON' : 'OFF') + '; Codex OFF');
console.log('stopOnProviderFailure: ' + String(config.stopOnProviderFailure));
if (grokOnly) {
  console.log('GROK-ONLY tonight: Local Qwen will not be started.');
}

const result = await new NightOrchestrator({
  config,
  tasks,
  workspace,
  worker: new CodingWorkerRouter(config),
  contextFiles: loadContextFiles(workspace.root),
}).run();

console.log('status: ' + result.state.status);
if (result.state.refusedReason) console.log('refused: ' + result.state.refusedReason);
if (result.reportPath) console.log('report: ' + result.reportPath);
process.exitCode = result.refused || result.state.status === 'stopped' ? 2 : 0;
