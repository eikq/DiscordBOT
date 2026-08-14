import dotenv from 'dotenv';
import { attachVoiceServiceShutdown, startLocalVoiceService } from './local_voice_process';

dotenv.config({ quiet: true });

const service = await startLocalVoiceService();
attachVoiceServiceShutdown(service.child);

if (service.child) {
  await new Promise<void>((resolve, reject) => {
    service.child?.once('exit', code => code === 0 ? resolve() : reject(new Error(`Voice service exited with code ${code}.`)));
  });
}
