import type { World } from '../core/world';
import { serialize, deserialize } from './save';
export { martialPersistenceState, validMartialSave, restoreMartialPersistence } from './martialState';

/** Compatibility aliases: normal persistence now owns the complete martial payload. */
export function serializeMartial(world: World): string { return serialize(world); }
export function deserializeMartial(raw: string): ReturnType<typeof deserialize> { return deserialize(raw); }
