import dotenv from 'dotenv';
import { startLocalSttService } from './local_stt_process';
import { attachVoiceServiceShutdown } from './local_voice_process';

dotenv.config({ quiet: true });

startLocalSttService()
  .then(service => attachVoiceServiceShutdown(service.child))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
