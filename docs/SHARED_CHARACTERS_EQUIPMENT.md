# Shared characters and canonical equipment

The world client and canonical Combat Gym now draw adult humans from Claude's detailed MPFB cast. Stable body IDs and projected sex select compatible cast variants; person identity, canonical biology, cognition and mechanics stay in `src/sim`. Child/legacy body kits and wildlife remain available as existing generated runtime assets. The nine detailed human GLBs, their credits and sixteen stylized creature/human casts remain unchanged source assets.

Arena/Tower, world actors and editor shared-source previews use `ArenaAssets`, `Retargeter`, `instantiateClips` and `Animator`. `FootPlant` extracts the existing two-bone stance solver for reuse by Arena/Tower and world actors. The world/editor bake only the clips they expose; Tower keeps its full repertoire. The editor's separately labeled Omni motion study is retained, including its measured flat-stage cleanup. It is not silently treated as approved gameplay locomotion.

In Model ontology → Sources, the nine `shared-*` entries load the exact game assets through a bounded static alias. No second cast copy is maintained. Native Mixamo/Motifect packs use the existing ignored local files and builders; fresh public clones use the tracked KayKit fallback. No raw Mixamo redistribution or new animation download is introduced.

## Equipment in the canonical testing lab

Tools & checks → Set up canonical Combat Gym → Create isolated world. Select Gym traveler, Resume at 1x, then Play selected person. Open Items (`I`/the configured Items binding) to equip the test sword, dagger, shield, helmet, left pauldron, bracer, greave and cuirass. Unequip the current right-hand item before selecting the other weapon.

These are actual canonical item instances carrying `TV-*` catalog IDs. The existing `interact` intent validates physical ability, ownership/holding, body identity, quantity, condition and occupied slots. Bindings live on items with body IDs; equipped views derive from inventory, with no second inventory. Changes emit causal events and provenance, persist in checkpoints, and clear on drop/give/container transfer. An item equipped on one manifestation cannot teleport directly to another.

The first equipment action sets that body's hand-selection policy to explicit. After that, unequipping its weapon means fists. Legacy worlds/saves retain their existing carried-weapon selection until an explicit equipment action. NPCs and players use the same canonical helper. This compatibility policy is not a separate player combat implementation.

Weapon parts share one authored grip origin. Shields use the left hand socket. Rigid fitted plates use the mannequin's bone-local frame, mapped to the actor's head, spine, shoulder, forearm or shin, with rest-frame orientation and proportional fit. The generic fittings remain prototypes: they are not production cloth skinning or a proof of penetration-free wardrobe fitting. Armor protection, servos, arcane powers and set bonuses remain descriptive catalog designs; none are invented by equipping.

The inventory keeps stable click targets between snapshots and refreshes on relevant projection changes. A one-region Observatory viewport now reports readiness correctly. The developer controller lease allows cold shader compilation while still releasing on explicit close and expiring after thirty seconds without contact; movement commands retain their normal short expiry.

## Validation and remaining scope

Focused tests cover canonical round trips, occupied slots, ownership, incapacitation, multiple bodies, persistence, no invented armor powers, and shared cast identity. Production editor and web builds are checked separately. Shipped asset hashes cover the 39 CC0 editor files plus all nine shared cast assets and their retained attribution. Browser evidence is captured from the real editor and inventory flow.

Detailed art likeness, population-wide age/body/hair wardrobe authoring, general terrain locomotion, soft cloth fitting and implementation of catalog abilities remain separate work. Arena/Tower mechanics remain disposable action-feel experiments, rather than silently becoming canonical world rules.
