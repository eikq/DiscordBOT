import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { jarvisDataRoot } from '../../edition/resolve';
import { isLoopbackHttpUrl, probeOpenAiCompatibleEndpoint } from '../setup/modelProbe';
import { readCommunitySetup } from '../setup/store';
import { isCommunityServiceId, type CommunityServiceId } from '../setup/types';
import { pidIsAlive, processExecutablePath, processRssBytes, sameExecutable } from './processIdentity';
import type { CommunityOwnershipRecord, CommunityServiceRecord } from './types';

export function assertKnownServiceId(id: string): CommunityServiceId {
  if (!isCommunityServiceId(id)) {
    throw Object.assign(new Error(`Unknown Community service: ${id}`), { code: 'UNKNOWN_SERVICE' });
  }
  return id;
}

export function ownershipFile(dataRoot = jarvisDataRoot()): string {
  return path.join(dataRoot, 'runtime', 'owned-services.json');
}

export function readOwnership(dataRoot = jarvisDataRoot()): CommunityOwnershipRecord[] {
  const file = ownershipFile(dataRoot);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { records?: CommunityOwnershipRecord[] };
    return Array.isArray(raw.records) ? raw.records.filter(isOwnershipRecord) : [];
  } catch {
    return [];
  }
}

function writeOwnership(records: CommunityOwnershipRecord[], dataRoot = jarvisDataRoot()): void {
  fs.mkdirSync(path.dirname(ownershipFile(dataRoot)), { recursive: true });
  fs.writeFileSync(ownershipFile(dataRoot), JSON.stringify({ records }, null, 2), 'utf8');
}

export function recordCoreOwnership(
  pid = process.pid,
  executablePath = process.execPath,
  dataRoot = jarvisDataRoot(),
): void {
  const next = readOwnership(dataRoot).filter(item => item.serviceId !== 'jarvis-core');
  next.push({
    serviceId: 'jarvis-core',
    pid,
    startedAt: new Date().toISOString(),
    executablePath,
    commandProfileId: 'community-core-v1',
    ownedByJarvis: true,
  });
  writeOwnership(next, dataRoot);
}

export async function listCommunityServices(dataRoot = jarvisDataRoot()): Promise<CommunityServiceRecord[]> {
  const setup = readCommunitySetup(dataRoot);
  const owned = readOwnership(dataRoot);
  const coreOwned = owned.find(item => item.serviceId === 'jarvis-core');
  const modelOwned = owned.find(item => item.serviceId === 'local-ai');
  const endpoint = setup.model.baseUrl;
  const modelProbe = isLoopbackHttpUrl(endpoint)
    ? await probeOpenAiCompatibleEndpoint({ baseUrl: endpoint, timeoutMs: 2500 })
    : { ok: false, modelIds: [] as string[] };

  const corePid = coreOwned?.pid || process.pid;
  const core: CommunityServiceRecord = {
    id: 'jarvis-core',
    displayNameTh: 'JARVIS หลัก',
    displayNameEn: 'JARVIS Core',
    descriptionTh: 'หน้าจอและตัวช่วยที่คุณคุยด้วย',
    descriptionEn: 'The interface you talk to',
    required: true,
    optional: false,
    state: pidIsAlive(corePid) ? 'RUNNING' : 'STOPPED',
    ownedByJarvis: Boolean(coreOwned?.ownedByJarvis),
    canStop: false,
    canStart: false,
    pid: corePid,
    ramBytes: processRssBytes(corePid),
    health: 'HTTP',
    noteTh: 'ปิดได้จาก Stop JARVIS.cmd',
    noteEn: 'Stop it with Stop JARVIS.cmd',
  };

  const modelValid = Boolean(modelOwned && ownershipStillValid(modelOwned));
  let modelState: CommunityServiceRecord['state'] = 'NOT_CONFIGURED';
  if (setup.model.mode === 'endpoint') {
    modelState = modelProbe.ok ? 'EXTERNAL' : 'STOPPED';
  } else if (setup.model.llamaServerPath && setup.model.ggufPath) {
    if (modelValid) modelState = modelProbe.ok ? 'RUNNING' : 'DEGRADED';
    else modelState = modelProbe.ok ? 'EXTERNAL' : 'STOPPED';
  }

  const localAi: CommunityServiceRecord = {
    id: 'local-ai',
    displayNameTh: 'Local AI',
    displayNameEn: 'Local AI',
    descriptionTh: 'สมองหลักที่ใช้คิดและตอบ',
    descriptionEn: 'The model that thinks and answers',
    required: false,
    optional: true,
    state: modelState,
    ownedByJarvis: modelValid,
    canStop: modelValid,
    canStart: setup.model.mode === 'managed'
      && Boolean(setup.model.llamaServerPath && setup.model.ggufPath)
      && !modelValid
      && !modelProbe.ok,
    pid: modelValid ? modelOwned?.pid : undefined,
    ramBytes: modelValid && modelOwned ? processRssBytes(modelOwned.pid) : undefined,
    health: modelProbe.ok ? 'READY' : 'OFFLINE',
    noteTh: modelState === 'EXTERNAL' ? 'กำลังทำงานอยู่แล้ว JARVIS ไม่ได้เป็นคนเปิด จึงไม่หยุดให้' : undefined,
    noteEn: modelState === 'EXTERNAL' ? 'Already running outside JARVIS, so Stop is hidden.' : undefined,
  };
  return [core, localAi];
}

export async function startCommunityService(id: string, dataRoot = jarvisDataRoot()): Promise<CommunityServiceRecord> {
  const serviceId = assertKnownServiceId(id);
  if (serviceId === 'jarvis-core') {
    throw Object.assign(new Error('JARVIS Core is started by the launcher, not this control.'), { code: 'CORE_LAUNCHER_ONLY' });
  }
  const setup = readCommunitySetup(dataRoot);
  if (setup.model.mode !== 'managed' || !setup.model.llamaServerPath || !setup.model.ggufPath) {
    throw Object.assign(new Error('Local AI is not configured as a JARVIS-managed model.'), { code: 'NOT_MANAGED' });
  }
  const current = (await listCommunityServices(dataRoot)).find(item => item.id === 'local-ai')!;
  if (current.state === 'EXTERNAL' || (current.ownedByJarvis && (current.state === 'RUNNING' || current.state === 'DEGRADED'))) {
    return current;
  }
  const exe = path.resolve(setup.model.llamaServerPath);
  const model = path.resolve(setup.model.ggufPath);
  if (!fs.existsSync(exe) || !fs.existsSync(model)) {
    throw Object.assign(new Error('The saved model program or file is missing.'), { code: 'MISSING_FILES' });
  }
  const child = spawn(exe, [
    '-m', model,
    '--host', '127.0.0.1',
    '--port', String(setup.model.port || 8086),
    '-c', String(setup.model.contextSize || 4096),
  ], {
    cwd: path.dirname(exe),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (!child.pid) throw Object.assign(new Error('The local model did not start.'), { code: 'SPAWN_FAILED' });
  child.unref();
  const next = readOwnership(dataRoot).filter(item => item.serviceId !== 'local-ai');
  next.push({
    serviceId: 'local-ai',
    pid: child.pid,
    startedAt: new Date().toISOString(),
    executablePath: exe,
    commandProfileId: 'llama-server-gguf-v1',
    ownedByJarvis: true,
  });
  writeOwnership(next, dataRoot);
  return (await listCommunityServices(dataRoot)).find(item => item.id === 'local-ai')!;
}

export async function stopCommunityService(id: string, dataRoot = jarvisDataRoot()): Promise<CommunityServiceRecord> {
  const serviceId = assertKnownServiceId(id);
  if (serviceId === 'jarvis-core') {
    throw Object.assign(new Error('JARVIS Core cannot be stopped from the web page.'), { code: 'CORE_NOT_STOPPABLE' });
  }
  const owned = readOwnership(dataRoot).find(item => item.serviceId === serviceId);
  if (!owned?.ownedByJarvis) {
    throw Object.assign(new Error('JARVIS will not stop a program it did not start.'), { code: 'NOT_OWNED' });
  }
  if (!ownershipStillValid(owned)) {
    writeOwnership(readOwnership(dataRoot).filter(item => item.serviceId !== serviceId), dataRoot);
    throw Object.assign(new Error('That process is no longer the one JARVIS started.'), { code: 'IDENTITY_MISMATCH' });
  }
  stopOwnedPid(owned.pid);
  writeOwnership(readOwnership(dataRoot).filter(item => item.serviceId !== serviceId), dataRoot);
  return (await listCommunityServices(dataRoot)).find(item => item.id === serviceId)!;
}

export async function restartCommunityService(id: string, dataRoot = jarvisDataRoot()): Promise<CommunityServiceRecord> {
  const serviceId = assertKnownServiceId(id);
  try {
    await stopCommunityService(serviceId, dataRoot);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'NOT_OWNED' && code !== 'IDENTITY_MISMATCH') throw error;
  }
  return startCommunityService(serviceId, dataRoot);
}

export function stopOwnedServicesForShutdown(
  behavior: 'keep-model' | 'stop-owned-model',
  dataRoot = jarvisDataRoot(),
): void {
  const records = readOwnership(dataRoot);
  const keep = behavior === 'keep-model' ? records.filter(item => item.serviceId === 'local-ai') : [];
  for (const record of records) {
    if (behavior === 'keep-model' && record.serviceId === 'local-ai') continue;
    if (!ownershipStillValid(record)) continue;
    stopOwnedPid(record.pid);
  }
  writeOwnership(keep, dataRoot);
}

function isOwnershipRecord(value: CommunityOwnershipRecord): boolean {
  return Boolean(
    value
    && (value.serviceId === 'jarvis-core' || value.serviceId === 'local-ai')
    && value.ownedByJarvis === true
    && Number.isInteger(value.pid)
    && value.pid > 0
    && typeof value.executablePath === 'string'
    && (value.commandProfileId === 'community-core-v1' || value.commandProfileId === 'llama-server-gguf-v1'),
  );
}

function ownershipStillValid(record: CommunityOwnershipRecord): boolean {
  if (!pidIsAlive(record.pid)) return false;
  const live = processExecutablePath(record.pid);
  return Boolean(live && sameExecutable(live, record.executablePath));
}

function stopOwnedPid(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    /* already gone */
  }
  if (process.platform === 'win32' && pidIsAlive(pid)) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T'], { timeout: 4000, windowsHide: true, stdio: 'ignore' });
    } catch {
      /* do not escalate to /F */
    }
  }
}
