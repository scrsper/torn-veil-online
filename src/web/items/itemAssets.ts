import assets from './itemAssetData.json';
import type { Item } from '../../sim/core/types';

/** Static prop paths only. Fitted armor is a generic-mannequin study, never automatically
 * attached to production bodies. glTF is Y-up, meters, with ground-level static origins. */
const byId = new Map(assets.map(a => [a.id, a]));
export function itemStaticAssetPath(catalogId: string): string | undefined {
  return byId.get(catalogId)?.staticPath;
}
export function itemStaticAssetFor(item: Pick<Item, 'catalogId'>): string | undefined {
  return item.catalogId ? itemStaticAssetPath(item.catalogId) : undefined;
}
/** Caller must explicitly opt into generic fitting prototypes. No retargeting guarantee. */
export function itemFittingPrototypePath(catalogId: string, sex: 'male' | 'female'): string | undefined {
  return byId.get(catalogId)?.fittingPaths?.[sex];
}
