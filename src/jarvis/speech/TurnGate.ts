/**
 * Newest turn wins. Audio from an older turn is never published after a newer take.
 */
export class TurnGate {
  private currentTurnId: string | null = null;
  private cancelled = new Set<string>();

  public take(turnId: string): void {
    this.currentTurnId = turnId;
  }

  public cancel(turnId: string): boolean {
    this.cancelled.add(turnId);
    if (this.currentTurnId === turnId) this.currentTurnId = null;
    return true;
  }

  public isCancelled(turnId: string): boolean {
    return this.cancelled.has(turnId) || (this.currentTurnId !== null && this.currentTurnId !== turnId);
  }

  public isCurrent(turnId: string): boolean {
    return this.currentTurnId === turnId && !this.cancelled.has(turnId);
  }

  public current(): string | null {
    return this.currentTurnId;
  }

  public release(turnId: string): void {
    if (this.currentTurnId === turnId) this.currentTurnId = null;
  }
}
