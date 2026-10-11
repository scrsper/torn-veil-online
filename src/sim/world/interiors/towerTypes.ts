import type { Vec3 } from '../../core/types';
import type { RealmId } from '../realms/layout';

/** Only identity, geography bindings and causal receipts live here. Health, learned
 * abilities, equipment, inventory, class and rank remain ordinary World state. */
export interface CanonicalTowerFloor {
  floor: number; interiorId: string; placeId: string; openedEventId: string;
  trialId: string; agreementEventId: string; enemyBodyIds: string[]; sourceItemIds: string[];
  enteredAt: number; clearEventId?: string; rewardItemIds: string[];
  rewardContainerId: string;
  defeats: { bodyId: string; evidenceEventId: string; endedEventId: string }[];
}
export interface CanonicalTowerRun {
  version: 1; authority: 'canonical'; id: string; seed: number; personId: string; bodyId: string;
  towerId: string; realm: RealmId; returnPos: Vec3; floor: number;
  active: boolean; status: 'open' | 'fallen' | 'completed'; revision: number; openedEventId: string;
  floors: CanonicalTowerFloor[];
  commands: { id: string; digest: string; revision: number }[];
}
