import { runHardwareDoctor } from './doctor';
import { runLocalBenchmark } from './benchmark';
import { BotService } from '../src/bot/BotService';
import dotenv from 'dotenv';

dotenv.config();

async function startLocalZeroCostSystem() {
  console.log('====================================================');
  console.log('   DIGITAL ME — ZERO-COST LOCAL LAUNCHER           ');
  console.log('====================================================\n');

  // 1. Run Hardware Doctor
  const hw = runHardwareDoctor();
  console.log(`[Doctor] Detected Profile: [ ${hw.recommendedProfile} ]`);
  console.log(`[Doctor] System RAM: ${hw.totalRamGB} GB | GPU: ${hw.gpuInfo}`);

  // 2. Run Local Service Benchmark
  await runLocalBenchmark();

  // 3. Boot Discord Bot
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.log('\n[Launcher] ⚡ DISCORD_TOKEN is missing in .env.');
    console.log('[Launcher] System initialized in Standalone Local Simulation & Web Control Mode.');
    console.log('[Launcher] To connect to live Discord, add DISCORD_TOKEN to your .env file.\n');
    return;
  }

  console.log('[Launcher] Connecting Digital Me to Discord...');
  const botService = new BotService();
  await botService.start(token);
  console.log('✅ Digital Me Bot is ONLINE and running at $0 recurring cost!\n');
}

startLocalZeroCostSystem().catch(console.error);
