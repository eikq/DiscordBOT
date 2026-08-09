import { runHardwareDoctor } from './doctor';
import { runLocalBenchmark } from './benchmark';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

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

  // 3. Start the dashboard. server.ts also connects the bot when a token exists.
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.log('\n[Launcher] ⚡ DISCORD_TOKEN is missing in .env.');
    console.log('[Launcher] Dashboard will start without a Discord connection.');
    console.log('[Launcher] Add DISCORD_TOKEN to .env or paste it into the local dashboard.\n');
  } else {
    console.log('[Launcher] Discord token found; the dashboard will connect the bot.');
  }

  await import('../server');
}

startLocalZeroCostSystem().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
