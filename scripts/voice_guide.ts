import fs from 'fs';
import path from 'path';

export function runVoiceRecordingGuide() {
  console.log('=== DIGITAL ME OWNER VOICE DATASET GUIDE ===\n');
  console.log('To clone your voice with 100% natural Thai tone for $0 in Google Colab (RVC v2):');
  console.log('\n1. RECORD YOUR VOICE SAMPLE:');
  console.log('   - Record 1 to 3 minutes of clean audio of your voice (16kHz or 44.1kHz WAV).');
  console.log('   - No background music, game noise, or friend voices in the clip.');
  console.log('   - Speak in your natural Discord conversational tone using Thai slang & particles.');
  
  console.log('\n2. RECOMMENDED SCRIPTS TO RECORD:');
  console.log('   - "เออ กูเข้าเกมละ"');
  console.log('   - "เดี๋ยวๆ เมื่อกี้ใครพูด"');
  console.log('   - "ไม่อะ ขก."');
  console.log('   - "wait กูเปิด discord ก่อน"');
  console.log('   - "เชี่ย จริงดิ"');
  console.log('   - "มึงเล่นไปก่อนเลย"');

  console.log('\n3. SAVE YOUR REFERENCE WAV:');
  console.log('   - Place the file at: data/voice/owner_reference.wav');
  console.log('   - Set COLAB_TTS_URL in .env if using Google Colab RVC server.');

  const targetDir = path.join(process.cwd(), 'data', 'voice');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  console.log(`\n✅ Directory created at: ${targetDir}`);
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('voice_guide')) {
  runVoiceRecordingGuide();
}
