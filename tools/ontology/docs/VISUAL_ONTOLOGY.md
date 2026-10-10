# Visual ontology

The 230 original terms are in `ontology/raw/RAW_ENTITY_VOCABULARY.md`. `vocabulary.json` preserves original numbering and spelling and adds multiple category labels. `CLASSIFICATION.md` is the complete classification table. These labels are provisional analysis, not game rules.

Species/subspecies describe biological identity. Archetypes describe visual construction and rig needs. Monster families, artificial families and cosmic/metaphysical concepts can span identities. Vampire, undead and cybernetic usually modify an existing identity. Merchant is a profession, guild master a role, boss an encounter classification, familiar a relationship, bronze a progression label. Drow may carry biological and cultural meaning; the simulation must disambiguate. Never create a class for every vocabulary term.

`EntityDescription` separates biological, personal, social, gameplay projection, states, modifiers and relationships. It supports sex, body type, age, mass, height, proportions, morphology, skin, face family, hair, eyes, scars, tattoos, horns, ears, tail, wings, features, class, skills, rank, combat profile and modular equipment. Gameplay fields are copied labels for visual selection only.

Sixteen foundational visual archetypes are registered. Missing archetype geometry is explicit. Twelve examples exercise the model: Human, Elf, Dwarf, Orc, Goblin, Wolfkin, Skeleton, Vampire, Golem, Slime, Dragon and Android. Human and Vampire currently display the same real Quaternius male base; Vampire's distinct state appearance is unresolved. The other ten retain identity without an invented primitive substitute. Independent source browsing includes female base, outfits, Imp, Puglin, animation mannequin and processed human.

## Adding an entity

1. Add/reuse a species rule in `ontology/species/index.json`. Choose a construction archetype and rig family; list missing species-specific features.
2. Add an entity definition to `ontology/definitions/validation-entities.json`, preserving independent culture/profession/class/state fields.
3. If a real asset exists, register its provider, source path, public URL, provenance and quality status. Keep geometry unassigned otherwise.
4. Run tests, inspect the resolver trace, build if geometry is present, and review rendered views. Never grant approval during generation.

## Art direction

`ontology/art-direction.json` validates against `ArtDirectionSchema`. All aesthetic numeric targets are nullable and currently unset, including body/face/hand proportions, polygon budgets, texel density, roughness, palette, armor/clothing/monster rules and game camera distance. This is a deliberate open contract; the catalog stage is a neutral inspection setup, not an adopted Torn Veil style.

## Equipment and culture

Slots include head, face, neck, torso inner/outer, shoulders, hands, waist, legs, feet, back, main hand, off hand and two accessories. Records anticipate rig families, socket, hidden body regions and material overrides. Actual skinned wardrobe assembly remains deferred. Culture records separately reserve clothes, armor, jewelry, hairstyles, weapon preferences, materials, colors, adornments and architecture; there is no built-in species restriction.
