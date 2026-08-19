import fs from 'node:fs';
import path from 'node:path';
import { loadNightConfig } from '../src/agent/night/loadConfig';
import { isDenied } from '../src/agent/night/types';
import { NightStateStore } from '../src/agent/night/NightStateStore';
import { NightWorkspace } from '../src/agent/night/NightWorkspace';
import { prepareIsolatedWorktree } from '../src/agent/night/worktreePrepare';

const cwd = process.cwd();
const args = process.argv.slice(2);
const createWorktree = args.includes('--create-worktree');
const acknowledgeHeadOnly = args.includes('--acknowledge-head-only');
const nameIndex = args.indexOf('--name');
const worktreeName = nameIndex >= 0 ? String(args[nameIndex + 1] || '').trim() : '';

if (createWorktree && !worktreeName) {
  console.error('Night Agent prepare');
  console.error('Missing --name. Example:');
  console.error('  npm run agent:night:prepare -- --create-worktree --name night-2026-08-19');
  console.error('If the primary repo is dirty and tonight does not need those files, add --acknowledge-head-only.');
  process.exit(2);
}

if (createWorktree) {
  const prepared = prepareIsolatedWorktree({
    controllerRoot: cwd,
    name: worktreeName,
    acknowledgeHeadOnly,
  });
  console.log('Night Agent prepare — isolated worktree');
  console.log('controller:     ' + cwd);
  console.log('worktree path:  ' + (prepared.path || '(not created)'));
  console.log('base commit:    ' + (prepared.baseCommit || 'unknown'));
  console.log('created:        ' + (prepared.created ? 'YES' : 'NO (existing left intact)'));
  console.log('target clean:   ' + (prepared.targetClean ? 'YES' : 'NO'));
  console.log('dirty primary changes are NOT in this worktree. Do not auto-commit the primary repo.');
  for (const note of prepared.notes) console.log('note: ' + note);
  if (!prepared.ok) {
    console.log('');
    console.log('NOT ELIGIBLE');
    for (const blocker of prepared.blockers) console.log('  ' + blocker);
    process.exitCode = 2;
    process.exit();
  }
  const { config, path: configPath } = loadNightConfig(cwd);
  const workspace = new NightWorkspace(prepared.path!);
  const store = new NightStateStore(workspace.root);
  store.ensureLayout();
  seedTasks(store, cwd);
  const inspection = workspace.inspect();
  const safety = workspace.assertSafeForUnattended({
    ...config,
    workspaceRoot: prepared.path,
    workspaceMode: 'isolated-worktree',
    allowDirtyWorkspace: false,
  });
  printCommon(configPath, workspace.root, inspection, 'isolated-worktree');
  console.log('cli policy:  ' + path.join(workspace.root, '.cursor', 'cli.json'));
  console.log('hint: copy night-agent.grok-only.example.json to night-agent.config.json');
  console.log('hint: set workspaceRoot to the worktree path and cursorModel to the exact agent models id');
  if (isDenied(safety)) {
    console.log('');
    console.log('REFUSED for unattended coding:');
    console.log('  ' + safety.reason);
    process.exitCode = 2;
  } else {
    console.log('');
    console.log('ELIGIBLE. Target is clean. Next: set night-agent.config.json then npm run agent:night');
  }
  process.exit();
}

const { config, path: configPath } = loadNightConfig(cwd);
const workspace = NightWorkspace.fromConfig(config, cwd);
const store = new NightStateStore(workspace.root);
store.ensureLayout();
seedTasks(store, cwd);

const inspection = workspace.inspect();
const safety = workspace.assertSafeForUnattended(config);
printCommon(configPath, workspace.root, inspection, config.workspaceMode);
if (isDenied(safety)) {
  console.log('');
  console.log('REFUSED for unattended coding:');
  console.log('  ' + safety.reason);
  console.log('Fix: npm run agent:night:prepare -- --create-worktree --name night-2026-08-19');
  console.log('Do not let the night worker mix with active Cursor edits.');
  process.exitCode = 2;
} else {
  console.log('');
  console.log('Workspace is eligible. Next: npm run agent:night');
}

function seedTasks(store: NightStateStore, controller: string): void {
  const exampleTasks = path.join(controller, '.runtime', 'addenda', 'jarvis-night-autonomous-coding', 'templates', 'NIGHT_TASK.example.json');
  if (!fs.existsSync(store.tasksPath)) {
    const seed = fs.existsSync(exampleTasks)
      ? { version: 1, tasks: [JSON.parse(fs.readFileSync(exampleTasks, 'utf8'))] }
      : { version: 1, tasks: [] };
    store.writeTasksFile(seed);
  }
}

function printCommon(
  configPath: string,
  workspaceRoot: string,
  inspection: { branch?: string; dirty: boolean },
  mode: string,
): void {
  console.log('Night Agent prepare');
  console.log('config:     ' + configPath);
  console.log('workspace:  ' + workspaceRoot);
  console.log('mode:       ' + mode);
  console.log('branch:     ' + (inspection.branch || 'unknown'));
  console.log('dirty:      ' + inspection.dirty);
  console.log('profile:    DEV_NIGHT (Discord/ASR/JaiTTS/RVC should be OFF)');
  console.log('commit:     disabled unless allowGitCommit AND ownerApprovedGitCommit');
  console.log('push:       always denied');
  console.log('worktree:   created only with --create-worktree --name <name> (never auto-deleted)');
  console.log('cloud:      disabled; local escalation packets only');
}
