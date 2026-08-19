import fs from 'node:fs';
import path from 'node:path';
import { parseNightConfig, parseNightTaskFile } from './schema';
import type { NightConfig, NightTask } from './types';

export function resolveConfigPath(cwd = process.cwd()): string {
  const named = path.join(cwd, 'night-agent.config.json');
  if (fs.existsSync(named)) return named;
  return path.join(cwd, 'night-agent.config.example.json');
}

export function loadNightConfig(cwd = process.cwd()): { config: NightConfig; path: string } {
  const file = resolveConfigPath(cwd);
  if (!fs.existsSync(file)) return { config: parseNightConfig({}), path: file };
  return { config: parseNightConfig(JSON.parse(fs.readFileSync(file, 'utf8'))), path: file };
}

export function loadNightTasks(config: NightConfig, cwd = process.cwd()): { tasks: NightTask[]; path: string } {
  const workspace = config.workspaceRoot || cwd;
  const file = path.join(workspace, '.agent', 'night', 'tasks.json');
  if (!fs.existsSync(file)) return { tasks: [], path: file };
  const parsed = parseNightTaskFile(JSON.parse(fs.readFileSync(file, 'utf8')), {
    maxAttempts: config.maxAttemptsPerTask,
    maxMinutes: config.defaultTaskMaxMinutes,
  });
  return { tasks: parsed.tasks, path: file };
}