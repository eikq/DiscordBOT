import { Client, GatewayIntentBits, Events, VoiceChannel, GuildMember } from 'discord.js';
import { VoiceConnectionManager } from './VoiceConnectionManager';
import { ConversationTimeline } from './timeline/ConversationTimeline';
import { LocalSTTProvider } from './stt/LocalSTTProvider';
import { SpeechToTextProvider } from './stt/SpeechToTextProvider';
import { SocialBrain } from './brain/SocialBrain';
import { AudioReceiver } from './AudioReceiver';
import fs from 'fs';
import path from 'path';
import { VoiceConsentManager } from './voice/VoiceConsentManager';
import { ColabVoiceClient } from './voice/ColabVoiceClient';

export class BotService {
  private client: Client;
  private voiceManager: VoiceConnectionManager;
  private timeline: ConversationTimeline;
  private sttProvider: SpeechToTextProvider;
  private socialBrain: SocialBrain;
  private voiceConsentManager: VoiceConsentManager;
  private colabVoiceClient: ColabVoiceClient;
  private activeReceivers: Map<string, AudioReceiver> = new Map();
  private activeVoiceSpeakers: Map<string, string> = new Map();
  private sessionIdCounter = 1;
  private startPromise: Promise<void> | null = null;

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
    this.voiceConsentManager = new VoiceConsentManager();
    this.colabVoiceClient = new ColabVoiceClient();

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
            description: 'Select a consented Discord user voice for this server',
            options: [
              {
                name: 'user',
                description: 'Consented user whose trained voice should be used',
                type: 6, // USER
                required: true
              }
            ]
          },
          {
            name: 'speak',
            description: 'Make the bot speak text using the configured TTS provider',
            options: [
              {
                name: 'text',
                description: 'Text for the bot to speak',
                type: 3, // STRING
                required: true
              },
              {
                name: 'user',
                description: 'Optional consented user voice to use',
                type: 6, // USER
                required: false
              }
            ]
          },
          {
            name: 'voice-consent',
            description: 'Control recording and voice-model consent for your own voice',
            options: [
              {
                name: 'action',
                description: 'Grant, revoke, inspect, or delete your voice data',
                type: 3,
                required: true,
                choices: [
                  { name: 'grant', value: 'grant' },
                  { name: 'status', value: 'status' },
                  { name: 'revoke', value: 'revoke' },
                  { name: 'delete', value: 'delete' }
                ]
              }
            ]
          },
          {
            name: 'voice-train',
            description: 'Start or inspect your asynchronous Colab RVC training job',
            options: [
              {
                name: 'action',
                description: 'Start training or inspect current state',
                type: 3,
                required: true,
                choices: [
                  { name: 'status', value: 'status' },
                  { name: 'start', value: 'start' }
                ]
              }
            ]
          },
          {
            name: 'voices',
            description: 'Lists locally recorded, consented voice samples'
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

        if (this.activeReceivers.has(voiceChannel.guild.id)) {
          await interaction.reply({ content: "I'm already listening in this server. Use `/leave` before joining again.", ephemeral: true });
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
          this.voiceManager,
          this.voiceConsentManager,
          this.colabVoiceClient,
          guildId => this.activeVoiceSpeakers.get(guildId)
        );
        receiver.startListening();
        this.activeReceivers.set(voiceChannel.guild.id, receiver);

        await interaction.reply(`Joined ${voiceChannel.name} and started listening. Raw voice training samples are captured only for users who run \`/voice-consent grant\`.`);
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
          
          if (process.env.TRANSCRIPT_RETENTION !== 'false') {
            const sessionData = this.timeline.getRecentEvents(1000);
            const dir = path.join(process.cwd(), 'data', 'sessions');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `session_${Date.now()}.json`);
            fs.writeFileSync(file, JSON.stringify(sessionData, null, 2));
            await interaction.reply("Left the voice channel and saved session data.");
          } else {
            this.timeline.clear();
            await interaction.reply("Left the voice channel. Transcript retention is disabled, so session data was not saved.");
          }
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
      else if (commandName === 'voice-consent') {
        const guildId = interaction.guildId;
        if (!guildId) {
          await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
          return;
        }
        const action = interaction.options.getString('action', true);
        const userId = interaction.user.id;
        const displayName = interaction.user.displayName || interaction.user.username;

        if (action === 'grant') {
          this.voiceConsentManager.grant(guildId, userId, displayName);
          const captureState = process.env.RECORD_RAW_AUDIO === 'true'
            ? 'Recording is enabled; your future VC utterances can now become training samples.'
            : 'Your consent is saved, but the bot owner must also set RECORD_RAW_AUDIO=true before samples are captured.';
          await interaction.reply({
            content: `Consent granted for your own voice. ${captureState} Use \`/voice-consent revoke\` to stop future capture or \`/voice-consent delete\` to erase stored samples and models.`,
            ephemeral: true,
          });
        } else if (action === 'status') {
          const record = this.voiceConsentManager.get(guildId, userId);
          await interaction.reply({
            content: record?.active
              ? `Your voice consent is active in this server (granted ${new Date(record.consentedAt).toISOString()}).`
              : 'Your voice consent is not active in this server.',
            ephemeral: true,
          });
        } else if (action === 'revoke') {
          this.voiceConsentManager.revoke(guildId, userId);
          if (this.activeVoiceSpeakers.get(guildId) === userId) this.activeVoiceSpeakers.delete(guildId);
          await interaction.reply({
            content: 'Consent revoked. Future raw voice capture stops in this server. Existing data remains until you run `/voice-consent delete`.',
            ephemeral: true,
          });
        } else if (action === 'delete') {
          await interaction.deferReply({ ephemeral: true });
          this.voiceConsentManager.revokeAll(userId);
          for (const [selectedGuildId, selectedUserId] of this.activeVoiceSpeakers) {
            if (selectedUserId === userId) this.activeVoiceSpeakers.delete(selectedGuildId);
          }
          const localCount = this.voiceConsentManager.deleteLocalSpeakerData(userId);
          let remoteResult = 'Colab is not configured, so only local files were removed.';
          if (this.colabVoiceClient.isConfigured()) {
            try {
              await this.colabVoiceClient.deleteSpeaker(userId);
              remoteResult = 'Google Drive samples, training jobs, and models were deleted through Colab.';
            } catch (error) {
              remoteResult = `Remote deletion failed: ${error instanceof Error ? error.message : String(error)}`;
            }
          }
          await interaction.editReply(`Consent revoked and ${localCount} local WAV file(s) deleted. ${remoteResult}`);
        }
      }
      else if (commandName === 'voice-train') {
        const guildId = interaction.guildId;
        if (!guildId) {
          await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
          return;
        }
        if (!this.voiceConsentManager.hasActiveConsent(guildId, interaction.user.id)) {
          await interaction.reply({ content: 'Run `/voice-consent grant` first.', ephemeral: true });
          return;
        }
        if (!this.colabVoiceClient.isConfigured()) {
          await interaction.reply({ content: 'The Colab URL and COLAB_API_TOKEN are not configured.', ephemeral: true });
          return;
        }

        await interaction.deferReply({ ephemeral: true });
        try {
          const action = interaction.options.getString('action', true);
          const status = action === 'start'
            ? await this.colabVoiceClient.startTraining(interaction.user.id, interaction.user.displayName || interaction.user.username)
            : await this.colabVoiceClient.getStatus(interaction.user.id);
          const job = status.job ? `${status.job.status} (${status.job.id})` : 'none';
          await interaction.editReply(
            `Samples: ${status.sampleCount}, audio: ${status.durationSeconds.toFixed(1)}s, model ready: ${status.modelReady ? 'yes' : 'no'}, job: ${job}.`
          );
        } catch (error) {
          await interaction.editReply(error instanceof Error ? error.message : String(error));
        }
      }
      else if (commandName === 'voice') {
        const guildId = interaction.guildId;
        const selectedUser = interaction.options.getUser('user', true);
        if (!guildId) {
          await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
          return;
        }
        if (!this.voiceConsentManager.hasActiveConsent(guildId, selectedUser.id)) {
          await interaction.reply({ content: `${selectedUser.displayName} has not granted active voice-model consent.`, ephemeral: true });
          return;
        }
        this.activeVoiceSpeakers.set(guildId, selectedUser.id);
        await interaction.reply(`TTS voice set to the trained model for **${selectedUser.displayName}** (${selectedUser.id}).`);
      }
      else if (commandName === 'speak') {
        const textToSpeak = interaction.options.getString('text', true);
        const requestedUser = interaction.options.getUser('user');
        
        const guild = interaction.guild;
        if (!guild) {
          await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
          return;
        }
        const selectedSpeakerId = requestedUser?.id
          || this.activeVoiceSpeakers.get(guild.id)
          || process.env.OWNER_DISCORD_USER_ID;
        if (!selectedSpeakerId && this.colabVoiceClient.isConfigured()) {
          await interaction.reply({ content: 'Select a consented voice with `/voice` or the `user` option first.', ephemeral: true });
          return;
        }
        const speakerId = selectedSpeakerId || 'default';
        if (speakerId !== 'default' && !this.voiceConsentManager.hasActiveConsent(guild.id, speakerId)) {
          await interaction.reply({ content: 'That user does not currently have active voice-model consent.', ephemeral: true });
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
        const audioBuffer = await tts.synthesize(textToSpeak, speakerId);

        if (audioBuffer) {
          const played = await this.voiceManager.playAudio(guild.id, audioBuffer);
          if (played) {
            await interaction.editReply(`Speaking in VC using consented voice model \`${speakerId}\`:\n> "${textToSpeak}"`);
          } else {
            await interaction.editReply(`❌ Audio was generated but Discord playback failed.`);
          }
        } else {
          await interaction.editReply(`Failed to synthesize cloned speech for \`${speakerId}\`. Check the Colab service and training status.`);
        }
      }
      else if (commandName === 'voices') {
        const consented = this.voiceConsentManager.listActive().filter(record => record.guildId === interaction.guildId);
        const unique = [...new Map(consented.map(record => [record.userId, record])).values()];
        let msg = `**Actively consented voices (${unique.length}):**\n`;
        if (unique.length > 0) {
          msg += unique.map(record => `- **${record.displayName}** (\`${record.userId}\`)`).join('\n');
          msg += '\n\nUse `/voice user:@name`; each user can inspect training with `/voice-train status`.';
        } else {
          msg += process.env.RECORD_RAW_AUDIO === 'true'
            ? '*No one has granted voice-model consent yet.*'
            : '*Raw voice recording is disabled and no one has granted voice-model consent.*';
        }

        await interaction.reply(msg);
      }
    });
  }

  public async start(token: string) {
    if (!token) throw new Error("Discord token is required.");
    if (this.client.isReady()) return;
    if (!this.startPromise) {
      this.startPromise = this.client.login(token)
        .then(() => undefined)
        .finally(() => {
          this.startPromise = null;
        });
    }
    await this.startPromise;
  }

  public getTimeline(): ConversationTimeline {
    return this.timeline;
  }

  public getVoiceConsentManager(): VoiceConsentManager {
    return this.voiceConsentManager;
  }

  public getColabVoiceClient(): ColabVoiceClient {
    return this.colabVoiceClient;
  }
}
