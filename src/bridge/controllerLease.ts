/** Disposable transport ownership, never person/body authority. A closing socket cannot
 * reserve the controller while its replacement is admitted. Late close events must not
 * release the replacement's fresh binding. OPEN is the WebSocket ready-state value 1. */
export class ControllerLease<T extends { readyState: number }> {
  private owner: T | null = null;
  constructor(private readonly onRelease: () => void) {}
  get current(): T | null { return this.owner; }
  claim(socket: T): boolean {
    if (this.owner && this.owner.readyState !== 1) this.release(this.owner);
    if (this.owner && this.owner !== socket) return false;
    this.owner = socket;
    return true;
  }
  release(socket: T): boolean {
    if (this.owner !== socket) return false;
    this.owner = null;
    this.onRelease();
    return true;
  }
}
