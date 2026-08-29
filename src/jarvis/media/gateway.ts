import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export type MediaGatewayAvailability = {
  configured: boolean;
  bridgeConnected: boolean;
  comfyConnected: boolean;
  backendReachable: boolean;
  reason?: string;
};

export type MediaCreateRequest = {
  storyline: string;
  title?: string;
  targetDurationSeconds?: number;
  aspectRatio?: string;
  style?: string;
  fps?: number;
  shotCount?: number;
  workflowId?: string;
};

export type SubmittedMediaProject = {
  projectId: string;
  workflowId: string;
  jobs: Array<{ shotIndex: number; promptId: string; workflowFile: string }>;
};

export interface MediaCapabilityPort {
  availability(): Promise<MediaGatewayAvailability>;
  createVideo(input: MediaCreateRequest, signal?: AbortSignal): Promise<SubmittedMediaProject>;
  status(projectId: string): Promise<Record<string, unknown>>;
  cancel(projectId: string): Promise<Record<string, unknown>>;
  collectOutput(projectId: string, stitch: boolean): Promise<Record<string, unknown>>;
  close?(): Promise<void>;
}

type EndpointOptions = {
  label: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  requiredTools: string[];
};

type McpToolRecord = { name: string };

class McpEndpoint {
  private client?: Client;
  private transport?: StdioClientTransport;
  private tools = new Set<string>();
  private connecting?: Promise<void>;

  constructor(private readonly options: EndpointOptions) {}

  async connect(): Promise<void> {
    if (this.client && this.transport && this.options.requiredTools.every(tool => this.tools.has(tool))) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectInner().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  async call(name: string, args: Record<string, unknown>, timeout = 60_000): Promise<Record<string, unknown>> {
    await this.connect();
    if (!this.tools.has(name)) throw new Error(`${this.options.label} tool unavailable: ${name}`);
    const result = await this.client!.callTool(
      { name, arguments: args },
      undefined,
      { timeout },
    );
    return structuredResult(result);
  }

  async close(): Promise<void> {
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;
    this.tools.clear();
    if (transport) await transport.close().catch(() => undefined);
  }

  private async connectInner(): Promise<void> {
    const client = new Client({ name: 'jarvis-media-bridge', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: this.options.command,
      args: this.options.args,
      env: this.options.env,
      cwd: this.options.cwd,
      stderr: 'pipe',
    });
    transport.stderr?.on('data', chunk => {
      const message = String(chunk).trim();
      if (message) console.warn(`[${this.options.label}] ${message}`);
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = new Set((listed.tools as McpToolRecord[]).map(tool => tool.name));
      for (const required of this.options.requiredTools) {
        if (!names.has(required)) throw new Error(`${this.options.label} missing required tool: ${required}`);
      }
      this.client = client;
      this.transport = transport;
      this.tools = names;
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
  }
}

const BRIDGE_TOOLS = [
  'media_capabilities', 'media_create_project', 'media_prepare_project',
  'media_render_state', 'media_record_job', 'media_record_shot_result',
  'media_record_fetched_outputs', 'media_project_output_dir',
  'media_stitch_project_clips', 'media_record_final_video',
] as const;

const COMFY_TOOLS = ['run_workflow', 'job', 'fetch_outputs', 'server_info', 'validate_workflow'] as const;

export class McpMediaGateway implements MediaCapabilityPort {
  private readonly root: string;
  private readonly bridge: McpEndpoint;
  private readonly comfy: McpEndpoint;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.root = env.AI_MEDIA_BRIDGE_ROOT?.trim()
      || (process.platform === 'win32' ? 'C:\\AI\\AI-Media-Bridge' : '');
    const bridgePython = env.AI_MEDIA_BRIDGE_PYTHON?.trim()
      || path.join(this.root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const comfyMcp = env.AI_MEDIA_COMFY_MCP_COMMAND?.trim()
      || path.join(this.root, '.venv', process.platform === 'win32' ? 'Scripts/comfy-mcp.exe' : 'bin/comfy-mcp');
    const comfyBin = env.AI_MEDIA_COMFY_BIN?.trim()
      || (process.platform === 'win32'
        ? 'C:\\AI\\ComfyUI-Portable\\ComfyUI_windows_portable\\python_embeded\\Scripts\\comfy.exe'
        : path.join(this.root, '.venv', 'bin/comfy'));
    const comfyUrl = env.AI_MEDIA_COMFYUI_URL?.trim() || 'http://127.0.0.1:8188';
    const inherited = stringEnvironment(env);
    this.bridge = new McpEndpoint({
      label: 'AI Media Bridge', command: bridgePython, args: ['-m', 'media_bridge.server'],
      cwd: this.root, env: { ...inherited, PYTHONPATH: this.root },
      requiredTools: [...BRIDGE_TOOLS],
    });
    this.comfy = new McpEndpoint({
      label: 'Comfy MCP', command: comfyMcp, cwd: this.root,
      env: { ...inherited, COMFY_BIN: comfyBin, COMFYUI_URL: comfyUrl },
      requiredTools: [...COMFY_TOOLS],
    });
  }

  async availability(): Promise<MediaGatewayAvailability> {
    if (!this.root || !fs.existsSync(this.root)) {
      return { configured: false, bridgeConnected: false, comfyConnected: false, backendReachable: false, reason: 'AI Media Bridge root is missing.' };
    }
    try {
      const bridgeState = await this.bridge.call('media_capabilities', {}, 8_000);
      await this.comfy.connect();
      const backendReachable = Boolean(readNested(bridgeState, ['comfy', 'reachable']));
      return {
        configured: true,
        bridgeConnected: true,
        comfyConnected: true,
        backendReachable,
        ...(backendReachable ? {} : { reason: 'ComfyUI backend is not reachable.' }),
      };
    } catch (error) {
      return {
        configured: true, bridgeConnected: false, comfyConnected: false, backendReachable: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createVideo(input: MediaCreateRequest, signal?: AbortSignal): Promise<SubmittedMediaProject> {
    assertNotAborted(signal);
    const created = await this.bridge.call('media_create_project', createProjectArgs(input), 30_000);
    const project = objectAt(created, 'project');
    const projectId = requiredString(project.project_id, 'project_id');
    const workflowId = requiredString(project.workflow_id, 'workflow_id');
    const shots = Array.isArray(project.shots) ? project.shots as Array<Record<string, unknown>> : [];
    const prepared = await this.bridge.call('media_prepare_project', {
      project_id: projectId,
      ...(input.workflowId ? { workflow_id: input.workflowId } : {}),
    }, 60_000);
    const files = stringArray(prepared.prepared_workflows);
    if (!files.length || files.length !== shots.length) {
      throw new Error('Prepared workflow count does not match the media shot plan.');
    }
    const jobs: SubmittedMediaProject['jobs'] = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        assertNotAborted(signal);
        const shotIndex = Number(shots[i]?.index ?? i + 1);
        const preflight = await this.comfy.call('validate_workflow', {
          workflow_path: files[i],
        }, 65_000);
        if (preflight.valid !== true) {
          throw new Error(`Media workflow preflight failed for shot ${shotIndex}.`);
        }
        if (preflight.spends_credits === true) {
          throw new Error(`Media workflow requested paid execution for shot ${shotIndex}.`);
        }
        const submitted = await this.comfy.call('run_workflow', {
          workflow_path: files[i], wait: false, confirm_spend: false,
        }, 65_000);
        const promptId = findStringKey(submitted, 'prompt_id');
        if (!promptId) throw new Error(`ComfyUI did not return a prompt id for shot ${shotIndex}.`);
        jobs.push({ shotIndex, promptId, workflowFile: files[i] });
        await this.bridge.call('media_record_job', {
          project_id: projectId, shot_index: shotIndex,
          prompt_id: promptId, workflow_file: files[i],
        }, 10_000);
      }
    } catch (error) {
      await Promise.all(jobs.map(job => this.comfy.call('job', {
        action: 'cancel', prompt_id: job.promptId,
      }, 15_000).catch(() => ({}))));
      throw error;
    }
    return { projectId, workflowId: input.workflowId || workflowId, jobs };
  }

  async status(projectId: string): Promise<Record<string, unknown>> {
    const state = await this.bridge.call('media_render_state', { project_id: projectId }, 10_000);
    const shots = Array.isArray(state.shots) ? state.shots as Array<Record<string, unknown>> : [];
    const live = await Promise.all(shots.map(async shot => {
      const promptId = typeof shot.prompt_id === 'string' ? shot.prompt_id : '';
      if (!promptId) return { ...shot, live: null };
      try {
        const job = await this.comfy.call('job', { action: 'status', prompt_id: promptId }, 20_000);
        return { ...shot, live: job };
      } catch (error) {
        return { ...shot, liveError: error instanceof Error ? error.message : String(error) };
      }
    }));
    return { ...state, shots: live };
  }

  async cancel(projectId: string): Promise<Record<string, unknown>> {
    const state = await this.bridge.call('media_render_state', { project_id: projectId }, 10_000);
    const shots = Array.isArray(state.shots) ? state.shots as Array<Record<string, unknown>> : [];
    const cancelled: string[] = [];
    for (const shot of shots) {
      const promptId = typeof shot.prompt_id === 'string' ? shot.prompt_id : '';
      if (!promptId || shot.status === 'completed' || shot.status === 'failed') continue;
      await this.comfy.call('job', { action: 'cancel', prompt_id: promptId }, 20_000);
      cancelled.push(promptId);
      await this.bridge.call('media_record_shot_result', {
        project_id: projectId, shot_index: Number(shot.index),
        status: 'failed', error: 'cancelled by owner', output_files: [],
      }, 10_000);
    }
    return { project_id: projectId, cancelled };
  }

  async collectOutput(projectId: string, stitch: boolean): Promise<Record<string, unknown>> {
    const output = await this.bridge.call('media_project_output_dir', { project_id: projectId }, 10_000);
    const outputDir = requiredString(output.output_dir, 'output_dir');
    const state = await this.bridge.call('media_render_state', { project_id: projectId }, 10_000);
    const shots = Array.isArray(state.shots) ? state.shots as Array<Record<string, unknown>> : [];
    for (const shot of shots) {
      const promptId = typeof shot.prompt_id === 'string' ? shot.prompt_id : '';
      const shotIndex = Number(shot.index);
      if (!promptId || shot.status === 'completed') continue;
      const job = await this.comfy.call('job', { action: 'status', prompt_id: promptId }, 20_000);
      const status = normalizedJobStatus(job);
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        await this.bridge.call('media_record_shot_result', {
          project_id: projectId, shot_index: shotIndex,
          status: 'failed', error: `ComfyUI job ${status}`, output_files: [],
        }, 10_000);
        continue;
      }
      if (status !== 'completed' && status !== 'success') continue;
      const fetched = await this.comfy.call('fetch_outputs', {
        prompt_id: promptId, out_dir: outputDir, url_only: false, inline_images: false,
      }, 310_000);
      await this.bridge.call('media_record_fetched_outputs', {
        project_id: projectId, shot_index: shotIndex, fetched_outputs: fetched,
      }, 10_000);
    }
    let refreshed = await this.bridge.call('media_render_state', { project_id: projectId }, 10_000);
    if (stitch) {
      const completeShots = Array.isArray(refreshed.shots)
        ? refreshed.shots as Array<Record<string, unknown>> : [];
      const clips = completeShots
        .filter(shot => shot.status === 'completed')
        .sort((a, b) => Number(a.index) - Number(b.index))
        .flatMap(shot => stringArray(shot.output_files).filter(isVideoPath).slice(0, 1));
      if (clips.length === completeShots.length && clips.length > 0) {
        const stitched = await this.bridge.call('media_stitch_project_clips', {
          project_id: projectId, clips, filename: 'final.mp4',
        }, 120_000);
        const finalVideo = requiredString(stitched.final_video, 'final_video');
        refreshed = await this.bridge.call('media_record_final_video', {
          project_id: projectId, final_video: finalVideo,
        }, 10_000);
      }
    }
    return refreshed;
  }

  async close(): Promise<void> {
    await Promise.all([this.bridge.close(), this.comfy.close()]);
  }
}

function stringEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).flatMap(([key, value]) => (
    typeof value === 'string' ? [[key, value]] : []
  )));
}

function createProjectArgs(input: MediaCreateRequest): Record<string, unknown> {
  return {
    storyline: input.storyline,
    title: input.title || 'Story Video',
    target_duration_seconds: input.targetDurationSeconds ?? 15,
    aspect_ratio: input.aspectRatio || '16:9',
    style: input.style || 'cinematic, coherent, natural motion',
    fps: input.fps ?? 24,
    ...(input.shotCount ? { shot_count: input.shotCount } : {}),
  };
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('MEDIA_OPERATION_CANCELLED');
}

function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = value[key];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    throw new Error(`Missing structured media field: ${key}`);
  }
  return nested as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing media field: ${field}`);
  return value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function structuredResult(result: any): Record<string, unknown> {
  if (result?.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as Record<string, unknown>;
  }
  const text = Array.isArray(result?.content)
    ? result.content.flatMap((block: any) => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
    : '';
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      return { value: parsed };
    } catch {
      return { text };
    }
  }
  return { raw: result ?? null };
}

function readNested(value: Record<string, unknown>, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function findStringKey(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringKey(item, key);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record[key] === 'string' && String(record[key]).trim()) return String(record[key]);
  for (const nested of Object.values(record)) {
    const found = findStringKey(nested, key);
    if (found) return found;
  }
  return undefined;
}

function normalizedJobStatus(value: Record<string, unknown>): string {
  return (findStringKey(value, 'status') || findStringKey(value, 'state') || '').toLowerCase();
}

function isVideoPath(value: string): boolean {
  return /\.(?:mp4|mov|mkv|webm)$/iu.test(value);
}
