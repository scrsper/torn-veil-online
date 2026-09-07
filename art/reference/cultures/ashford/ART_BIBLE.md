# Ashford visual bible — approved reference derivative

The PNG files beside this document are copied, unmodified, from the approved local reference
pack. They are the authority for the `ashford_japanese_medieval_fantasy` presentation profile.
They are renderer guidance, not canonical simulation data and do not establish a person's future,
beliefs, ownership, or history.

## Building language

Ashford is Japanese / medieval fantasy vernacular, never European half-timber or generic western
medieval. Use charcoal-black kawara tile roofs with conspicuous deep, sometimes lifted eaves;
dark espresso timber posts and beams; warm ivory plaster infill; mossy-grey stone plinths and
steps; raised engawa/verandas; lattice openings; and warm paper lanterns.

The `dwelling-a`, `dwelling-b`, and `dwelling-c` sheets mean that homes must vary materially:
low gabled modest dwellings, side-wing/raised dwellings, and taller two-storey forms are all
valid in the same cultural grammar. The `workshop-a/b/c` sheets similarly call for open work
fronts, forge/chimney silhouettes, tool/storage dressing, and visibly different roof/body
proportions. They must not become copied cubes.

Temple references (`templesmall`, `temple medium`, `temple-a/b/c`) are civic anchors: elevated
stone terraces, wide stairs, layered ceremonial roofs, lantern pillars, railings, crest banners,
and restrained gold. Shops and `vendorstall` are open-front, counter-led, canopy/noren spaces
with baskets, produce or goods, hanging signs, red/burgundy cloth, and lantern light.

## Palette and prop language

Base palette: charcoal roof, dark aged timber, off-white plaster, grey stone, packed earth,
and valley green. Accent palette: amber paper light; burgundy/red crest cloth; muted indigo
work cloth; rare antique gold for ceremonial or high-status details. Appropriate props are
ceramic jars, baskets, barrels, crates, stacked firewood, tools, banners, blinds, and lanterns.

Avoid bright clean primary plastics, pale thatch as a default roof, exposed Tudor/X framing,
castle-gothic stone as the normal dwelling, generic tavern signboards, and identical building
shells without eave/roof/prop variation.

## Character language

The character sheets establish cultural grammar, not replacements for existing Ashford people:
layered kimono/robes, sashes, styled dark hair/topknots or longer hair, paper/metal ornaments,
simple work garments for ordinary villagers, and compact occupation cues (hammer, basket, spear,
bow, fan, beads, blade). Status is legible through cloth quality, layered silhouette, restrained
gold/crest accent, and equipment—not through changing a canonical identity.

`hana`, `yuki`, `kaito`, `shogun`, and `-ren-ayami-shiro` do not match the current canonical
Ashford cast. They therefore inform the generic profile only. The appearance-profile file leaves
named overrides available for a future approved sheet that actually maps to a canonical person.

## Current implementation boundary

`unreal/scripts/visual_profiles.py` formalizes these rules as a reusable culture profile. Its
settlement projector consumes canonical terrain, place footprint/type, elevation, door position,
resource nodes, and deterministic seed. It does not decide where a bakery, farm, NPC, wall, or
door exists; the TypeScript simulation remains the authority for each of those facts.
