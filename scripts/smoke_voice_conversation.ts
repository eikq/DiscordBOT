import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { LocalTTSProvider } from '../src/bot/tts/LocalTTSProvider';
import { PersonaProfileManager } from '../src/bot/personality/PersonaProfileManager';
import { ConversationTimeline } from '../src/bot/timeline/ConversationTimeline';
import { GroupConversationState } from '../src/bot/brain/GroupConversationState';
import { SocialBrain } from '../src/bot/brain/SocialBrain';
import { ResponseGenerator } from '../src/bot/personality/ResponseGenerator';

dotenv.config({ quiet: true });

if (!process.env.VOICE_API_TOKEN) {
  const tokenPath = path.resolve('.runtime', 'voice_api_token');
  if (fs.existsSync(tokenPath)) process.env.VOICE_API_TOKEN = fs.readFileSync(tokenPath, 'utf8').trim();
}

const speakerId = process.env.DEFAULT_SPEAKER_ID?.trim();
if (!speakerId) throw new Error('DEFAULT_SPEAKER_ID is required for the voice conversation smoke test.');

const persona = new PersonaProfileManager().resolve(speakerId, speakerId);
const transcript = `${persona.aliases.find(alias => /[\u0E00-\u0E7F]/u.test(alias)) || persona.displayName} กินข้าวยัง?`;
const now = Date.now();
const timeline = new ConversationTimeline();
timeline.addEvent({ type: 'VOICE_SESSION_STARTED', sessionId: 'persona-smoke', guildId: 'smoke', channelId: 'smoke', timestamp: now - 1_000 });
timeline.addEvent({
  type: 'TRANSCRIPT_FINAL', eventId: 'persona-smoke-turn', sessionId: 'persona-smoke',
  discordUserId: 'friend', username: 'friend', displayName: 'Friend', rawText: transcript,
  confidence: 0.99, timestamp: now, speechStartedAt: now - 800, speechEndedAt: now, sttLatencyMs: 50,
});
const state = new GroupConversationState(timeline);
const responseStartedAt = Date.now();
const decision = await new SocialBrain('Digital Me').evaluate(state, persona);
const reply = await new ResponseGenerator().generate(decision, state, persona);
if (!reply) throw new Error(`Persona did not answer the addressed smoke prompt (decision: ${decision.action}).`);
const responseMs = Date.now() - responseStartedAt;

const tts = new LocalTTSProvider();
const ttsStartedAt = Date.now();
const audio = await tts.synthesize(reply, speakerId);
if (!audio) throw new Error('The local cloned TTS did not return audio.');
const ttsMs = Date.now() - ttsStartedAt;

const output = path.resolve('.runtime', 'gam-evaluation', 'live_conversation_smoke.wav');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, audio);
console.log(JSON.stringify({ persona: persona.displayName, aliases: persona.aliases, transcript, decision: decision.action, reply, responseMs, ttsMs, totalMs: responseMs + ttsMs, bytes: audio.length, output }, null, 2));
