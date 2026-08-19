import fs from 'node:fs';
import path from 'node:path';
import type { NightRunState, SafetyEvent, TaskRunRecord } from './types';

export function nightStateDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.agent', 'night');
}

export class NightStateStore {
  readonly dir: string;
  readonly statePath: string;
  readonly tasksPath: string;
  readonly reportsDir: string;
  readonly escalationsDir: string;
  readonly lessonsDir: string;
  readonly logsDir: string;
  private state: NightRunState | null = null;

  constructor(workspaceRoot: string) {
    this.dir = nightStateDir(workspaceRoot);
    this.statePath = path.join(this.dir, 'state.json');
    this.tasksPath = path.join(this.dir, 'tasks.json');
    this.reportsDir = path.join(this.dir, 'reports');
    this.escalationsDir = path.join(this.dir, 'escalations');
    this.lessonsDir = path.join(this.dir, 'lessons');
    this.logsDir = path.join(this.dir, 'logs');
  }

  ensureLayout(): void {
    for (const dir of [this.dir, this.reportsDir, this.escalationsDir, this.lessonsDir, this.logsDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  load(): NightRunState | null {
    if (!fs.existsSync(this.statePath)) return null;
    this.state = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as NightRunState;
    return this.state;
  }

  current(): NightRunState {
    if (!this.state) throw new Error('Night state has not been started.');
    return this.state;
  }

  start(initial: NightRunState): NightRunState {
    this.ensureLayout();
    this.state = initial;
    this.save();
    return initial;
  }

  save(): void {
    if (!this.state) return;
    this.state.updatedAt = new Date().toISOString();
    this.ensureLayout();
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2) + '\n', 'utf8');
  }

  addSafety(event: SafetyEvent): void {
    this.current().safetyEvents.push(event);
    this.save();
  }

  addResourceNote(note: string): void {
    this.current().resourceNotes.push(note);
    this.save();
  }

  putTask(record: TaskRunRecord): void {
    this.current().tasks[record.taskId] = record;
    this.save();
  }

  writeTasksFile(payload: unknown): void {
    this.ensureLayout();
    fs.writeFileSync(this.tasksPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }

  appendLog(line: string): void {
    this.ensureLayout();
    const file = path.join(this.logsDir, 'run-' + (this.state?.runId || 'unknown') + '.ndjson');
    fs.appendFileSync(file, line.replace(/\n/g, ' ') + '\n', 'utf8');
  }

  writeLesson(taskId: string, body: string): void {
    this.ensureLayout();
    fs.writeFileSync(path.join(this.lessonsDir, taskId + '.md'), body, 'utf8');
  }
}