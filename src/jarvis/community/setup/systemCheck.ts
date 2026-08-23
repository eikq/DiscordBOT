import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { jarvisDataRoot } from '../../edition/resolve';

export type SystemCheckItem = {
  id: string;
  ok: boolean;
  optional?: boolean;
  labelTh: string;
  labelEn: string;
  summaryTh: string;
  summaryEn: string;
  detail?: string;
};

export type CommunitySystemCheck = {
  items: SystemCheckItem[];
  nodeReady: boolean;
  depsReady: boolean;
};

export function runCommunitySystemCheck(workspaceRoot = process.cwd()): CommunitySystemCheck {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const nodeOk = Number.isFinite(nodeMajor) && nodeMajor >= 18;
  const modulesOk = fs.existsSync(path.join(workspaceRoot, 'node_modules'));
  const envExists = fs.existsSync(path.join(workspaceRoot, '.env.community'));
  const dataRoot = jarvisDataRoot(workspaceRoot);
  const ramGb = Math.round(os.totalmem() / (1024 ** 3));
  const freeGb = Math.round(os.freemem() / (1024 ** 3));
  const disk = readDiskGb(workspaceRoot);
  const gpu = readGpuName();
  const items: SystemCheckItem[] = [
    {
      id: 'os',
      ok: true,
      labelTh: 'ระบบปฏิบัติการ',
      labelEn: 'Operating system',
      summaryTh: `${os.type()} ${os.release()}`,
      summaryEn: `${os.type()} ${os.release()}`,
    },
    {
      id: 'node',
      ok: nodeOk,
      labelTh: 'Node.js',
      labelEn: 'Node.js',
      summaryTh: nodeOk ? `พร้อมใช้งาน (${process.versions.node})` : `ต้องการเวอร์ชัน 18 ขึ้นไป (พบ ${process.versions.node})`,
      summaryEn: nodeOk ? `Ready (${process.versions.node})` : `Node.js 18+ required (found ${process.versions.node})`,
    },
    {
      id: 'deps',
      ok: modulesOk,
      labelTh: 'ส่วนประกอบโปรแกรม',
      labelEn: 'Program components',
      summaryTh: modulesOk ? 'ติดตั้งแล้ว' : 'ยังไม่ได้ติดตั้ง — กดติดตั้งครั้งเดียว',
      summaryEn: modulesOk ? 'Installed' : 'Not installed yet — install once',
    },
    {
      id: 'memory',
      ok: ramGb >= 8,
      labelTh: 'หน่วยความจำ',
      labelEn: 'Memory',
      summaryTh: `${ramGb} GB ทั้งหมด · ว่างประมาณ ${freeGb} GB`,
      summaryEn: `${ramGb} GB total · about ${freeGb} GB free`,
    },
    {
      id: 'disk',
      ok: disk === null || disk.freeGb >= 5,
      optional: disk === null,
      labelTh: 'พื้นที่ดิสก์',
      labelEn: 'Disk space',
      summaryTh: disk ? `ว่างประมาณ ${disk.freeGb} GB` : 'อ่านค่าไม่ได้',
      summaryEn: disk ? `About ${disk.freeGb} GB free` : 'Could not read',
    },
    {
      id: 'gpu',
      ok: Boolean(gpu),
      optional: true,
      labelTh: 'การ์ดจอ',
      labelEn: 'Graphics',
      summaryTh: gpu || 'ไม่พบ NVIDIA GPU (ใช้ CPU ได้)',
      summaryEn: gpu || 'No NVIDIA GPU detected (CPU still works)',
    },
    {
      id: 'env',
      ok: envExists,
      optional: true,
      labelTh: 'ไฟล์การตั้งค่า',
      labelEn: 'Settings file',
      summaryTh: envExists ? 'มี .env.community แล้ว' : 'จะสร้างเมื่อบันทึกตัวช่วยตั้งค่า',
      summaryEn: envExists ? '.env.community is present' : 'Will be created when setup is saved',
    },
    {
      id: 'data',
      ok: true,
      labelTh: 'ข้อมูล Community',
      labelEn: 'Community data',
      summaryTh: path.relative(workspaceRoot, dataRoot) || dataRoot,
      summaryEn: path.relative(workspaceRoot, dataRoot) || dataRoot,
      detail: dataRoot,
    },
  ];
  return { items, nodeReady: nodeOk, depsReady: modulesOk };
}

function readDiskGb(root: string): { freeGb: number } | null {
  try {
    const statfs = (fs as typeof fs & { statfsSync?: (p: string) => { bavail: number; bsize: number } }).statfsSync;
    if (!statfs) return null;
    const info = statfs(root);
    return { freeGb: Math.round((info.bavail * info.bsize) / (1024 ** 3)) };
  } catch {
    return null;
  }
}

function readGpuName(): string | null {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], {
      encoding: 'utf8',
      timeout: 2500,
      windowsHide: true,
    }).trim();
    return out.split('\n')[0]?.trim() || null;
  } catch {
    return null;
  }
}
