# Torn Veil item collection v1.1

The runtime collection is the original cloud-generated 360-item v2 delivery, published under
`web/public/items/v1.1/`. It is not a new simulation ruleset.

- `src/sim/content/itemCollection.ts` exposes 360 immutable authored physical definitions
- `makeCatalogItem(world, 'TV-001', options)` creates an ordinary canonical Item using existing
  inventory, ownership, value, damage, tool and transfer mechanics
- Only Swords, Daggers, Axes, Hammers, Books, Lanterns, Keys and Picks currently match canonical
  ItemTypes: 80 designs. Unsupported designs reject before any world mutation
- `Item.catalogId` is optional and identifies a physical design, not an entity instance
- `itemStaticAssetPath(id)` resolves all 360 static metric-scale Y-up GLBs, relative to the web
  public root. `itemStaticAssetFor(item)` returns undefined for legacy/unrecognized identities
- `itemFittingPrototypePath(id, sex)` is an explicit review-only lookup for 160 fitted variants
  across 80 armor IDs. These generic 1.90m mannequins do not match the active production kits

No rarity-derived damage, abilities, set bonuses, armor equip slots, arcane weapons, drone
behavior, collision, LODs or automatic character retargeting are implemented here. Descriptive
abilities/set lore are specification data, not certified world facts or learned knowledge.
Design-only entries are available for asset review and future implementation, not silently
spawned into canonical worlds. Existing scenarios and character presentation are unchanged.

Inspect `web/public/items/v1.1/catalog.json`, `README.txt` and validation receipts for art scope.
The static GLBs are individual ground-origin props; fitted armor uses full mannequin space.
Rigged files are opt-in prototypes; clearance testing against generic envelopes cannot certify
production bodies or all poses. Mesh parts may intersect and are not welded manufacture solids.

Import a completed original artifact directory with:

    python scripts/items/import-collection.py /path/to/torn-veil-360-v2

This copies geometry bytes unchanged, creates SHA-256/size provenance for all 520 GLBs, and
regenerates renderer-free definitions and presentation path lookup. It does not download
Library files or regenerate art. Blender masters, backups, thumbnails and gallery HTML are
omitted from the runtime repo. Asset generation remains in the original delivery workspace.

Verification:

    npm run typecheck
    npm exec -- vitest run tests/item-collection.test.ts
    npm run web:build

The asset tests enforce stable exact360 IDs, matching 360 static plus 160 fitted files, valid
GLB headers and hashes, design-only ability status and existing canonical factory behavior.
