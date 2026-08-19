export const UNRESOLVED_CURSOR_MODEL = 'RESOLVE_WITH_AGENT_LIST_MODELS';

export type CursorArgvInput = {
  model: string;
  workspace: string;
  prompt: string;
  useForce: boolean;
  sandbox?: 'enabled' | 'disabled';
};

const FORBIDDEN_FLAGS = ['--resume', '--continue', '--yolo'];

export function buildCursorAgentArgv(input: CursorArgvInput): string[] {
  const model = input.model.trim();
  if (!model || model === UNRESOLVED_CURSOR_MODEL) {
    throw new Error('Cursor model id is unresolved. Run agent models and set the exact id.');
  }
  if (!input.workspace.trim()) throw new Error('Cursor --workspace is required.');
  if (!input.prompt.trim()) throw new Error('Cursor task prompt is required.');
  const sandbox = input.sandbox
    || (process.platform === 'win32' ? 'disabled' : 'enabled');
  const argv = [
    '--print',
    '--sandbox',
    sandbox,
    '--workspace',
    input.workspace,
    '--model',
    model,
    '--output-format',
    'stream-json',
  ];
  if (input.useForce) {
    argv.push('--force');
    argv.push('--trust');
  }
  argv.push(input.prompt);
  const joined = argv.join(' ');
  for (const flag of FORBIDDEN_FLAGS) {
    if (argv.includes(flag) || joined.includes(flag)) {
      throw new Error('Forbidden Cursor flag: ' + flag);
    }
  }
  return argv;
}

export function cursorArgvIsSafe(argv: string[]): boolean {
  return FORBIDDEN_FLAGS.every((flag) => !argv.includes(flag));
}

export function buildCursorTaskPrompt(input: {
  taskId: string;
  title: string;
  goal: string;
  scope: string[];
  acceptance: string[];
  previousErrors: string[];
  projectNotes?: string;
}): string {
  return [
    'You are a bounded PATCH WORKER for one NIGHT_SAFE task.',
    'NIGHT_SAFE: true',
    'Task: ' + input.taskId + ' — ' + input.title,
    'Goal: ' + input.goal,
    'Allowed file scope: ' + input.scope.join(', '),
    'Acceptance (run by NightToolHost, not you): ' + input.acceptance.join(' ; '),
    'You may read/edit allowed source, tests, and docs only.',
    'Shell, Git, package install, network, WebFetch, and MCP are unavailable.',
    'Do not decide PASS or pick the next task.',
    input.projectNotes || '',
    input.previousErrors.length ? 'Previous acceptance failure:\n' + input.previousErrors[input.previousErrors.length - 1] : '',
  ].filter(Boolean).join('\n');
}
