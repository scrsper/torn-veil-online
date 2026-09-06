import type { World } from '../../sim/core/world';
import type { Item, Person } from '../../sim/core/types';
import { actionsForCarriedItem, describeCarried, type PlayerAction } from '../../sim/core/interaction';
import { ITEM_LABEL } from '../../sim/world/factory';
import { esc } from './events';

/**
 * v0.10.1 Part IV — the player's inventory.
 *
 * There is no inventory model here. `player.inventory` is a list of canonical `Item` ids, exactly
 * as every NPC's is, and this panel renders those objects and calls canonical Simulation methods
 * on them. Nothing is cached, nothing is mirrored, and there is no separate player item state
 * that could drift from the world — pick an item up as an NPC would and it appears here; give it
 * away and it is gone from here because it is gone from `inventory`.
 *
 * The actions offered come from `sim/core/interaction.ts`, which derives them from what the item
 * IS and what the person knows, so this file contains no rules about what may be done with what.
 * That matters for one case in particular: an item the player is carrying that belongs to someone
 * else says so, and says so only when the player has actually learned whose it is.
 */
export class InventoryUI {
  el = document.getElementById('inventory')!;
  sel: string | null = null;
  /** Set by the frame loop to whoever is close enough to hand something to. */
  nearby: Person | null = null;
  onAction: ((action: PlayerAction, item: Item) => void) | null = null;
  private lastSig = '';

  constructor(private world: World) {}

  get open(): boolean { return this.el.classList.contains('open'); }
  toggle(force?: boolean): void { this.el.classList.toggle('open', force); this.lastSig = ''; if (this.open) this.render(); }
  select(id: string | null): void { this.sel = id; this.lastSig = ''; this.render(); }

  private get player(): Person { return this.world.person(this.world.playerId)!; }
  private items(): Item[] { return this.player.inventory.map(id => this.world.item(id)).filter((i): i is Item => !!i && i.quantity > 0); }

  update(): void {
    if (!this.open) return;
    const items = this.items();
    // Re-render only when something the panel shows has actually changed — this runs every frame.
    const sig = `${this.player.wealth}|${this.sel}|${this.nearby?.id ?? ''}|` + items.map(i => `${i.id}:${i.quantity}:${i.condition ?? ''}`).join(',');
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.render();
  }

  render(): void {
    if (!this.open) return;
    const w = this.world; const p = this.player;
    const items = this.items();
    if (this.sel && !items.some(i => i.id === this.sel)) this.sel = null;
    if (!this.sel && items.length) this.sel = items[0].id;
    const selected = items.find(i => i.id === this.sel) ?? null;

    const rows = items.map(i => {
      const detail = describeCarried(w, p, i);
      return `<div class="it${i.id === this.sel ? ' sel' : ''}" data-id="${i.id}">`
        + `<div class="n">${esc(i.name || ITEM_LABEL[i.type])}${i.quantity > 1 ? ` <span class="q">×${i.quantity}</span>` : ''}</div>`
        + `<div class="q">${detail.map(esc).join(' · ')}</div></div>`;
    }).join('');

    const actions = selected ? actionsForCarriedItem(w, p, selected, this.nearby) : [];
    const actionHtml = selected
      ? `<div class="acts">`
        + (actions.find(a => a.detail)?.detail ? `<div class="why">${esc(actions.filter(a => a.detail).map(a => a.detail).join(' · '))}</div>` : '')
        + actions.map((a, i) => `<button data-a="${i}"${a.grave ? ' class="grave"' : ''}>${esc(a.label)}</button>`).join('')
        + `</div>`
      : '';

    this.el.innerHTML = `<div class="head"><b>Carrying</b><span class="purse">${p.wealth} silver</span></div>`
      + (items.length ? `<div class="list">${rows}</div>${actionHtml}` : `<div class="empty">You are carrying nothing.</div>`);

    this.el.querySelectorAll('.it').forEach(el => {
      (el as HTMLElement).onclick = () => this.select((el as HTMLElement).dataset.id!);
    });
    this.el.querySelectorAll('[data-a]').forEach(el => {
      (el as HTMLElement).onclick = () => {
        const action = actions[Number((el as HTMLElement).dataset.a)];
        if (action && selected) { this.onAction?.(action, selected); this.lastSig = ''; this.render(); }
      };
    });
  }
}
