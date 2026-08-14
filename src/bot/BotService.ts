import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  TextChannel,
  User,
  VoiceChannel,
} from 'discord.js';
import { VoiceConnectionManager } from './VoiceConnectionManager';
import { ConversationTimeline } from './timeline/ConversationTimeline';
import { LocalSTTProvider } from './stt/LocalSTTProvider';
import { SpeechToTextProvider } from './stt/SpeechToTextProvider';
import { SocialBrain } from './brain/SocialBrain';
import { AudioReceiver } from './AudioReceiver';
import fs from 'fs';
import path from 'path';
import { VoiceConsentManager } from './voice/VoiceConsentManager';
import { VoiceServiceClient } from './voice/VoiceServiceClient';
import { VoiceCaptureTargetManager } from './voice/VoiceCaptureTargetManager';
import { PersonaProfile, PersonaProfileManager } from './personality/PersonaProfileManager';
import { SocialMemoryBrain } from './memory/SocialMemoryBrain';
import {
  decideAutomaticTraining,
  LearningSessionController,
  type LearningSessionRecord,
} from './voice/LearningSessionController';

interface PendingTrainConsent {
  guildId: string;
  requesterId: string;
  targetId: string;
  voiceChannelId: string;
  expiresAt: number;
  timeout: NodeJS.Timeout;
}

export interface DashboardCommandRequest {
  command: 'join' | 'leave' | 'status' | 'debug' | 'transcript' | 'vc-auto-response' | 'voice-consent' | 'voice-target' | 'voice-train' | 'voice-model' | 'train' | 'learning-session' | 'persona' | 'voice' | 'speak' | 'voices';
  guildId?: string;
  voiceChannelId?: string;
  textChannelId?: string;
  userId?: string;
  action?: string;
  text?: string;
  name?: string;
  aliases?: string[];
  description?: string;
  confirm?: boolean;
  trainingMode?: 'fresh' | 'finetune';
  modelSelection?: 'best' | 'latest';
  modelVersionId?: string;
  modelLabel?: string;
  datasetVersionId?: string;
  epochs?: number;
}

export class BotService {
  private client: Client;
  private voiceManager: VoiceConnectionManager;
  private timeline: ConversationTimeline;
  private sttProvider: SpeechToTextProvider;
  private socialBrain: SocialBrain;
  private voiceConsentManager: VoiceConsentManager;
  private voiceServiceClient: VoiceServiceClient;
  private voiceCaptureTargets: VoiceCaptureTargetManager;
  private personaProfiles: PersonaProfileManager;
  private socialMemory: SocialMemoryBrain;
  private learningSessions: LearningSessionController;
  private activeReceivers: Map<string, AudioReceiver> = new Map();
  private activeVoiceSpeakers: Map<string, string> = new Map();
  private pendingTrainConsents = new Map<string, PendingTrainConsent>();
  private learningMonitor?: NodeJS.Timeout;
  private learningMonitorRunning = false;
  private dashboardAudioQueues = new Map<string, Promise<void>>();
  private dashboardAudioQueueDepth = new Map<string, number>();
  private vcAutoResponseEnabled = new Map<string, boolean>();
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
    this.voiceServiceClient = new VoiceServiceClient();
    this.voiceCaptureTargets = new VoiceCaptureTargetManager();
    this.personaProfiles = new PersonaProfileManager();
    this.socialMemory = new SocialMemoryBrain();
    this.learningSessions = new LearningSessionController();
    for (const session of this.learningSessions.listRecent(100)) {
      if (session.status === 'listening') {
        this.voiceCaptureTargets.set(session.guildId, session.targetUserId);
      }
    }

    this.registerEvents();
  }

  private registerEvents() {
    this.client.on(Events.Error, error => {
      console.error('[Bot] Discord client error:', error);
    });

    this.client.on(Events.ClientReady, async () => {
      console.log(`[Bot] Connected as ${this.client.user?.tag}; registering slash commands...`);
      try {
        const defaultSpeakerId = process.env.DEFAULT_SPEAKER_ID?.trim();
        if (defaultSpeakerId) {
          const consent = this.voiceConsentManager.listActive().find(record => record.userId === defaultSpeakerId);
          if (consent) {
            const profile = this.personaProfiles.ensure(defaultSpeakerId, consent.displayName);
            this.socialMemory.registerAliases(profile.userId, profile.displayName, profile.aliases);
          }
        }
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
            description: 'Inspect or revoke your recorded voice consent',
            options: [
              {
                name: 'action',
                description: 'Inspect or revoke your voice consent',
                type: 3,
                required: true,
                choices: [
                  { name: 'status', value: 'status' },
                  { name: 'revoke', value: 'revoke' }
                ]
              }
            ]
          },
          {
            name: 'voice-target',
            description: 'Owner selects which consented user is captured and trained first',
            options: [
              {
                name: 'action',
                description: 'Set, inspect, or clear the active capture target',
                type: 3,
                required: true,
                choices: [
                  { name: 'set', value: 'set' },
                  { name: 'status', value: 'status' },
                  { name: 'clear', value: 'clear' }
                ]
              },
              {
                name: 'user',
                description: 'Consented user to capture when action is set',
                type: 6,
                required: false
              }
            ]
          },
          {
            name: 'voice-train',
            description: 'Start or inspect your asynchronous local RVC training job',
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
              },
              {
                name: 'user',
                description: 'Owner may train a selected consented user; others can train only themselves',
                type: 6,
                required: false
              }
            ]
          },
          {
            name: 'train',
            description: 'Start listening to one person and learn their voice, speech style, and memories',
            options: [
              {
                name: 'target',
                description: 'User whose consented voice should be trained',
                type: 6, // USER
                required: true
              }
            ]
          },
          {
            name: 'stop-train',
            description: 'Stop listening, finalize the clean dataset, and train or fine-tune automatically'
          },
          {
            name: 'train-status',
            description: 'Show live learning quality, clean audio time, and training state'
          },
          {
            name: 'persona',
            description: 'Set the identity and nicknames belonging to a cloned voice',
            options: [
              {
                name: 'user',
                description: 'Consented user whose cloned identity is being configured',
                type: 6,
                required: true
              },
              {
                name: 'name',
                description: 'Name the bot should use for itself, for example Gam',
                type: 3,
                required: true,
                max_length: 80
              },
              {
                name: 'aliases',
                description: 'Comma-separated names friends use, for example Gam,แกม,แก้ม',
                type: 3,
                required: false,
                max_length: 300
              },
              {
                name: 'description',
                description: 'Short personality description for this person',
                type: 3,
                required: false,
                max_length: 500
              }
            ]
          },
          {
            name: 'voices',
            description: 'Lists locally recorded, consented voice samples'
          }
        ];
        await this.client.application?.commands.set(commands);
        console.log(`[Bot] Ready as ${this.client.user?.tag}; slash commands registered.`);
        this.startLearningMonitor();
      } catch (error) {
        console.error('[Bot] Failed to register slash commands:', error);
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      try {
      if (interaction.isButton() && interaction.customId.startsWith('train-consent:')) {
        await this.handleTrainConsentButton(interaction);
        return;
      }
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

        await interaction.deferReply();
        this.ensureVoiceListening(voiceChannel);

        const targetId = this.voiceCaptureTargets.get(voiceChannel.guild.id);
        const captureDescription = targetId
          ? `Only the selected consented target <@${targetId}> will be stored for cloning.`
          : 'No recording target is selected. Use `/train target:@name` to request permission and select one.';
        await interaction.editReply(`Joined ${voiceChannel.name} and started listening. ${captureDescription}`);
      }
      else if (commandName === 'leave') {
        await interaction.deferReply();
        const guildId = interaction.guildId;
        if (!guildId || !interaction.guild) {
          await interaction.editReply('Must be used in a server.');
          return;
        }

        const learningResult = await this.finishLearningSession(guildId, 'voice_channel_left');
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
            await interaction.editReply(`Left the voice channel and saved session data. ${learningResult}`);
          } else {
            this.timeline.clear();
            await interaction.editReply(`Left the voice channel. Transcript retention is disabled. ${learningResult}`);
          }
        } else {
          await interaction.editReply(`I'm not in a voice channel here. ${learningResult}`);
        }
      }
      else if (commandName === 'status') {
        const guildId = interaction.guildId;
        const connection = guildId ? this.voiceManager.getConnection(guildId) : undefined;
        
        let reply = `**Digital Me Status ($0 Recurring API Cost):**\n`;
        reply += `Voice Connection: ${connection ? 'Connected' : 'Disconnected'}\n`;
        if (guildId) {
          const captureTarget = this.voiceCaptureTargets.get(guildId);
          reply += `Voice Capture Target: ${captureTarget ? `<@${captureTarget}>` : 'disabled (conversation only)'}\n`;
          const learningSession = this.learningSessions.getActive(guildId);
          reply += learningSession ? `${this.formatLearningSession(learningSession)}\n` : 'Learning Session: inactive\n';
        }
        
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

        if (action === 'status') {
          const record = this.voiceConsentManager.get(guildId, userId);
          await interaction.reply({
            content: record?.active
              ? `Your voice consent is active in this server (granted ${new Date(record.consentedAt).toISOString()}).`
              : 'Your voice consent is not active in this server.',
            ephemeral: true,
          });
        } else if (action === 'revoke') {
          await interaction.deferReply({ ephemeral: true });
          this.voiceConsentManager.revoke(guildId, userId);
          if (this.activeVoiceSpeakers.get(guildId) === userId) this.activeVoiceSpeakers.delete(guildId);
          const stopped = this.voiceCaptureTargets.get(guildId) === userId
            ? await this.finishLearningSession(guildId, 'consent_revoked', false)
            : 'No active learning session was using this voice.';
          await interaction.editReply(`Consent revoked. Future raw voice capture stops; existing data is retained. ${stopped}`);
        }
      }
      else if (commandName === 'voice-target') {
        const guildId = interaction.guildId;
        if (!guildId) {
          await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
          return;
        }
        if (!this.isOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Only the configured Digital Me owner can select the capture target.', ephemeral: true });
          return;
        }

        const action = interaction.options.getString('action', true);
        if (action === 'status') {
          const targetId = this.voiceCaptureTargets.get(guildId);
          await interaction.reply({
            content: targetId
              ? `The active voice capture target is <@${targetId}>. Only that user's consented utterances are stored.`
              : 'No capture target is selected. Raw training capture is disabled; consented conversation listening remains available.',
            ephemeral: true,
          });
          return;
        }
        if (action === 'clear') {
          await interaction.deferReply({ ephemeral: true });
          const result = await this.finishLearningSession(guildId, 'capture_target_cleared');
          await interaction.editReply(`Voice capture target cleared. ${result}`);
          return;
        }

        const selectedUser = interaction.options.getUser('user');
        if (!selectedUser) {
          await interaction.reply({ content: 'Choose a user when using `/voice-target action:set`.', ephemeral: true });
          return;
        }
        if (selectedUser.bot) {
          await interaction.reply({ content: 'A bot account cannot be used as a voice-cloning target.', ephemeral: true });
          return;
        }
        if (!this.voiceConsentManager.hasActiveConsent(guildId, selectedUser.id)) {
          await interaction.reply({
            content: `${selectedUser.displayName} has not approved recording. Use \`/train target:@name\` so they receive the Allow/Decline prompt.`,
            ephemeral: true,
          });
          return;
        }

        this.voiceCaptureTargets.set(guildId, selectedUser.id);
        await interaction.reply({
          content: `Voice capture target set to **${selectedUser.displayName}**. Only their future consented VC utterances will be stored and uploaded for cloning.`,
          ephemeral: true,
        });
      }
      else if (commandName === 'voice-train') {
        const guildId = interaction.guildId;
        if (!guildId) {
          await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const requestedUser = interaction.options.getUser('user');
        const selectedTargetId = this.isOwner(interaction.user.id)
          ? this.voiceCaptureTargets.get(guildId)
          : undefined;
        const targetUser = requestedUser
          ?? (selectedTargetId ? await this.client.users.fetch(selectedTargetId).catch(() => null) : null)
          ?? interaction.user;
        if (targetUser.id !== interaction.user.id && !this.isOwner(interaction.user.id)) {
          await interaction.editReply('Only the configured owner can start or inspect training for another user.');
          return;
        }
        if (!this.voiceConsentManager.hasActiveConsent(guildId, targetUser.id)) {
          await interaction.editReply(targetUser.id === interaction.user.id
            ? 'Use `/train` and approve the recording prompt first.'
            : `${targetUser.displayName} must approve the recording prompt created by \`/train target:@name\` first.`);
          return;
        }
        if (!this.voiceServiceClient.isConfigured()) {
          await interaction.editReply('The local voice service is not configured. Run `npm run voice:setup` and restart with `npm run start:local`.');
          return;
        }

        try {
          const action = interaction.options.getString('action', true);
          const status = action === 'start'
            ? await this.voiceServiceClient.startTraining(targetUser.id, targetUser.displayName || targetUser.username)
            : await this.voiceServiceClient.getStatus(targetUser.id);
          const job = status.job ? `${status.job.status} (${status.job.id})` : 'none';
          await interaction.editReply(
            `Voice: ${targetUser.displayName}, samples: ${status.sampleCount}, audio: ${status.durationSeconds.toFixed(1)}s, model ready: ${status.modelReady ? 'yes' : 'no'}, job: ${job}.`
          );
        } catch (error) {
          await interaction.editReply(error instanceof Error ? error.message : String(error));
        }
      }
      else if (commandName === 'train') {
        // Acknowledge immediately: Discord invalidates an initial interaction response
        // after only a few seconds, even if local validation is still in progress.
        await interaction.deferReply();
        const guildId = interaction.guildId;
        const guild = interaction.guild;
        if (!guildId || !guild) {
          await interaction.editReply('Use this command inside a Discord server.');
          return;
        }

        const targetUser = interaction.options.getUser('target', true);
        if (targetUser.bot) {
          await interaction.editReply('A bot account cannot be trained as a voice target.');
          return;
        }
        if (targetUser.id !== interaction.user.id && !this.isOwner(interaction.user.id)) {
          await interaction.editReply('Only the configured owner can train another user.');
          return;
        }

        const requester = interaction.member as GuildMember;
        const voiceChannel = requester?.voice?.channel;
        if (!voiceChannel || !(voiceChannel instanceof VoiceChannel)) {
          await interaction.editReply('Join the voice channel you want the bot to enter, then run `/train` again.');
          return;
        }
        const targetMember = guild.members.cache.get(targetUser.id);
        if (!targetMember || targetMember.voice.channelId !== voiceChannel.id) {
          await interaction.editReply(`${targetUser.displayName} must be in the same voice channel as you.`);
          return;
        }
        if (process.env.RECORD_RAW_AUDIO !== 'true') {
          await interaction.editReply('Recording is disabled. Set `RECORD_RAW_AUDIO=true` in `.env`, then restart the bot.');
          return;
        }

        if (this.voiceConsentManager.hasActiveConsent(guildId, targetUser.id)) {
          await interaction.editReply(await this.beginTargetedCapture(
            voiceChannel,
            targetUser,
            interaction.user.id,
            interaction.channelId,
          ));
          return;
        }

        const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const row = this.createTrainConsentButtons(nonce);
        const timeout = setTimeout(() => {
          this.pendingTrainConsents.delete(nonce);
          void interaction.editReply({
            content: `Recording request for <@${targetUser.id}> expired. Run \`/train\` again if they want to continue.`,
            components: [],
          }).catch(() => undefined);
        }, 5 * 60_000);
        this.pendingTrainConsents.set(nonce, {
          guildId,
          requesterId: interaction.user.id,
          targetId: targetUser.id,
          voiceChannelId: voiceChannel.id,
          expiresAt: Date.now() + 5 * 60_000,
          timeout,
        });
        await interaction.editReply({
          content: `🎙️ <@${targetUser.id}>, <@${interaction.user.id}> wants the bot to record and transcribe only your voice, save WAV/TXT/JSON files locally, and train a private voice model. Do you allow this?`,
          components: [row],
          allowedMentions: { users: [targetUser.id, interaction.user.id] },
        });
      }
      else if (commandName === 'stop-train') {
        await interaction.deferReply();
        const guildId = interaction.guildId;
        if (!guildId) {
          await interaction.editReply('Use this command inside a Discord server.');
          return;
        }
        if (!this.isOwner(interaction.user.id)) {
          await interaction.editReply('Only the configured Digital Me owner can stop a learning session.');
          return;
        }
        await interaction.editReply(await this.finishLearningSession(guildId, 'slash_command'));
      }
      else if (commandName === 'train-status') {
        const guildId = interaction.guildId;
        if (!guildId) {
          await interaction.reply({ content: 'Use this command inside a Discord server.', ephemeral: true });
          return;
        }
        const session = this.learningSessions.getActive(guildId)
          ?? this.learningSessions.listRecent(20).find(item => item.guildId === guildId)
          ?? null;
        await interaction.reply({
          content: session ? this.formatLearningSession(session) : 'No learning session has been started in this server yet.',
          ephemeral: true,
        });
      }
      else if (commandName === 'persona') {
        const guildId = interaction.guildId;
        const selectedUser = interaction.options.getUser('user', true);
        if (!guildId) {
          await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
          return;
        }
        if (!this.isOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Only the configured owner can change a cloned identity.', ephemeral: true });
          return;
        }
        if (!this.voiceConsentManager.hasActiveConsent(guildId, selectedUser.id)) {
          await interaction.reply({ content: `${selectedUser.displayName} has not granted active voice-model consent.`, ephemeral: true });
          return;
        }

        const name = interaction.options.getString('name', true);
        const aliases = (interaction.options.getString('aliases') || '')
          .split(',')
          .map(alias => alias.trim())
          .filter(Boolean);
        const description = interaction.options.getString('description') || '';
        const profile = this.personaProfiles.save(selectedUser.id, name, aliases, description);
        this.socialMemory.registerAliases(profile.userId, profile.displayName, profile.aliases);
        this.activeVoiceSpeakers.set(guildId, selectedUser.id);
        await interaction.reply(
          `Selected **${selectedUser.displayName}** as the active cloned voice and identity. `
          + `I now know myself as **${profile.displayName}** and respond to: ${profile.aliases.map(alias => `\`${alias}\``).join(', ')}.`
        );
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
        const profile = this.personaProfiles.ensure(selectedUser.id, selectedUser.displayName);
        this.socialMemory.registerAliases(profile.userId, profile.displayName, profile.aliases);
        this.activeVoiceSpeakers.set(guildId, selectedUser.id);
        await interaction.reply(
          `TTS voice and identity set to **${profile.displayName}** (${selectedUser.id}). `
          + `Self aliases: ${profile.aliases.map(alias => `\`${alias}\``).join(', ')}.`
        );
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
          || process.env.DEFAULT_SPEAKER_ID
          || process.env.OWNER_DISCORD_USER_ID;
        if (!selectedSpeakerId && this.voiceServiceClient.isConfigured()) {
          await interaction.reply({ content: 'Select a consented voice with `/voice` or the `user` option first.', ephemeral: true });
          return;
        }
        const speakerId = selectedSpeakerId || 'default';
        if (speakerId !== 'default' && !this.voiceConsentManager.hasActiveConsent(guild.id, speakerId)) {
          await interaction.reply({ content: 'That user does not currently have active voice-model consent.', ephemeral: true });
          return;
        }

        const connection = this.voiceManager.getConnection(guild.id);
        let voiceChannelToJoin: VoiceChannel | undefined;
        if (!connection) {
          const member = interaction.member as GuildMember;
          const voiceChannel = member?.voice?.channel;
          if (!voiceChannel || !(voiceChannel instanceof VoiceChannel)) {
            await interaction.reply({ content: "Please join a voice channel or run `/join` first!", ephemeral: true });
            return;
          }
          voiceChannelToJoin = voiceChannel;
        }

        await interaction.deferReply();
        if (voiceChannelToJoin) this.voiceManager.connectToChannel(voiceChannelToJoin);
        
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
          await interaction.editReply(`Failed to synthesize cloned speech for \`${speakerId}\`. Check the local voice service and training status.`);
        }
      }
      else if (commandName === 'voices') {
        const consented = this.voiceConsentManager.listActive().filter(record => record.guildId === interaction.guildId);
        const unique = [...new Map(consented.map(record => [record.userId, record])).values()];
        let msg = `**Actively consented voices (${unique.length}):**\n`;
        if (unique.length > 0) {
          msg += unique.map(record => `- **${record.displayName}** (\`${record.userId}\`)`).join('\n');
          msg += '\n\nUse `/train target:@name` to start a consented recording and training session.';
        } else {
          msg += process.env.RECORD_RAW_AUDIO === 'true'
            ? '*No one has approved a `/train` recording request yet.*'
            : '*Raw voice recording is disabled and no one has approved a recording request.*';
        }

        await interaction.reply(msg);
      }
      } catch (error) {
        if (this.isUnknownInteractionError(error)) {
          const ageMs = Date.now() - interaction.createdTimestamp;
          console.warn(
            `[Bot] Discord expired interaction ${interaction.id} after ${ageMs}ms. `
            + 'Wait for the "slash commands registered" readiness message, then run the command again.'
          );
          return;
        }
        console.error('[Bot] Interaction handler failed:', error);
      }
    });
  }

  private isUnknownInteractionError(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code?: unknown }).code === 10062;
  }

  private createTrainConsentButtons(nonce: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`train-consent:allow:${nonce}`)
        .setLabel('Allow recording and training')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`train-consent:decline:${nonce}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger),
    );
  }

  private async handleTrainConsentButton(interaction: ButtonInteraction): Promise<void> {
    const [, action, nonce] = interaction.customId.split(':');
    const pending = nonce ? this.pendingTrainConsents.get(nonce) : undefined;
    if (!pending || pending.expiresAt <= Date.now()) {
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingTrainConsents.delete(nonce);
      }
      await interaction.reply({ content: 'This recording request expired. Ask the owner to run `/train` again.', ephemeral: true });
      return;
    }
    if (interaction.user.id !== pending.targetId) {
      await interaction.reply({ content: 'Only the tagged person can answer this recording request.', ephemeral: true });
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingTrainConsents.delete(nonce);

    if (action === 'decline') {
      await interaction.update({
        content: `❌ <@${pending.targetId}> declined recording, transcription, and voice training. Nothing was started.`,
        components: [],
        allowedMentions: { users: [pending.targetId] },
      });
      return;
    }
    if (action !== 'allow') {
      await interaction.reply({ content: 'Unknown recording-consent action.', ephemeral: true });
      return;
    }

    const guild = interaction.guild;
    const voiceChannel = guild?.channels.cache.get(pending.voiceChannelId);
    const targetMember = guild?.members.cache.get(pending.targetId) ?? null;
    if (!guild || guild.id !== pending.guildId || !(voiceChannel instanceof VoiceChannel)) {
      await interaction.update({ content: 'The requested voice channel is no longer available. Run `/train` again.', components: [] });
      return;
    }
    if (!targetMember || targetMember.voice.channelId !== voiceChannel.id) {
      await interaction.update({
        content: `<@${pending.targetId}> approved, but they left the requested voice channel. Rejoin it and run \`/train\` again.`,
        components: [],
        allowedMentions: { users: [pending.targetId] },
      });
      return;
    }

    this.voiceConsentManager.grant(
      pending.guildId,
      pending.targetId,
      interaction.user.displayName || interaction.user.username,
    );
    await interaction.update({
      content: `✅ <@${pending.targetId}> explicitly allowed recording, transcription, and local voice-model training.`,
      components: [],
      allowedMentions: { users: [pending.targetId] },
    });

    try {
      await interaction.followUp({
        content: await this.beginTargetedCapture(
          voiceChannel,
          interaction.user,
          pending.requesterId,
          interaction.channelId,
        ),
        allowedMentions: { users: [pending.targetId] },
      });
    } catch (error) {
      await interaction.followUp({
        content: `Permission was saved, but listening could not start: ${error instanceof Error ? error.message : String(error)}`,
        ephemeral: true,
      });
    }
  }

  private isVcAutoResponseEnabled(guildId: string): boolean {
    return this.vcAutoResponseEnabled.get(guildId) ?? process.env.VC_AUTO_RESPONSE_DEFAULT !== 'false';
  }

  private summarizeLearningSession(session: LearningSessionRecord | null | undefined) {
    if (!session) return null;
    const { utterances, ...summary } = session;
    return { ...summary, utteranceCount: utterances.length };
  }

  private ensureVoiceListening(voiceChannel: VoiceChannel): boolean {
    const guildId = voiceChannel.guild.id;
    const existingConnection = this.voiceManager.getConnection(guildId);
    if (this.activeReceivers.has(guildId) && existingConnection) {
      if (existingConnection.joinConfig.channelId !== voiceChannel.id) {
        throw new Error('The bot is already listening in another voice channel. Use `/leave` there first.');
      }
      return false;
    }
    if (this.activeReceivers.has(guildId) && !existingConnection) {
      this.activeReceivers.delete(guildId);
    }
    if (existingConnection && existingConnection.joinConfig.channelId !== voiceChannel.id) {
      throw new Error('The bot is already connected to another voice channel. Use `/leave` there first.');
    }

    const connection = existingConnection ?? this.voiceManager.connectToChannel(voiceChannel);
    const sessionId = `sess_${this.sessionIdCounter++}`;
    this.timeline.clear();
    this.timeline.addEvent({
      type: 'VOICE_SESSION_STARTED',
      sessionId,
      guildId,
      channelId: voiceChannel.id,
      timestamp: Date.now(),
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
      this.voiceServiceClient,
      selectedGuildId => this.activeVoiceSpeakers.get(selectedGuildId),
      selectedGuildId => this.voiceCaptureTargets.get(selectedGuildId),
      selectedGuildId => this.personaForGuild(selectedGuildId),
      this.socialMemory,
      selectedGuildId => {
        const learning = this.learningSessions.getActive(selectedGuildId);
        return learning ? { id: learning.id, targetUserId: learning.targetUserId } : null;
      },
      (selectedGuildId, record) => {
        this.learningSessions.recordUtterance(selectedGuildId, record);
        this.socialMemory.recordVoiceStyle(record);
      },
      selectedGuildId => this.isVcAutoResponseEnabled(selectedGuildId),
    );
    receiver.startListening();
    this.activeReceivers.set(guildId, receiver);
    return true;
  }

  private async beginTargetedCapture(
    voiceChannel: VoiceChannel,
    targetUser: User,
    startedByUserId: string,
    notificationChannelId?: string,
  ): Promise<string> {
    const guildId = voiceChannel.guild.id;
    if (!this.voiceConsentManager.hasActiveConsent(guildId, targetUser.id)) {
      throw new Error('The selected person has not approved recording.');
    }
    const existingLearning = this.learningSessions.getActive(guildId);
    if (existingLearning && existingLearning.targetUserId !== targetUser.id) {
      throw new Error(`The bot is already learning ${existingLearning.targetDisplayName}. Stop that session first.`);
    }
    const joined = this.ensureVoiceListening(voiceChannel);
    const learningSession = this.learningSessions.start({
      guildId,
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      targetDisplayName: targetUser.displayName || targetUser.username,
      startedByUserId,
      notificationChannelId,
    });
    this.voiceCaptureTargets.set(guildId, targetUser.id);

    let trainingState = 'When you run `/stop-train`, the clean dataset will be frozen and training or fine-tuning will be selected automatically.';
    try {
      const status = await this.voiceServiceClient.getStatus(targetUser.id);
      if (status.job) {
        trainingState = `Training job ${status.job.status}; ${status.durationSeconds.toFixed(1)} clean seconds are stored.`;
      } else if (status.modelReady) {
        trainingState = `A model is ready. This session will fine-tune it after enough new clean speech is collected.`;
      } else {
        trainingState = `${status.durationSeconds.toFixed(1)} clean seconds are stored. The first model needs ${this.minimumFreshTrainingSeconds()} seconds.`;
      }
    } catch (error) {
      trainingState = `The recorder is active, but training status is temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }

    return [
      `🔴 **RECORDING AND TRANSCRIBING NOTICE**`,
      `The bot ${joined ? 'joined' : 'is listening in'} **${voiceChannel.name}** and will save audio only from <@${targetUser.id}>.`,
      `Learning session: \`${learningSession.id}\`. Each utterance gets WAV/TXT/JSON plus automatic quality and speaking-style analysis.`,
      trainingState,
      'Use `/train-status` at any time. Use `/stop-train` to stop, build the versioned clean dataset, and begin the next training step.',
    ].join('\n');
  }

  public async getDashboardControlState() {
    const voiceStatuses = this.voiceServiceClient.isConfigured()
      ? await this.voiceServiceClient.listVoices().catch(() => [])
      : [];
    await this.refreshLearningTrainingStates(voiceStatuses);
    const consents = this.voiceConsentManager.listActive();
    const guilds = this.client.guilds.cache.map(guild => {
      const voiceChannels = guild.channels.cache
        .filter(channel => channel instanceof VoiceChannel)
        .map(channel => ({ id: channel.id, name: channel.name }));
      const textChannels = guild.channels.cache
        .filter(channel => channel instanceof TextChannel)
        .map(channel => ({ id: channel.id, name: channel.name }));
      const notificationChannels = [
        ...textChannels.map(channel => ({ ...channel, kind: 'text' as const })),
        ...voiceChannels.map(channel => ({ ...channel, kind: 'voice' as const })),
      ];
      const guildConsents = consents.filter(record => record.guildId === guild.id);
      const members = new Map<string, { id: string; name: string; bot: boolean; consented: boolean }>();
      for (const member of guild.members.cache.values()) {
        members.set(member.id, {
          id: member.id,
          name: member.displayName || member.user.displayName || member.user.username,
          bot: member.user.bot,
          consented: guildConsents.some(record => record.userId === member.id),
        });
      }
      for (const record of guildConsents) {
        if (!members.has(record.userId)) members.set(record.userId, { id: record.userId, name: record.displayName, bot: false, consented: true });
      }
      const connected = this.voiceManager.getConnection(guild.id);
      const vcAutoResponseEnabled = this.isVcAutoResponseEnabled(guild.id);
      const selectedVoiceId = this.activeVoiceSpeakers.get(guild.id) || process.env.DEFAULT_SPEAKER_ID?.trim() || null;
      return {
        id: guild.id,
        name: guild.name,
        voiceChannels,
        textChannels,
        notificationChannels,
        connectedVoiceChannelId: connected?.joinConfig.channelId || null,
        receiverState: this.activeReceivers.has(guild.id) && !vcAutoResponseEnabled
          ? 'PAUSED'
          : this.activeReceivers.get(guild.id)?.getState() || 'OFFLINE',
        vcAutoResponseEnabled,
        captureTargetId: this.voiceCaptureTargets.get(guild.id) || null,
        learningSession: this.summarizeLearningSession(
          this.learningSessions.getActive(guild.id)
            ?? this.learningSessions.listRecent(30).find(session => session.guildId === guild.id),
        ),
        selectedVoiceId,
        persona: selectedVoiceId ? this.personaForGuild(guild.id) : null,
        members: [...members.values()].filter(member => !member.bot).sort((a, b) => a.name.localeCompare(b.name)),
        consentedUsers: guildConsents.map(record => ({
          ...record,
          voice: voiceStatuses.find(status => status.speakerId === record.userId) || null,
          persona: this.personaProfiles.get(record.userId),
        })),
      };
    });
    return {
      ready: this.client.isReady(),
      botTag: this.client.user?.tag || null,
      guilds,
      voices: voiceStatuses,
      personas: this.personaProfiles.list(),
      recentTranscripts: this.timeline.getRecentFinalTranscripts(25),
      recentEvents: this.timeline.getRecentEvents(25),
      learningSessions: this.learningSessions.listRecent(30).map(session => this.summarizeLearningSession(session)),
    };
  }

  public async executeDashboardCommand(request: DashboardCommandRequest): Promise<{ message: string; data?: unknown }> {
    if (!this.client.isReady()) throw new Error('The Discord bot is not connected yet.');
    if (request.command === 'status') {
      return { message: 'Dashboard state refreshed.', data: await this.getDashboardControlState() };
    }
    if (request.command === 'debug') {
      return { message: 'Loaded recent debug events.', data: this.timeline.getRecentEvents(50) };
    }
    if (request.command === 'transcript') {
      return { message: 'Loaded recent transcripts.', data: this.timeline.getRecentFinalTranscripts(50) };
    }
    if (request.command === 'voices') {
      return { message: 'Loaded consented cloned voices.', data: await this.voiceServiceClient.listVoices() };
    }

    const guildId = request.guildId?.trim();
    if (!guildId) throw new Error('Choose a Discord server first.');
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('The selected Discord server is unavailable.');

    if (request.command === 'join') {
      const channel = guild.channels.cache.get(request.voiceChannelId || '');
      if (!(channel instanceof VoiceChannel)) throw new Error('Choose a voice channel first.');
      const joined = this.ensureVoiceListening(channel);
      return { message: joined ? `Joined ${channel.name} and started listening.` : `Already listening in ${channel.name}.` };
    }

    if (request.command === 'leave') {
      const learningResult = await this.finishLearningSession(guildId, 'dashboard_leave');
      const left = this.voiceManager.disconnect(guild);
      this.activeReceivers.delete(guildId);
      if (!left) return { message: `The bot was not connected to a voice channel. ${learningResult}` };
      this.timeline.addEvent({ type: 'VOICE_SESSION_ENDED', sessionId: `sess_${this.sessionIdCounter - 1}`, timestamp: Date.now() });
      if (process.env.TRANSCRIPT_RETENTION !== 'false') {
        const dir = path.join(process.cwd(), 'data', 'sessions');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `session_${Date.now()}.json`), JSON.stringify(this.timeline.getRecentEvents(1000), null, 2));
      } else {
        this.timeline.clear();
      }
      return { message: `Left the voice channel and finalized the session. ${learningResult}` };
    }

    if (request.command === 'vc-auto-response') {
      const enabled = request.action === 'resume';
      if (request.action !== 'pause' && request.action !== 'resume') {
        return {
          message: this.isVcAutoResponseEnabled(guildId)
            ? 'VC automatic responses and background speech processing are enabled.'
            : 'VC automatic responses and background speech processing are paused.',
          data: { enabled: this.isVcAutoResponseEnabled(guildId) },
        };
      }
      this.vcAutoResponseEnabled.set(guildId, enabled);
      if (!enabled) this.activeReceivers.get(guildId)?.pauseBackgroundProcessing(guildId);
      return {
        message: enabled
          ? 'VC AI resumed. The next spoken utterance can use STT, memory, LLM, and automatic replies again.'
          : 'VC AI paused. Audio decoding, STT, training capture, memory analysis, LLM, and automatic replies are stopped; Discord voice-changer playback remains available.',
        data: { enabled },
      };
    }

    if (request.command === 'voice-consent') {
      const userId = this.requireDashboardUser(request.userId);
      const action = request.action || 'status';
      if (action === 'status') {
        const record = this.voiceConsentManager.get(guildId, userId);
        return { message: record?.active ? `Consent is active for ${record.displayName}.` : 'Consent is not active for this user.', data: record };
      }
      if (action === 'revoke') {
        this.voiceConsentManager.revoke(guildId, userId);
        if (this.activeVoiceSpeakers.get(guildId) === userId) this.activeVoiceSpeakers.delete(guildId);
        const stopped = this.voiceCaptureTargets.get(guildId) === userId
          ? await this.finishLearningSession(guildId, 'dashboard_consent_revoked', false)
          : 'No active learning session was using this voice.';
        return { message: `Consent revoked. Existing local data was retained. ${stopped}` };
      }
      throw new Error('Unsupported consent action.');
    }

    if (request.command === 'voice-target') {
      const action = request.action || 'status';
      if (action === 'status') {
        const targetId = this.voiceCaptureTargets.get(guildId) || null;
        return { message: targetId ? `Raw training capture targets ${targetId}.` : 'Raw training capture is disabled until a target is selected.', data: { targetId } };
      }
      if (action === 'clear') {
        return { message: await this.finishLearningSession(guildId, 'dashboard_capture_clear') };
      }
      const userId = this.requireDashboardUser(request.userId);
      if (!this.voiceConsentManager.hasActiveConsent(guildId, userId)) throw new Error('That user has not granted active voice consent.');
      this.voiceCaptureTargets.set(guildId, userId);
      return { message: `Raw training capture now targets ${userId}.` };
    }

    if (request.command === 'voice-train') {
      const userId = this.requireDashboardUser(request.userId);
      const consent = this.voiceConsentManager.get(guildId, userId);
      if (!consent?.active) throw new Error('That user has not granted active voice consent.');
      if (request.action === 'stop') {
        const status = await this.voiceServiceClient.stopTrainingAfterCurrentEpoch(userId);
        const stopEpoch = status.job?.stopAfterEpoch;
        return {
          message: stopEpoch
            ? `Stop requested. The current model will be published after epoch ${stopEpoch} finishes.`
            : 'Stop requested. The current epoch will finish before Best and Latest are published.',
          data: status,
        };
      }
      if (request.action !== 'start') {
        return { message: 'Training status refreshed.', data: await this.voiceServiceClient.getStatus(userId) };
      }
      const trainingMode = request.trainingMode === 'finetune' ? 'finetune' : 'fresh';
      const modelSelection = request.modelSelection === 'latest' ? 'latest' : 'best';
      const defaultEpochs = Number(process.env.RVC_EPOCHS || 100);
      const epochs = request.epochs ?? defaultEpochs;
      if (!Number.isInteger(epochs) || epochs < 1 || epochs > 1200) {
        throw new Error('Epochs must be a whole number between 1 and 1200.');
      }
      const status = await this.voiceServiceClient.startTraining(userId, consent.displayName, {
        trainingMode,
        modelSelection,
        epochs,
        datasetVersionId: request.datasetVersionId,
        modelLabel: request.modelLabel,
      });
      const modeLabel = trainingMode === 'finetune'
        ? `fine-tune from ${modelSelection}`
        : 'fresh model';
      return { message: `${epochs}-epoch ${modeLabel} job queued for ${consent.displayName}.`, data: status };
    }

    if (request.command === 'voice-model') {
      const userId = this.requireDashboardUser(request.userId);
      const consent = this.voiceConsentManager.get(guildId, userId);
      if (!consent?.active) throw new Error('That user has not granted active voice consent.');
      const modelSelection = request.modelSelection === 'latest' ? 'latest' : 'best';
      const status = await this.voiceServiceClient.selectActiveModel(userId, modelSelection, request.modelVersionId);
      return {
        message: `${status.activeModelLabel || 'Selected model'} · ${modelSelection === 'best' ? 'Best' : 'Latest'} is now active for ${consent.displayName}.`,
        data: status,
      };
    }

    if (request.command === 'learning-session') {
      if (request.action === 'stop') {
        return { message: await this.finishLearningSession(guildId, 'dashboard_stop') };
      }
      const session = this.learningSessions.getActive(guildId)
        ?? this.learningSessions.listRecent(30).find(item => item.guildId === guildId)
        ?? null;
      return {
        message: session ? this.formatLearningSession(session) : 'No learning session has been started in this server yet.',
        data: session,
      };
    }

    if (request.command === 'voice') {
      const userId = this.requireDashboardUser(request.userId);
      const consent = this.voiceConsentManager.get(guildId, userId);
      if (!consent?.active) throw new Error('That user has not granted active voice consent.');
      const profile = this.personaProfiles.ensure(userId, consent.displayName);
      this.socialMemory.registerAliases(profile.userId, profile.displayName, profile.aliases);
      this.activeVoiceSpeakers.set(guildId, userId);
      return { message: `Voice and identity selected: ${profile.displayName}.`, data: profile };
    }

    if (request.command === 'persona') {
      const userId = this.requireDashboardUser(request.userId);
      if (!this.voiceConsentManager.hasActiveConsent(guildId, userId)) throw new Error('That user has not granted active voice consent.');
      const profile = this.personaProfiles.save(userId, request.name || '', request.aliases || [], request.description || '');
      this.socialMemory.registerAliases(profile.userId, profile.displayName, profile.aliases);
      this.activeVoiceSpeakers.set(guildId, userId);
      return { message: `Voice and persona selected as ${profile.displayName}.`, data: profile };
    }

    if (request.command === 'speak') {
      const text = request.text?.trim();
      if (!text) throw new Error('Enter text for the bot to speak.');
      const userId = request.userId || this.activeVoiceSpeakers.get(guildId) || process.env.DEFAULT_SPEAKER_ID?.trim();
      if (!userId || !this.voiceConsentManager.hasActiveConsent(guildId, userId)) throw new Error('Choose an actively consented cloned voice.');
      if (!this.voiceManager.getConnection(guildId)) {
        const channel = guild.channels.cache.get(request.voiceChannelId || '');
        if (!(channel instanceof VoiceChannel)) throw new Error('Choose a voice channel first.');
        this.voiceManager.connectToChannel(channel);
      }
      const { LocalTTSProvider } = await import('./tts/LocalTTSProvider');
      const inferredTone = /[?？]$/u.test(text)
        ? 'curious'
        : /[!！]|555+|ฮ่า|เย่|โห|เฮ้ย/u.test(text)
          ? 'excited'
          : 'casual';
      const audio = await new LocalTTSProvider().synthesize(text, userId, {
        tone: inferredTone,
        action: 'DASHBOARD_SPEAK',
        speechAct: inferredTone === 'curious' ? 'question' : 'statement',
        emotion: inferredTone,
        intensity: inferredTone === 'excited' ? 0.78 : 0.44,
        pace: 1,
        energy: inferredTone === 'excited' ? 0.76 : 0.48,
        variation: 0.62,
        variationSeed: `dashboard:${Date.now()}:${Math.random()}`,
      });
      if (!audio || !await this.voiceManager.playAudio(guildId, audio)) throw new Error('Cloned speech could not be generated or played.');
      return { message: `Spoke as ${this.personaProfiles.resolve(userId, userId).displayName}.` };
    }

    if (request.command === 'train') {
      const userId = this.requireDashboardUser(request.userId);
      const voiceChannel = guild.channels.cache.get(request.voiceChannelId || '');
      const notificationChannel = guild.channels.cache.get(request.textChannelId || '');
      if (!(voiceChannel instanceof VoiceChannel)) throw new Error('Choose the shared voice channel.');
      if (!(notificationChannel instanceof TextChannel) && !(notificationChannel instanceof VoiceChannel)) {
        throw new Error('Choose a text channel or voice-channel chat for the consent request.');
      }
      const targetMember = await guild.members.fetch(userId).catch(() => null);
      if (!targetMember || targetMember.user.bot) throw new Error('The selected human member is unavailable.');
      if (targetMember.voice.channelId !== voiceChannel.id) throw new Error('The selected member must already be in that voice channel.');
      const requesterId = process.env.OWNER_DISCORD_USER_ID?.trim();
      if (!requesterId) throw new Error('OWNER_DISCORD_USER_ID is not configured.');
      if (this.voiceConsentManager.hasActiveConsent(guildId, userId)) {
        await notificationChannel.send({
          content: `🎙️ **LEARNING SESSION STARTED** — The bot is now recording and transcribing only <@${userId}> in **${voiceChannel.name}**. Run \`/stop-train\` or use the dashboard to stop and process the dataset.`,
          allowedMentions: { users: [userId] },
        });
        const message = await this.beginTargetedCapture(
          voiceChannel,
          targetMember.user,
          requesterId,
          notificationChannel.id,
        );
        return { message, data: this.learningSessions.getActive(guildId) };
      }
      const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const row = this.createTrainConsentButtons(nonce);
      const message = await notificationChannel.send({
        content: `🎙️ <@${userId}>, <@${requesterId}> wants the bot to record and transcribe only your voice, save WAV/TXT/JSON files locally, and train a private voice model. Do you allow this?`,
        components: [row],
        allowedMentions: { users: [userId, requesterId] },
      });
      const timeout = setTimeout(() => {
        this.pendingTrainConsents.delete(nonce);
        void message.edit({ content: `Recording request for <@${userId}> expired. Start it again from the dashboard if they want to continue.`, components: [] }).catch(() => undefined);
      }, 5 * 60_000);
      this.pendingTrainConsents.set(nonce, {
        guildId, requesterId, targetId: userId, voiceChannelId: voiceChannel.id,
        expiresAt: Date.now() + 5 * 60_000, timeout,
      });
      const destination = notificationChannel instanceof VoiceChannel
        ? `${notificationChannel.name} voice chat`
        : `#${notificationChannel.name}`;
      return { message: `Consent request sent to ${destination}.` };
    }

    throw new Error('Unsupported dashboard command.');
  }

  public queueDashboardAudio(guildId: string, voiceChannelId: string, audioBuffer: Buffer): number {
    if (!this.client.isReady()) throw new Error('The Discord bot is not connected yet.');
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('The selected Discord server is unavailable.');
    const channel = guild.channels.cache.get(voiceChannelId);
    if (!(channel instanceof VoiceChannel)) throw new Error('Choose a Discord voice channel for voice-changer playback.');
    const currentDepth = this.dashboardAudioQueueDepth.get(guildId) || 0;
    if (currentDepth >= 6) throw new Error('The Discord voice-changer queue is full. Wait for it to catch up.');
    const connection = this.voiceManager.getConnection(guildId);
    if (!connection || connection.joinConfig.channelId !== voiceChannelId) this.voiceManager.connectToChannel(channel);

    const previous = this.dashboardAudioQueues.get(guildId) || Promise.resolve();
    const queuedPosition = currentDepth + 1;
    this.dashboardAudioQueueDepth.set(guildId, queuedPosition);
    const next = previous
      .catch(error => console.error('[Voice Changer] Previous Discord playback failed:', error))
      .then(async () => {
        const played = await this.voiceManager.playAudio(guildId, audioBuffer, { silencePaddingFrames: 2 });
        if (!played) throw new Error('Discord did not finish the converted audio playback.');
      })
      .catch(error => console.error('[Voice Changer] Discord playback failed:', error))
      .finally(() => {
        this.dashboardAudioQueueDepth.set(guildId, Math.max(0, (this.dashboardAudioQueueDepth.get(guildId) || 1) - 1));
        if (this.dashboardAudioQueues.get(guildId) === next) this.dashboardAudioQueues.delete(guildId);
      });
    this.dashboardAudioQueues.set(guildId, next);
    return queuedPosition;
  }

  private async finishLearningSession(guildId: string, reason: string, queueTraining = true): Promise<string> {
    const active = this.learningSessions.getActive(guildId);
    if (!active) {
      this.voiceCaptureTargets.clear(guildId);
      return 'No active learning session was running.';
    }

    await this.activeReceivers.get(guildId)?.flushPendingWrites();
    const stopped = this.learningSessions.stop(guildId, reason);
    this.voiceCaptureTargets.clear(guildId);
    if (!stopped) return 'No active learning session was running.';

    const summary = `${stopped.counters.acceptedVoiceSeconds.toFixed(1)} clean seconds from `
      + `${stopped.counters.acceptedVoiceClips}/${stopped.counters.capturedClips} clips`;
    if (!queueTraining) {
      this.learningSessions.setTrainingDecision(stopped.id, {
        decision: 'none',
        reason: 'Capture ended without automatic training.',
        status: 'interrupted',
      });
      return await this.publishLearningResult(stopped, `Learning stopped and dataset ${stopped.datasetVersionId} was saved (${summary}).`);
    }
    if (!this.voiceServiceClient.isConfigured()) {
      this.learningSessions.markFailed(stopped.id, 'The local voice service is not configured.');
      return await this.publishLearningResult(stopped, `Dataset ${stopped.datasetVersionId} was saved (${summary}), but the voice service is offline.`);
    }

    try {
      const status = await this.voiceServiceClient.getStatus(stopped.targetUserId);
      const decision = decideAutomaticTraining({
        modelReady: status.modelReady,
        serviceDurationSeconds: status.durationSeconds,
        newAcceptedSeconds: stopped.counters.acceptedVoiceSeconds,
        jobStatus: status.job?.status ?? null,
        minimumFreshSeconds: this.minimumFreshTrainingSeconds(),
        minimumFinetuneSeconds: this.minimumFinetuneSeconds(),
      });
      if (decision.action === 'wait') {
        this.learningSessions.setTrainingDecision(stopped.id, {
          decision: 'wait',
          reason: decision.reason,
          jobId: status.job?.id,
          status: 'training',
        });
        return await this.publishLearningResult(stopped, `Dataset ${stopped.datasetVersionId} was saved (${summary}). ${decision.reason}`);
      }
      if (decision.action === 'none') {
        this.learningSessions.setTrainingDecision(stopped.id, {
          decision: 'none',
          reason: decision.reason,
          status: 'insufficient_data',
        });
        return await this.publishLearningResult(stopped, `Dataset ${stopped.datasetVersionId} was saved (${summary}). ${decision.reason}`);
      }

      const epochs = decision.action === 'finetune'
        ? this.readIntegerEnvironment('LEARNING_FINETUNE_EPOCHS', 35, 1, 1_200)
        : this.readIntegerEnvironment('RVC_EPOCHS', 100, 1, 1_200);
      const training = await this.voiceServiceClient.startTraining(
        stopped.targetUserId,
        stopped.targetDisplayName,
        {
          trainingMode: decision.action,
          modelSelection: 'best',
          epochs,
          datasetVersionId: stopped.datasetVersionId,
          learningSessionId: stopped.id,
        },
      );
      this.learningSessions.setTrainingDecision(stopped.id, {
        decision: decision.action,
        reason: decision.reason,
        modelSelection: 'best',
        epochs,
        jobId: training.job?.id,
        status: 'training',
      });
      return await this.publishLearningResult(
        stopped,
        `Dataset ${stopped.datasetVersionId} was saved (${summary}). `
          + `${decision.action === 'finetune' ? 'Fine-tuning the best model' : 'Training a new model'} for ${epochs} epochs now.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.learningSessions.markFailed(stopped.id, message);
      return await this.publishLearningResult(stopped, `Dataset ${stopped.datasetVersionId} was saved (${summary}), but automatic training could not start: ${message}`);
    }
  }

  private async publishLearningResult(session: LearningSessionRecord, message: string): Promise<string> {
    const guild = this.client.guilds.cache.get(session.guildId);
    const channel = session.notificationChannelId ? guild?.channels.cache.get(session.notificationChannelId) : null;
    if (channel instanceof TextChannel || channel instanceof VoiceChannel) {
      await channel.send({
        content: `🧠 **LEARNING SESSION UPDATE — ${session.targetDisplayName}**\n${message}`,
        allowedMentions: { parse: [] },
      }).catch(error => console.warn('[LearningSession] Could not post notification:', error instanceof Error ? error.message : error));
    }
    return message;
  }

  private startLearningMonitor(): void {
    if (this.learningMonitor) return;
    const poll = () => {
      if (this.learningMonitorRunning || !this.voiceServiceClient.isConfigured()) return;
      this.learningMonitorRunning = true;
      void this.refreshLearningTrainingStates()
        .catch(error => console.warn('[LearningSession] Training monitor failed:', error instanceof Error ? error.message : error))
        .finally(() => { this.learningMonitorRunning = false; });
    };
    poll();
    this.learningMonitor = setInterval(poll, 15_000);
    this.learningMonitor.unref();
  }

  private async refreshLearningTrainingStates(
    knownStatuses?: Awaited<ReturnType<VoiceServiceClient['listVoices']>>,
  ): Promise<void> {
    if (!this.voiceServiceClient.isConfigured()) return;
    const statuses = knownStatuses ?? await this.voiceServiceClient.listVoices();
    for (const learning of this.learningSessions.listRecent(50).filter(session => session.status === 'training')) {
      const voice = statuses.find(status => status.speakerId === learning.targetUserId);
      if (
        learning.training?.decision === 'wait'
        && voice
        && voice.job?.status !== 'queued'
        && voice.job?.status !== 'training'
      ) {
        await this.continueWaitingLearningSession(learning, voice);
        continue;
      }
      if (voice?.job?.status === 'failed') {
        const failed = this.learningSessions.markFailed(learning.id, voice.job.message || 'Voice training failed.');
        if (failed) await this.publishLearningResult(failed, `Training failed: ${voice.job.message || 'unknown error'}`);
      } else if (voice?.modelReady && (!voice.job || voice.job.status === 'ready')) {
        const ready = this.learningSessions.markReady(learning.id);
        if (ready) await this.publishLearningResult(
          ready,
          `Training finished. The best model is active${voice.checkpointSelection?.bestEpoch ? ` from epoch ${voice.checkpointSelection.bestEpoch}` : ''}; Latest remains available for comparison.`,
        );
      }
    }
  }

  private async continueWaitingLearningSession(
    session: LearningSessionRecord,
    voiceStatus: Awaited<ReturnType<VoiceServiceClient['getStatus']>>,
  ): Promise<void> {
    const decision = decideAutomaticTraining({
      modelReady: voiceStatus.modelReady,
      serviceDurationSeconds: voiceStatus.durationSeconds,
      newAcceptedSeconds: session.counters.acceptedVoiceSeconds,
      jobStatus: voiceStatus.job?.status ?? null,
      minimumFreshSeconds: this.minimumFreshTrainingSeconds(),
      minimumFinetuneSeconds: this.minimumFinetuneSeconds(),
    });
    if (decision.action !== 'fresh' && decision.action !== 'finetune') {
      const updated = this.learningSessions.setTrainingDecision(session.id, {
        decision: 'none',
        reason: decision.reason,
        status: 'insufficient_data',
      });
      if (updated) await this.publishLearningResult(updated, decision.reason);
      return;
    }
    const epochs = decision.action === 'finetune'
      ? this.readIntegerEnvironment('LEARNING_FINETUNE_EPOCHS', 35, 1, 1_200)
      : this.readIntegerEnvironment('RVC_EPOCHS', 100, 1, 1_200);
    try {
      const training = await this.voiceServiceClient.startTraining(
        session.targetUserId,
        session.targetDisplayName,
        {
          trainingMode: decision.action,
          modelSelection: 'best',
          epochs,
          datasetVersionId: session.datasetVersionId,
          learningSessionId: session.id,
        },
      );
      const updated = this.learningSessions.setTrainingDecision(session.id, {
        decision: decision.action,
        reason: decision.reason,
        modelSelection: 'best',
        epochs,
        jobId: training.job?.id,
        status: 'training',
      });
      if (updated) await this.publishLearningResult(updated, `The previous GPU job finished. ${decision.reason} Training is now queued.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = this.learningSessions.markFailed(session.id, message);
      if (failed) await this.publishLearningResult(failed, `Could not continue automatic training: ${message}`);
    }
  }

  private formatLearningSession(session: LearningSessionRecord): string {
    const styles = Object.entries(session.counters.styleCounts)
      .filter(([, count]) => count > 0)
      .map(([style, count]) => `${style}:${count}`)
      .join(', ') || 'none yet';
    const training = session.training ? ` Training: ${session.training.reason}` : '';
    return `Learning ${session.status} for **${session.targetDisplayName}** — `
      + `${session.counters.acceptedVoiceSeconds.toFixed(1)} clean / ${session.counters.capturedSeconds.toFixed(1)} captured seconds, `
      + `${session.counters.acceptedVoiceClips} accepted, ${session.counters.rejectedClips} rejected, styles: ${styles}.${training}`;
  }

  private minimumFreshTrainingSeconds(): number {
    return this.readIntegerEnvironment('LEARNING_FIRST_MODEL_SECONDS', 120, 10, 7_200);
  }

  private minimumFinetuneSeconds(): number {
    return this.readIntegerEnvironment('LEARNING_FINETUNE_NEW_SECONDS', 180, 10, 7_200);
  }

  private readIntegerEnvironment(name: string, fallback: number, minimum: number, maximum: number): number {
    const parsed = Number(process.env[name]);
    return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
  }

  private requireDashboardUser(userId: string | undefined): string {
    const value = userId?.trim() || '';
    if (!/^\d{5,30}$/.test(value)) throw new Error('Choose a Discord user first.');
    return value;
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

  private isOwner(userId: string): boolean {
    const ownerId = process.env.OWNER_DISCORD_USER_ID?.trim();
    return Boolean(ownerId && ownerId === userId);
  }

  private personaForGuild(guildId: string): PersonaProfile | null {
    const userId = this.activeVoiceSpeakers.get(guildId) || process.env.DEFAULT_SPEAKER_ID?.trim();
    if (!userId || !this.voiceConsentManager.hasActiveConsent(guildId, userId)) return null;
    const consent = this.voiceConsentManager.get(guildId, userId);
    const guildDisplayName = this.client.guilds.cache.get(guildId)?.members.cache.get(userId)?.displayName;
    return this.personaProfiles.resolve(userId, guildDisplayName || consent?.displayName || userId);
  }

  public getTimeline(): ConversationTimeline {
    return this.timeline;
  }

  public getVoiceConsentManager(): VoiceConsentManager {
    return this.voiceConsentManager;
  }

  public getVoiceServiceClient(): VoiceServiceClient {
    return this.voiceServiceClient;
  }

  public getSocialMemory(query = '') {
    return {
      ...this.socialMemory.getSnapshot(),
      searchResults: query.trim() ? this.socialMemory.search(query) : [],
    };
  }

  public exportSocialMemoryVault(): string {
    return this.socialMemory.exportVault();
  }
}
