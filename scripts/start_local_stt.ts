import dotenv from 'dotenv';
import { startLocalSttService } from './local_stt_process';
import { attachVoiceServiceShutdown } from './local_voice_process';

dotenv.config({ quiet: true });

const service = await startLocalSttService();
attachVoiceServiceShutdown(service.child);
if (service.child) {
  await new Promise<void>((resolve, reject) => {
    service.child?.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`Local STT exited with code ${code}.`));
    });
  });
}
