import { Client, GatewayIntentBits, Events, VoiceChannel, GuildMember } from 'discord.js';
import { VoiceConnectionManager } from './VoiceConnectionManager';
import { ConversationTimeline } from './timeline/ConversationTimeline';
import { LocalSTTProvider } from './stt/LocalSTTProvider';
import { SpeechToTextProvider } from './stt/SpeechToTextProvider';
import { SocialBrain } from './brain/SocialBrain';
import { AudioReceiver } from './AudioReceiver';
import fs from 'fs';
import path from 'path';

export class BotService {
  private client: Client;
  private voiceManager: VoiceConnectionManager;
  private timeline: ConversationTimeline;
  private sttProvider: SpeechToTextProvider;
  private socialBrain: SocialBrain;
  private activeReceivers: Map<string, AudioReceiver> = new Map();
  private activeVoiceSpeaker: string = "default";
  private sessionIdCounter = 1;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
      ]
    });

    this.voiceManager = new VoiceConnectionManager();
    this.timeline = new ConversationTimeline();
    this.sttProvider = new LocalSTTProvider();
    this.socialBrain = new SocialBrain("Digital Me");

    this.registerEvents();
  }

  private registerEvents() {
    this.client.on(Events.Error, error => {
      console.error('[Bot] Discord client error:', error);
    });

    this.client.on(Events.ClientReady, async () => {
      console.log(`[Bot] Logged in as ${this.client.user?.tag}`);
      try {
        const commands = [
          { name: 'join', description: 'Joins your voice channel and listens' },
          { name: 'leave', description: 'Leaves voice and saves session data' },
          { name: 'status', description: 'Shows bot connection status' },
          { name: 'debug', description: 'Shows recent debug events' },
          { name: 'transcript', description: 'Shows recent Thai transcriptions' },
          {
            name: 'voice',
            description: 'Select which person/cloned voice the bot should use',
            options: [
              {
                name: 'speaker',
                description: 'Name/Discord tag of the person whose voice clone to use (e.g. piriyapong or default)',
                type: 3, // STRING
                required: true
              }
            ]
          },
          {
            name: 'speak',
            description: 'Make the bot speak text using a specific cloned voice in VC',
            options: [
              {
                name: 'text',
                description: 'Text for the bot to speak',
                type: 3, // STRING
                required: true
              },
              {
                name: 'speaker',
                description: 'Optional speaker voice clone to use',
                type: 3, // STRING
                required: false
              }
            ]
          },
          {
            name: 'voices',
            description: 'Lists all available recorded & cloned voice models'
          }
        ];
        await this.client.application?.commands.set(commands);
        console.log('[Bot] Slash commands registered!');
      } catch (error) {
        console.error('[Bot] Failed to register slash commands:', error);
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      const { commandName } = interaction;

      if (commandName === 'join') {
        const member = interaction.member as GuildMember;
        const voiceChannel = member?.voice?.channel;
        if (!voiceChannel || !(voiceChannel instanceof VoiceChannel)) {
          await interaction.reply({ content: "You need to be in a voice channel to use this command.", ephemeral: true });
          return;
        }

        const connection = this.voiceManager.connectToChannel(voiceChannel);
        const sessionId = `sess_${this.sessionIdCounter++}`;
        
        this.timeline.clear();
        this.timeline.addEvent({
          type: 'VOICE_SESSION_STARTED',
          sessionId,
          guildId: voiceChannel.guild.id,
          channelId: voiceChannel.id,
          timestamp: Date.now()
        });

        const receiver = new AudioReceiver(
          connection, 
          this.timeline, 
          this.sttProvider, 
          sessionId, 
          this.client, 
          this.socialBrain,
          this.voiceManager
        );
        receiver.startListening();
        this.activeReceivers.set(voiceChannel.guild.id, receiver);

        await interaction.reply(`Joined ${voiceChannel.name} and started listening! ($0 API Cost)`);
      }
      else if (commandName === 'leave') {
        const guildId = interaction.guildId;
        if (!guildId || !interaction.guild) {
          await interaction.reply({ content: "Must be used in a server.", ephemeral: true });
          return;
        }
        
        const left = this.voiceManager.disconnect(interaction.guild);
        if (left) {
          this.activeReceivers.delete(guildId);
          this.timeline.addEvent({
            type: 'VOICE_SESSION_ENDED',
            sessionId: `sess_${this.sessionIdCounter-1}`,
            timestamp: Date.now()
          });
          
          // Save session timeline
          const sessionData = this.timeline.getRecentEvents(1000);
          const dir = path.join(process.cwd(), 'data', 'sessions');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `session_${Date.now()}.json`);
          fs.writeFileSync(file, JSON.stringify(sessionData, null, 2));
          
          await interaction.reply("Left the voice channel and saved session data.");
        } else {
          await interaction.reply({ content: "I'm not in a voice channel here.", ephemeral: true });
        }
      }
      else if (commandName === 'status') {
        const guildId = interaction.guildId;
        const connection = guildId ? this.voiceManager.getConnection(guildId) : undefined;
        
        let reply = `**Digital Me Status ($0 Recurring API Cost):**\n`;
        reply += `Voice Connection: ${connection ? 'Connected' : 'Disconnected'}\n`;
        
        if (connection) {
          const snap = this.timeline.getConversationSnapshot();
          reply += `Total Events: ${snap.totalEvents}\n`;
          reply += `Recent Transcripts:\n${snap.recentTranscripts.map(t => `- ${t}`).join('\n')}\n`;
        }
        await interaction.reply(reply || 'Status check complete.');
      }
      else if (commandName === 'debug') {
        const events = this.timeline.getRecentEvents(10);
        const code = JSON.stringify(events, null, 2);
        let replyText = `\`\`\`json\n${code}\n\`\`\``;
        if (replyText.length > 1990) {
          replyText = replyText.slice(0, 1980) + '...\n```';
        }
        await interaction.reply(replyText);
      }
      else if (commandName === 'transcript') {
        const transcripts = this.timeline.getRecentFinalTranscripts(10);
        const text = transcripts.map(t => `**${t.displayName}**: ${t.rawText}`).join('\n');
        let replyText = text || "No transcripts yet.";
        if (replyText.length > 1990) {
          replyText = replyText.slice(0, 1990) + '...';
        }
        await interaction.reply(replyText);
      }
      else if (commandName === 'voice') {
        const selectedSpeaker = interaction.options.getString('speaker', true);
        this.activeVoiceSpeaker = selectedSpeaker;
        await interaction.reply(`🎙️ **Active Voice Model set to:** \`${selectedSpeaker}\`!\nWhen the bot speaks in voice chat, it will attempt to use this person's cloned voice model from Google Drive.`);
      }
      else if (commandName === 'speak') {
        const textToSpeak = interaction.options.getString('text', true);
        const speakerOpt = interaction.options.getString('speaker') || this.activeVoiceSpeaker;
        
        const guild = interaction.guild;
        if (!guild) {
          await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
          return;
        }

        const connection = this.voiceManager.getConnection(guild.id);
        if (!connection) {
          const member = interaction.member as GuildMember;
          const voiceChannel = member?.voice?.channel;
          if (!voiceChannel || !(voiceChannel instanceof VoiceChannel)) {
            await interaction.reply({ content: "Please join a voice channel or run `/join` first!", ephemeral: true });
            return;
          }
          this.voiceManager.connectToChannel(voiceChannel);
        }

        await interaction.deferReply();
        
        // Import LocalTTSProvider dynamically or initialize
        const { LocalTTSProvider } = await import('./tts/LocalTTSProvider');
        const tts = new LocalTTSProvider();
        const audioBuffer = await tts.synthesize(textToSpeak, speakerOpt);

        if (audioBuffer) {
          this.voiceManager.playAudio(guild.id, audioBuffer);
          await interaction.editReply(`🗣️ **Speaking in VC** using \`${speakerOpt}\`'s cloned voice:\n> "${textToSpeak}"`);
        } else {
          await interaction.editReply(`❌ Failed to synthesize audio using speaker \`${speakerOpt}\`. Make sure your Google Colab voice server URL is connected!`);
        }
      }
      else if (commandName === 'voices') {
        const samplesDir = path.join(process.cwd(), 'data', 'voice_samples');
        let speakers: string[] = [];
        if (fs.existsSync(samplesDir)) {
          speakers = fs.readdirSync(samplesDir).filter(f => {
            const full = path.join(samplesDir, f);
            return fs.statSync(full).isDirectory();
          });
        }

        let msg = `🗣️ **Recorded Friend Voice Models (${speakers.length}):**\n`;
        if (speakers.length > 0) {
          msg += speakers.map(s => `- \`${s}\` (Stored & synced to Google Drive)`).join('\n');
          msg += `\n\nUse \`/voice <speaker>\` to select a voice or \`/speak <text> <speaker>\` to speak!`;
        } else {
          msg += `*No individual voice samples recorded yet.* Join a voice channel with \`/join\` and speak to automatically record and sync individual voice samples to Google Drive!`;
        }

        await interaction.reply(msg);
      }
    });
  }

  public async start(token: string) {
    if (!token) throw new Error("Discord token is required.");
    await this.client.login(token);
  }

  public getTimeline(): ConversationTimeline {
    return this.timeline;
  }
}
