import { joinVoiceChannel, VoiceConnection, VoiceConnectionStatus, getVoiceConnection, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, AudioPlayer, StreamType, entersState } from '@discordjs/voice';
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
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch (error) {
        connection.destroy();
      }
    });

    connection.on('error', error => {
      console.error(`[Voice] Connection error in guild ${channel.guild.id}:`, error.message);
    });

    return connection;
  }

  public async playAudio(
    guildId: string,
    audioBuffer: Buffer,
    options: { silencePaddingFrames?: number } = {},
  ): Promise<boolean> {
    if (!audioBuffer || audioBuffer.length === 0) {
      console.error('[Voice] Cannot play an empty audio buffer.');
      return false;
    }
    const connection = this.getConnection(guildId);
    if (!connection) {
      console.error(`[Voice] Cannot play audio, no connection found for guild ${guildId}`);
      return false;
    }

    // Stop existing player if playing
    this.stopAudio(guildId);

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    let resource;
    try {
      // Send the WAV as one stream chunk and retain extra Opus silence frames so
      // Discord does not eat the final syllable of short Thai reactions.
      const stream = Readable.from([audioBuffer]);
      resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
        silencePaddingFrames: Math.max(1, Math.min(15, options.silencePaddingFrames ?? 15)),
      });
    } catch (error) {
      console.error('[Voice] Failed to create audio resource:', error);
      return false;
    }

    this.players.set(guildId, player);

    const completion = new Promise<boolean>(resolve => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };
      const timeout = setTimeout(() => {
        console.error(`[Voice] Audio playback timed out in guild ${guildId}.`);
        finish(false);
        player.stop(true);
      }, 120000);
      player.once(AudioPlayerStatus.Playing, () => {
        console.log(`[Voice] Now playing audio in guild ${guildId}`);
      });
      player.once(AudioPlayerStatus.Idle, () => finish(true));
      player.once('error', error => {
        console.error(`[Voice] Error playing audio:`, error.message);
        finish(false);
      });
    });

    connection.subscribe(player);
    player.play(resource);

    const played = await completion;
    if (this.players.get(guildId) === player) {
      this.players.delete(guildId);
    }
    return played;
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
