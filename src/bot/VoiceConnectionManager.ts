import { joinVoiceChannel, VoiceConnection, VoiceConnectionStatus, getVoiceConnection, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, AudioPlayer } from '@discordjs/voice';
import { VoiceChannel, Client, Guild } from 'discord.js';
import { Readable } from 'stream';

export class VoiceConnectionManager {
  private players: Map<string, AudioPlayer> = new Map();

  public connectToChannel(channel: VoiceChannel): VoiceConnection {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
      console.log(`[Voice] Connected to channel ${channel.name} in guild ${channel.guild.name}`);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          new Promise((resolve) => connection.once(VoiceConnectionStatus.Signalling, resolve)),
          new Promise((resolve) => connection.once(VoiceConnectionStatus.Connecting, resolve)),
        ]);
      } catch (error) {
        connection.destroy();
      }
    });

    return connection;
  }

  public playAudio(guildId: string, audioBuffer: Buffer) {
    const connection = this.getConnection(guildId);
    if (!connection) {
      console.error(`[Voice] Cannot play audio, no connection found for guild ${guildId}`);
      return;
    }

    // Stop existing player if playing
    this.stopAudio(guildId);

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    const stream = Readable.from(audioBuffer);
    const resource = createAudioResource(stream);

    player.play(resource);
    connection.subscribe(player);
    this.players.set(guildId, player);

    player.on(AudioPlayerStatus.Playing, () => {
      console.log(`[Voice] Now playing audio in guild ${guildId}`);
    });

    player.on('error', error => {
      console.error(`[Voice] Error playing audio:`, error.message);
    });
  }

  public stopAudio(guildId: string) {
    const player = this.players.get(guildId);
    if (player) {
      player.stop();
      this.players.delete(guildId);
      console.log(`[Voice] Audio playback stopped for guild ${guildId}`);
    }
  }

  public disconnect(guild: Guild) {
    this.stopAudio(guild.id);
    const connection = getVoiceConnection(guild.id);
    if (connection) {
      connection.destroy();
      return true;
    }
    return false;
  }

  public getConnection(guildId: string): VoiceConnection | undefined {
    return getVoiceConnection(guildId);
  }
}
