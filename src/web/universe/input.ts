import type { TravelInput, UniverseCommand } from '../../sim/world/universe/travel';

export const UNIVERSE_CONTROL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE']);

function axes(keys: ReadonlySet<string>, flight: boolean): TravelInput {
  const axis = (a: string, b: string) => Number(keys.has(a)) - Number(keys.has(b));
  return { throttle: axis('KeyW', 'KeyS'), yaw: axis('ArrowLeft', 'ArrowRight'),
    pitch: flight ? axis('ArrowUp', 'ArrowDown') : 0, strafe: axis('KeyD', 'KeyA'),
    lift: axis('KeyE', 'KeyQ'), brake: keys.has('Space') };
}
const active = (input: TravelInput) => !!(input.throttle || input.yaw || input.pitch || input.strafe || input.lift || input.brake);

/** Keyboard edges reach the transport immediately. The periodic tick only keeps
 * held input alive; camera-only ground tilt never sends a travel command. */
export class UniverseHeldInput {
  readonly keys = new Set<string>();
  private last = axes(this.keys, false);
  constructor(private readonly emit: (input: TravelInput) => void) {}
  private publish(input: TravelInput, keepalive = false) {
    if (JSON.stringify(input) === JSON.stringify(this.last) && !(keepalive && active(input))) return;
    this.last = input; this.emit(input);
  }
  press(code: string, flight: boolean) {
    if (!UNIVERSE_CONTROL_KEYS.has(code) || this.keys.has(code)) return;
    this.keys.add(code); this.publish(axes(this.keys, flight));
  }
  release(code: string, flight: boolean) {
    if (this.keys.delete(code)) this.publish(axes(this.keys, flight));
  }
  heartbeat(flight: boolean) { this.publish(axes(this.keys, flight), true); }
  brake() { this.keys.clear(); this.publish({ ...axes(this.keys, false), brake: true }, true); }
}

/** One request at a time, with no polling-timer delay between queued requests.
 * Only unsent input is coalesced; structural commands retain their order. */
export class UniverseCommandQueue {
  private pending: UniverseCommand[] = [];
  private draining = false;
  constructor(private readonly canSend: () => boolean,
    private readonly transmit: (command: UniverseCommand) => Promise<boolean>) {}
  get length() { return this.pending.length; }
  clear() { this.pending.length = 0; }
  enqueue(command: UniverseCommand) {
    if (command.type === 'input') {
      const previous = this.pending.findIndex(c => c.type === 'input');
      if (previous >= 0) {
        const pending = this.pending[previous];
        // Every active input cancels assistance on the host. If it never reaches
        // the wire, its neutral replacement must retain that cancellation intent.
        // This also covers brake -> held axes -> release while a route reply is
        // pending; retaining only an explicit brake would lose it midway through.
        if (pending.type === 'input' && active(pending.input) && !active(command.input)) {
          command = { ...command, input: { ...command.input, brake: true } };
        }
        this.pending.splice(previous, 1);
      }
    }
    this.pending.push(command); void this.flush();
  }
  async flush() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length && this.canSend()) {
        if (!await this.transmit(this.pending.shift()!)) { this.clear(); break; }
      }
    } catch { this.clear(); }
    finally { this.draining = false; }
  }
}
