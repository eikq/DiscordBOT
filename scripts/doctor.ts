import os from 'os';
import { execSync } from 'child_process';

export interface HardwareReport {
  osPlatform: string;
  osRelease: string;
  osArch: string;
  totalRamGB: number;
  freeRamGB: number;
  cpuModel: string;
  cpuCores: number;
  gpuInfo: string;
  hasCuda: boolean;
  cudaVersion: string | null;
  nodeVersion: string;
  pythonVersion: string | null;
  recommendedProfile: 'LOW_VRAM' | 'MID_VRAM' | 'HIGH_VRAM';
}

export function runHardwareDoctor(): HardwareReport {
  const cpus = os.cpus();
  const totalRamGB = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
  const freeRamGB = Math.round((os.freemem() / (1024 ** 3)) * 10) / 10;
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown CPU';
  const cpuCores = cpus.length;

  let gpuInfo = 'No dedicated NVIDIA GPU detected / CPU only';
  let hasCuda = false;
  let cudaVersion: string | null = null;

  try {
    const smiOutput = execSync('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader', { encoding: 'utf-8', timeout: 3000 });
    if (smiOutput && smiOutput.trim()) {
      gpuInfo = smiOutput.trim();
      hasCuda = true;
    }
  } catch (e) {
    // nvidia-smi not found or no GPU
  }

  let pythonVersion: string | null = null;
  try {
    const pyOut = execSync('python3 --version || python --version', { encoding: 'utf-8', timeout: 3000 });
    pythonVersion = pyOut.trim();
  } catch (e) {
    // Python not installed
  }

  // Calculate recommended profile based on RAM/GPU
  let recommendedProfile: 'LOW_VRAM' | 'MID_VRAM' | 'HIGH_VRAM' = 'LOW_VRAM';
  if (hasCuda && (gpuInfo.includes('12GB') || gpuInfo.includes('16GB') || gpuInfo.includes('24GB') || totalRamGB >= 32)) {
    recommendedProfile = 'HIGH_VRAM';
  } else if (hasCuda || totalRamGB >= 16) {
    recommendedProfile = 'MID_VRAM';
  } else {
    recommendedProfile = 'LOW_VRAM';
  }

  return {
    osPlatform: os.platform(),
    osRelease: os.release(),
    osArch: os.arch(),
    totalRamGB,
    freeRamGB,
    cpuModel,
    cpuCores,
    gpuInfo,
    hasCuda,
    cudaVersion,
    nodeVersion: process.version,
    pythonVersion,
    recommendedProfile
  };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('doctor')) {
  console.log('=== DIGITAL ME HARDWARE DOCTOR ===\n');
  const report = runHardwareDoctor();
  console.log(`OS: ${report.osPlatform} (${report.osArch})`);
  console.log(`CPU: ${report.cpuModel} (${report.cpuCores} cores)`);
  console.log(`RAM: ${report.totalRamGB} GB Total (${report.freeRamGB} GB Free)`);
  console.log(`GPU: ${report.gpuInfo}`);
  console.log(`Node.js: ${report.nodeVersion}`);
  console.log(`Python: ${report.pythonVersion || 'Not detected'}`);
  console.log(`\nRECOMMENDED RUNTIME PROFILE: [ ${report.recommendedProfile} ]\n`);
  
  if (report.recommendedProfile === 'LOW_VRAM') {
    console.log('-> Optimization Plan:');
    console.log('   - ASR: Lightweight / local Whisper or Qwen3-ASR 0.6B Q4');
    console.log('   - LLM: Typhoon 2.5 4B Q4_K_M with CPU/GPU hybrid offload');
    console.log('   - Embeddings: Local CPU cosine similarity');
    console.log('   - TTS: Sequential chunking / Edge-TTS fallback');
  } else if (report.recommendedProfile === 'MID_VRAM') {
    console.log('-> Optimization Plan:');
    console.log('   - ASR: Qwen3-ASR 0.6B / faster-whisper local server');
    console.log('   - LLM: Typhoon 2.5 4B Q4_K_M resident on GPU');
    console.log('   - Embeddings: Qwen3-Embedding-0.6B on CPU/RAM');
    console.log('   - TTS: Local ThonburianTTS / Edge-TTS / Colab RVC');
  } else {
    console.log('-> Optimization Plan:');
    console.log('   - Keep all local models (ASR, LLM, TTS, Embeddings) resident in VRAM for lowest latency');
  }
}
