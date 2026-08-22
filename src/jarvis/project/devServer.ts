import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { assertInsideWorkspace } from './pathGuard';
import { looksLikeShellMetachar, typedArgv } from './commands';
import type { DevServerHandle, PreviewArtifact } from './types';

const HOST = '127.0.0.1' as const;
const PORT_MIN = 4173;
const PORT_MAX = 4299;

export class DevServerRegistry {
  private readonly handles = new Map<string, DevServerHandle>();
  private readonly processes = new Map<string, ChildProcess>();

  constructor(
    private readonly options: {
      persistPath?: string;
      now?: () => number;
    } = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.load();
    this.reconcileUnknown();
  }

  public list(): DevServerHandle[] {
    return [...this.handles.values()].map(cloneHandle);
  }

  public get(processRef: string): DevServerHandle | undefined {
    const handle = this.handles.get(processRef);
    return handle ? cloneHandle(handle) : undefined;
  }

  public forWorkspace(workspace: string): DevServerHandle | undefined {
    return this.list().find(item => (
      item.workspace === workspace && (item.status === 'running' || item.status === 'starting')
    ));
  }

  public async start(input: {
    workspace: string;
    script?: string;
    port?: number;
  }): Promise<PreviewArtifact> {
    assertInsideWorkspace(input.workspace, input.workspace);
    const script = input.script || 'dev';
    if (looksLikeShellMetachar(script)) {
      throw new Error('Dev server script is not a registered package.json script.');
    }
    const existing = this.forWorkspace(input.workspace);
    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      return toPreview(existing);
    }
    const port = input.port && input.port >= PORT_MIN && input.port <= PORT_MAX
      ? input.port
      : await allocateLocalhostPort();
    const processRef = `dev_${Math.abs(this.now()).toString(16)}_${port}`;
    const handle: DevServerHandle = {
      url: `http://${HOST}:${port}`,
      workspace: input.workspace,
      processRef,
      status: 'starting',
      host: HOST,
      port,
      script,
      startedAt: this.now(),
      commandType: 'npm-run',
    };
    this.handles.set(processRef, handle);
    this.persist();
    const argv = typedArgv({
      kind: 'npm-run',
      workspace: input.workspace,
      script,
      extraArgs: ['--host', HOST, '--port', String(port)],
    });
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: input.workspace,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        windir: process.env.windir,
        PATHEXT: process.env.PATHEXT,
        HOST,
        PORT: String(port),
        BROWSER: 'none',
      },
      shell: false,
      windowsHide: true,
      detached: false,
    });
    handle.pid = child.pid;
    this.processes.set(processRef, child);
    child.on('exit', () => {
      const current = this.handles.get(processRef);
      if (current && current.status !== 'stopped') current.status = 'stopped';
      this.processes.delete(processRef);
      this.persist();
    });
    const ready = await waitForLocalhost(port, 12_000);
    handle.status = ready ? 'running' : (child.exitCode == null ? 'starting' : 'failed');
    this.persist();
    return toPreview(handle);
  }

  public async stop(processRef: string): Promise<PreviewArtifact | undefined> {
    const handle = this.handles.get(processRef);
    if (!handle) return undefined;
    const child = this.processes.get(processRef);
    if (child && handle.pid && child.pid === handle.pid) {
      child.kill();
    }
    handle.status = 'stopped';
    this.processes.delete(processRef);
    this.persist();
    return toPreview(handle);
  }

  public stopWorkspace(workspace: string): Promise<PreviewArtifact | undefined> {
    const handle = this.list().find(item => item.workspace === workspace);
    return handle ? this.stop(handle.processRef) : Promise.resolve(undefined);
  }

  public reconcileUnknown(): void {
    for (const handle of this.handles.values()) {
      if (handle.status === 'stopped' || handle.status === 'failed') continue;
      if (!handle.pid) {
        handle.status = 'unknown';
        continue;
      }
      try {
        process.kill(handle.pid, 0);
      } catch {
        handle.status = 'unknown';
      }
    }
    this.persist();
  }

  private load(): void {
    const file = this.options.persistPath;
    if (!file || !fs.existsSync(file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as DevServerHandle[];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (item?.processRef) this.handles.set(item.processRef, { ...item, status: item.status === 'running' ? 'unknown' : item.status });
      }
    } catch {
      // Fail closed: unknown process table rather than inventing live servers.
    }
  }

  private persist(): void {
    const file = this.options.persistPath;
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(this.list(), null, 2), 'utf8');
  }

  private readonly now: () => number;
}

export async function allocateLocalhostPort(): Promise<number> {
  for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new Error('No localhost preview port is available in the Jarvis range.');
}

function portFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.on('error', () => resolve(false));
    server.listen(port, HOST, () => {
      server.close(() => resolve(true));
    });
  });
}

function waitForLocalhost(port: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  return new Promise(resolve => {
    const attempt = () => {
      const socket = net.connect({ host: HOST, port });
      socket.on('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) resolve(false);
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function toPreview(handle: DevServerHandle): PreviewArtifact {
  return {
    url: handle.url,
    workspace: handle.workspace,
    processRef: handle.processRef,
    status: handle.status,
    host: HOST,
    port: handle.port,
    script: handle.script,
    ...(handle.pid ? { pid: handle.pid } : {}),
  };
}

function cloneHandle(handle: DevServerHandle): DevServerHandle {
  return { ...handle };
}
