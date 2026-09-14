import type { Container, EntityId, Item, Person, Vec3 } from './types';
import type { World } from './world';

export interface ContainerSpec {
  name: string;
  capacity?: number;
  open?: boolean;
  ownerId?: EntityId | null;
  pos?: Vec3 | null;
  placeId?: EntityId | null;
  tags?: string[];
}

export type ContainerTransferResult =
  | { ok: true; eventId: string }
  | { ok: false; reason: 'missing_actor' | 'actor_incapacitated' | 'missing_item' | 'missing_container' | 'container_closed' | 'not_carried' | 'not_contained' | 'capacity_exceeded' | 'invalid_quantity' };

export function makeContainer(world: World, spec: ContainerSpec): Container {
  const container: Container = {
    id: world.nextId('ct'), kind: 'container', name: spec.name, createdAt: world.now,
    tags: spec.tags ?? [], itemIds: [], capacity: Math.max(0, Math.floor(spec.capacity ?? 100)),
    open: spec.open ?? false, ownerId: spec.ownerId ?? null,
    pos: spec.pos ? { ...spec.pos } : null, placeId: spec.placeId ?? null,
  };
  return world.add(container);
}

export function setContainerOpen(world: World, actor: Person | null, container: Container, open: boolean): ContainerTransferResult {
  if (!actor) return { ok: false, reason: 'missing_actor' };
  if (!actor.alive) return { ok: false, reason: 'actor_incapacitated' };
  if (container.open === open) return { ok: true, eventId: '' };
  container.open = open;
  const event = world.emit(open ? 'container_opened' : 'container_closed', {
    actor: actor.id, target: container.id, placeId: container.placeId ?? undefined,
    pos: container.pos ?? undefined, significance: 0.1,
    summary: `${actor.name} ${open ? 'opened' : 'closed'} ${container.name}`,
  });
  return { ok: true, eventId: event.id };
}

function canAct(actor: Person | null): ContainerTransferResult | null {
  if (!actor) return { ok: false, reason: 'missing_actor' };
  if (!actor.alive) return { ok: false, reason: 'actor_incapacitated' };
  return null;
}

/** Move a whole canonical item stack from a person's inventory into an open container. */
export function transferItemToContainer(world: World, actor: Person | null, item: Item | null, container: Container | null): ContainerTransferResult {
  const blocked = canAct(actor); if (blocked) return blocked;
  if (!item || world.item(item.id) !== item) return { ok: false, reason: 'missing_item' };
  if (!container || world.container(container.id) !== container) return { ok: false, reason: 'missing_container' };
  if (!container.open) return { ok: false, reason: 'container_closed' };
  if (item.quantity <= 0) return { ok: false, reason: 'invalid_quantity' };
  if (item.holderId !== actor!.id || !actor!.inventory.includes(item.id)) return { ok: false, reason: 'not_carried' };
  if (container.itemIds.includes(item.id) || item.containerId) return { ok: false, reason: 'not_carried' };
  const used = container.itemIds.reduce((sum, id) => sum + Math.max(0, world.item(id)?.quantity ?? 0), 0);
  if (used + item.quantity > container.capacity) return { ok: false, reason: 'capacity_exceeded' };
  actor!.inventory = actor!.inventory.filter(id => id !== item.id);
  item.holderId = null; item.pos = null; item.placeId = container.placeId; item.containerId = container.id;
  container.itemIds.push(item.id);
  const event = world.emit('container_transfer', { actor: actor!.id, target: container.id, item: item.id, placeId: container.placeId ?? undefined, pos: container.pos ?? undefined, significance: 0.12, data: { direction: 'into' }, summary: `${actor!.name} stored ${item.name} in ${container.name}` });
  return { ok: true, eventId: event.id };
}

/** Move a whole canonical item stack from an open container into a person's inventory. */
export function takeItemFromContainer(world: World, actor: Person | null, container: Container | null, item: Item | null): ContainerTransferResult {
  const blocked = canAct(actor); if (blocked) return blocked;
  if (!container || world.container(container.id) !== container) return { ok: false, reason: 'missing_container' };
  if (!item || world.item(item.id) !== item) return { ok: false, reason: 'missing_item' };
  if (!container.open) return { ok: false, reason: 'container_closed' };
  if (item.containerId !== container.id || !container.itemIds.includes(item.id)) return { ok: false, reason: 'not_contained' };
  container.itemIds = container.itemIds.filter(id => id !== item.id);
  item.containerId = null; item.holderId = actor!.id; item.pos = null; item.placeId = null;
  if (!actor!.inventory.includes(item.id)) actor!.inventory.push(item.id);
  const event = world.emit('container_transfer', { actor: actor!.id, target: container.id, item: item.id, placeId: container.placeId ?? undefined, pos: container.pos ?? undefined, significance: 0.12, data: { direction: 'out' }, summary: `${actor!.name} took ${item.name} from ${container.name}` });
  return { ok: true, eventId: event.id };
}
