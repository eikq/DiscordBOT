import { loadNightConfig } from '../src/agent/night/loadConfig';
import { NightReporter } from '../src/agent/night/NightReporter';
import { NightStateStore } from '../src/agent/night/NightStateStore';
import { NightWorkspace } from '../src/agent/night/NightWorkspace';

const cwd = process.cwd();
const { config } = loadNightConfig(cwd);
const workspace = NightWorkspace.fromConfig(config, cwd);
const store = new NightStateStore(workspace.root);
const state = store.load();
if (!state) {
  console.error('No night state to report. Run npm run agent:night first.');
  process.exit(1);
}
const file = new NightReporter(store).write(state, config);
console.log(file);
console.log(require('node:fs').readFileSync(file, 'utf8'));