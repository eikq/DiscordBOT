import { loadNightConfig, loadNightTasks } from '../src/agent/night/loadConfig';
import { NightStateStore } from '../src/agent/night/NightStateStore';
import { NightWorkspace } from '../src/agent/night/NightWorkspace';

const cwd = process.cwd();
const { config } = loadNightConfig(cwd);
const workspace = NightWorkspace.fromConfig(config, cwd);
const store = new NightStateStore(workspace.root);
const state = store.load();
const { tasks } = loadNightTasks(config, cwd);
const inspect = workspace.inspect();

console.log('Night Agent status');
console.log('workspace: ' + workspace.root);
console.log('branch:    ' + (inspect.branch || 'unknown'));
console.log('dirty:     ' + inspect.dirty);
if (!state) {
  console.log('run:       no state.json yet');
} else {
  console.log('run:       ' + state.runId + ' ' + state.status);
  console.log('started:   ' + state.startedAt);
  console.log('updated:   ' + state.updatedAt);
  for (const record of Object.values(state.tasks)) {
    console.log('- ' + record.taskId + ' ' + record.status + ' attempts=' + record.attempts.length);
  }
}
console.log('queue:');
for (const task of tasks) {
  console.log('- ' + task.id + ' ' + task.status + ' nightSafe=' + task.nightSafe);
}