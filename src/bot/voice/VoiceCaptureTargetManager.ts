export class VoiceCaptureTargetManager {
  private readonly targetsByGuild = new Map<string, string>();

  public set(guildId: string, userId: string): void {
    this.targetsByGuild.set(guildId, userId);
  }

  public get(guildId: string): string | undefined {
    return this.targetsByGuild.get(guildId);
  }

  public clear(guildId: string): boolean {
    return this.targetsByGuild.delete(guildId);
  }

  public removeUser(userId: string): void {
    for (const [guildId, selectedUserId] of this.targetsByGuild) {
      if (selectedUserId === userId) this.targetsByGuild.delete(guildId);
    }
  }

  public allowsCapture(guildId: string, userId: string): boolean {
    const target = this.get(guildId);
    return target === userId;
  }
}
