import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { skipLiveCommandsInTests } from '../project/commands';

export const OPENCODE_HARNESS_TIMEOUT_MS = 180_000;

export type OpenCodeHarnessInput = {
  workspaceDir: string;
  brief: string;
  title?: string;
  timeoutMs?: number;
  mcpCommand?: string;
};

export type OpenCodeHarnessResult = {
  status: 'completed' | 'unavailable' | 'failed' | 'skipped';
  binary?: string;
  argv: string[];
  stdoutSummary: string;
  stderrSummary: string;
  wroteConfig: boolean;
  mcpAttached: boolean;
};

export type OpenCodeHarness = {
  run(input: OpenCodeHarnessInput): Promise<OpenCodeHarnessResult>;
};

export function shouldUseOpenCodeHarness(brief: string): boolean {
  return /react|vite|three|3d|motion|framer|slide|deck|สไลด์|พรีเซนต์|cinematic|futuristic|interactive|BUILD_WEBSITE|ProjectWorkspace/iu.test(brief);
}

export function worldIntelMcpCommand(): string | undefined {
  const configured = process.env.WORLD_INTEL_MCP_COMMAND?.trim();
  const command = configured || path.join(
    process.cwd(),
    '.runtime',
    'world-intel-venv',
    process.platform === 'win32' ? 'Scripts/world-intel-mcp.exe' : 'bin/world-intel-mcp',
  );
  return fs.existsSync(command) ? command : undefined;
}

export function writeOpenCodeWorkspaceConfig(workspaceDir: string, mcpCommand?: string): { configPath: string; mcpAttached: boolean } {
  fs.mkdirSync(workspaceDir, { recursive: true });
  const mcpAttached = Boolean(mcpCommand && fs.existsSync(mcpCommand));
  const config = {
    $schema: 'https://opencode.ai/config.json',
    permission: {
      edit: 'allow',
      bash: 'deny',
      webfetch: 'deny',
    },
    ...(mcpAttached ? {
      mcp: {
        'world-intel': {
          type: 'local',
          command: [mcpCommand],
          enabled: true,
        },
      },
    } : {}),
  };
  const configPath = path.join(workspaceDir, 'opencode.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { configPath, mcpAttached };
}

export function resolveOpenCodeBinary(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.JARVIS_OPENCODE_BIN?.trim();
  if (configured && fs.existsSync(configured)) return configured;
  const candidates = process.platform === 'win32'
    ? ['opencode.cmd', 'opencode.exe', 'opencode']
    : ['opencode'];
  const directories = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  for (const name of candidates) {
    for (const directory of directories) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export function createOpenCodeHarness(options: {
  spawnImpl?: typeof spawn;
  resolveBinary?: () => string | undefined;
  skipLive?: boolean;
} = {}): OpenCodeHarness {
  return {
    async run(input) {
      if (options.skipLive ?? skipLiveCommandsInTests()) {
        return {
          status: 'skipped',
          argv: [],
          stdoutSummary: 'OpenCode skipped in unit tests.',
          stderrSummary: '',
          wroteConfig: false,
          mcpAttached: false,
        };
      }
      const binary = (options.resolveBinary ?? resolveOpenCodeBinary)();
      if (!binary) {
        return {
          status: 'unavailable',
          argv: [],
          stdoutSummary: '',
          stderrSummary: 'OpenCode CLI is not installed on PATH.',
          wroteConfig: false,
          mcpAttached: false,
        };
      }
      const mcpCommand = input.mcpCommand ?? worldIntelMcpCommand();
      const written = writeOpenCodeWorkspaceConfig(input.workspaceDir, mcpCommand);
      const prompt = [
        'You are building a real owner project inside this workspace only.',
        'Do not leave the workspace directory.',
        'Do not run unrestricted shell. File edits only.',
        'Stack: React + Vite unless the brief names another stack.',
        'If this is a 7-slide JARVIS capability deck, write a Thai-first cinematic React slide deck with motion and a 3D interactive feeling.',
        'Keep copy easy to read in Thai.',
        `Title: ${input.title || 'Jarvis project'}`,
        'Owner brief:',
        input.brief,
      ].join('\n');
      const argv = ['run', '--dir', input.workspaceDir, '--format', 'json', prompt];
      try {
        const spawned = await runOpenCode(options.spawnImpl ?? spawn, binary, argv, input.workspaceDir, input.timeoutMs ?? OPENCODE_HARNESS_TIMEOUT_MS);
        return {
          status: spawned.exitCode === 0 ? 'completed' : 'failed',
          binary,
          argv: [binary, ...argv],
          stdoutSummary: spawned.stdout.slice(0, 4_000),
          stderrSummary: spawned.stderr.slice(0, 4_000),
          wroteConfig: true,
          mcpAttached: written.mcpAttached,
        };
      } catch (error) {
        return {
          status: 'failed',
          binary,
          argv: [binary, ...argv],
          stdoutSummary: '',
          stderrSummary: error instanceof Error ? error.message : String(error),
          wroteConfig: true,
          mcpAttached: written.mcpAttached,
        };
      }
    },
  };
}

function runOpenCode(
  spawnImpl: typeof spawn,
  binary: string,
  argv: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(binary, argv, {
      cwd,
      env: {
        ...process.env,
        OPENCODE_PERMISSION: JSON.stringify({ edit: 'allow', bash: 'deny', webfetch: 'deny' }),
      },
      windowsHide: true,
      shell: process.platform === 'win32' && /\.cmd$/i.test(binary),
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`OpenCode timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', exitCode => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}
