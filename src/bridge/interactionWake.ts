export type ImmediateHandle = ReturnType<typeof setImmediate>;

/** Coalesces receive-side urgent wakes without running canonical work inline. */
export class CoalescedInteractionWake {
  private pending: ImmediateHandle | undefined;

  constructor(
    private readonly isDue: () => boolean,
    private readonly dispatch: () => void,
    private readonly schedule: (callback: () => void) => ImmediateHandle = setImmediate,
    private readonly cancel: (handle: ImmediateHandle) => void = clearImmediate,
  ) {}

  request(): boolean {
    if (!this.isDue() || this.pending !== undefined) return false;
    this.pending = this.schedule(() => {
      this.pending = undefined;
      // A normal timer may have cleared the debt before this queued callback
      // gets a turn. In that case the urgent wake is stale and must not pump.
      if (this.isDue()) this.dispatch();
    });
    return true;
  }

  stop(): void {
    if (this.pending === undefined) return;
    this.cancel(this.pending);
    this.pending = undefined;
  }

  get isPending(): boolean { return this.pending !== undefined; }
}
