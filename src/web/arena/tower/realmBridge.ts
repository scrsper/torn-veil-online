import type { RealmExpedition } from '../../../sim/world/realms/expedition';
import type { ExpeditionCommand } from '../../../server/realmExpedition';
import { validCheckpoint, type TowerCheckpoint } from './checkpoint';

export interface TowerHost {
  readonly runId: string;
  readonly climberId: string;
  readonly bodyId: string;
  readonly checkpoint: TowerCheckpoint | null;
  write(checkpoint: TowerCheckpoint): void;
  finish(outcome: 'fallen' | 'completed'): void;
  leave(): void;
}

/** Transport adapter only. This does not claim that the arena's browser combat is
 * canonical. It keeps its scoped checkpoint out of standalone localStorage saves. */
export class RealmTowerBridge implements TowerHost {
  private socket!: WebSocket;
  private controllerLease = '';
  private binding!: RealmExpedition;
  private pending: ExpeditionCommand | null = null;
  private inFlight: Promise<void> | null = null;
  private leaving = false;
  busy = true;
  error = '';
  private note!: HTMLSpanElement;
  get runId() { return this.binding.runId; }
  get climberId() { return this.binding.personId; }
  get bodyId() { return this.binding.bodyId; }
  get seed() { return this.binding.seed; }
  get checkpoint() { return this.binding.checkpoint as TowerCheckpoint | null; }
  get ended() { return this.binding.status !== 'open'; }

  async connect(): Promise<void> {
    const bar = document.createElement('div');
    bar.id = 'realm-tower-link';
    bar.style.cssText = 'position:fixed;top:88px;right:16px;z-index:100;display:flex;flex-direction:column;gap:9px;align-items:stretch;padding:11px 14px;background:#101a22ed;color:#eedebc;border:1px solid #728389;font:12px/1.45 Segoe UI;width:250px;max-width:35vw';
    this.note = document.createElement('span'); this.note.textContent = 'Connecting your expedition…';
    const leave = document.createElement('button'); leave.id = 'realm-tower-return'; leave.textContent = 'Return to atrium'; leave.onclick = () => this.leave();
    bar.append(this.note, leave); document.body.append(bar);
    this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/realms/expedition/socket`);
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(Error('World host did not answer.')), 10000);
      this.socket.addEventListener('message', e => {
        const m = JSON.parse(e.data); if (m.type === 'controller') { clearTimeout(timeout); this.controllerLease = m.token; resolve(); }
      });
      this.socket.addEventListener('close', e => { clearTimeout(timeout); this.busy = true; this.error = e.reason || 'World connection closed. Reload to restore the saved floor.'; this.note.textContent = this.error; reject(Error(this.error)); });
      this.socket.addEventListener('error', () => { clearTimeout(timeout); reject(Error('World host unavailable.')); });
    });
    const r = await fetch('/realms/expedition', { headers: { 'x-realms-controller': this.controllerLease } });
    const data = await r.json();
    if (!r.ok || !data.expedition?.active) throw Error(data.error ?? 'Enter the Tower from its world atrium first.');
    this.binding = data.expedition;
    if (this.checkpoint && !validCheckpoint(this.checkpoint)) throw Error('Expedition checkpoint needs recovery. Saved data retained.');
    this.busy = false; this.describe();
  }

  private describe() { this.note.textContent = `${this.ended ? 'Expedition ended. ' : ''}Gear and growth stay in this climb. Return or reload resumes its saved floor start.`; }
  private send(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const request = this.sendPending(); this.inFlight = request;
    return request.finally(() => { this.inFlight = null; });
  }
  private async sendPending(): Promise<void> {
    if (!this.pending) return;
    this.busy = true;
    try {
      const res = await fetch('/realms/expedition', { method: 'POST', headers: { 'content-type': 'application/json', 'x-realms-controller': this.controllerLease }, body: JSON.stringify(this.pending) });
      const data = await res.json();
      if (!res.ok) throw Error(data.error ?? 'Expedition save failed.');
      this.binding = data.expedition; this.pending = null; this.error = ''; this.busy = false; this.describe();
    } catch (e) {
      this.error = String(e); this.busy = true;
      this.note.textContent = `${this.error} Play paused. Return retries the pending save; reload restores the last acknowledged floor.`;
      throw e;
    }
  }
  private async commit(type: ExpeditionCommand['type'], extra: Partial<ExpeditionCommand> = {}): Promise<void> {
    if (this.pending) throw Error('A checkpoint is still waiting to be saved.');
    this.pending = { id: crypto.randomUUID(), type, revision: this.binding.revision, runId: this.runId, ...extra };
    await this.send();
  }
  write(checkpoint: TowerCheckpoint): void { void this.commit('checkpoint', { checkpoint: JSON.parse(JSON.stringify(checkpoint)) }).catch(() => {}); }
  finish(outcome: 'fallen' | 'completed'): void { void this.commit('finish', { outcome }).catch(() => {}); }
  leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    void (async () => {
      if (!this.binding) { location.assign('/?realms'); return; }
      if (this.pending) await this.send();
      // A lost/failed return response is retried with the same command identity.
      // Once that retry succeeds, do not submit a second return for an inactive run.
      if (this.binding.active) await this.commit('return');
      this.busy = true;
      await new Promise<void>(resolve => { this.socket.addEventListener('close', () => resolve(), { once: true }); this.socket.close(); if (this.socket.readyState === WebSocket.CLOSED) resolve(); });
      location.assign('/?realms');
    })().catch(() => { this.leaving = false; });
  }
}
