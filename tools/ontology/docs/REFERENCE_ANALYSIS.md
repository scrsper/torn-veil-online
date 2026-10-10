# Reference evidence and initial art direction

Reviewed 2026-10-04: **all 18 images**, including the full contents of every sheet. [Inventory](../references/INVENTORY.md) and [machine-readable manifest](../references/manifest.json) retain every original filename, hash, dimension and classification across all eleven requested uses. Files are PNG despite having no extensions. Originals were read only. The local copies are byte-identical, ignored by Git, and never copied to public assets. Creator and redistribution rights are unknown; user-supplied guidance does not imply CC0.

## Evidence hierarchy

1. **Human:** Omni, Kestrel and Kestrel character sheet govern this milestone. Naturalistic heroic-fantasy anatomy; attractive individual faces with skin detail and credible hands; cloth and leather with visible construction and wear. The shirt/trouser/boot silhouette matters before decorative armor.
2. **Orc:** orc2 supplies the readable male volume, female orc and orcish dimorphism supply multi-view anatomy and facial features. The male studio sheet is substantially more exaggerated than the village view. Preserve that disagreement for a silhouette review rather than silently averaging.
3. **Armor, undead and creatures:** material and silhouette evidence for later use. No new creature implementation is authorized by their presence in the folder.

## Consistent characteristics

Grounded, detailed heroic fantasy rather than faceted low-poly or cartoon forms. Human heads and hands have credible scale, limbs have believable volume and joints. Skin carries subtle color variation and imperfections. Hair has directional clumps/strands rather than opaque helmet shapes. Clothing has seams, folds, layering and material thickness. Linen, leather, iron and bone remain visually distinct. Surfaces carry restrained highlights and context-specific wear. Silhouettes remain readable in full-body elevated views; microdetail cannot substitute for that readability.

The repeated mountain settlement and warm key/cool ambient light explain some shared color appearance. They are presentation context, not a requirement to bake warm sunlight into textures. The neutral review stage remains necessary to reveal material defects. Heroic character styling does not prescribe every citizen's age, build, ethnicity, attractiveness, wealth or fitness.

## Variants, contradictions and incidental content

No byte-identical duplicates. Outfit/pose families overlap: Omni three images; Kestrel two; female Orc and the female row of dimorphism; orc2 and orc armered; Goblin plain/armored; three Liches. These should not count as independent evidence votes.

- Kestrel's braid becomes a bun in some sheet views; blouse neckline, boot cuffs and facial details drift. Use the sheet for construction guidance, not vertex-perfect cross-view registration.
- Human armor changes heraldry and chest motifs. Crosses, tree emblems, animal banners and the sheet's real-world biography do not become canonical religions, cultures or entity facts.
- Male Orc anatomy ranges from heavy athletic to extreme traps/shoulders and shorter legs. Skin ranges gray-green to brown-olive; lighting, individual design and illustration variation all contribute. Female Orc gloss is stronger than the Human skin target.
- Goblin oversized ears/head/hands are creature-specific. Ragged poverty and weapons do not define all members of a species.
- Lich staff topology, handedness, robe trim and purple/blue effects vary. Treat these as equipment/state alternatives.
- Iguana Hydra is saturated, spiny and chunky; Perentie Hydra is subdued and zoological. Preserve as two possible families, not one averaged design. Head/neck arrangements in the sheets are not trustworthy rig diagrams.

## Proportions: provisional baseline, not approval

The images support athletic adult Human baselines and ordinary-sized heads/hands. They do **not** provide defensible exact ratios: perspective, footwear, poses and hidden anatomy interfere. [Human family](../ontology/morphology/human-family.json) records explicit, replaceable starting targets: male 1.80 m / 7.75 heads, female 1.73 m / 7.5 heads, shoulder widths around 25% / 22.5% of height. These are engineering estimates for the first comparison, not measured facts or limits on population diversity. They are not yet enforced shape measurements. User references remain authoritative over these numbers.

## Review targets

**Face:** eyelid thickness and seated eyes; believable jaw, nose, ears and lips; no featureless mask, staring white eyes or baked directional shine. Omni's stubble and Kestrel's freckles are useful individual variants, not global defaults.

**Hands:** five distinct fingers, credible palm/knuckle volumes, readable thumb opposition and relaxed pose. No mitten silhouettes or swollen fingers. Dedicated dorsal/palm/side hand references are still missing.

**Skin:** diffuse color variation with restrained specular response. Inspect neutral lighting and gameplay distance. Base-color texture should not encode studio illumination; compare source textures for baked shading. Skin roughness starting range .5–.7 is a shader tuning hypothesis, not measured reference data.

**Hair:** short swept clumps and a tied braid are first targets. Evaluate hairline, scalp coverage, alpha sorting and silhouette at the gameplay camera. Source hair is an interim approximation; strand detail does not make the silhouette correct.

**Plain clothing:** offwhite linen shirt/blouse, dark woven trousers, brown leather belt/boots. Preserve seams, collar/cuffs and folds. Prioritize neckline, sleeve fit, waist and boot silhouette; source modern garments require replacement or competent authored modification. No armor used to conceal fit defects.

**Geometry:** shoulders/elbows/knees/hips must deform without collapse; continuous UVs and clean normal/tangent export; no body poke-through, helper geometry, floating eyes or transparent hair halos. Starting hero budget 60k triangles, crowd 15k, 2k textures are provisional engineering budgets. Final numbers depend on measured gameplay quality/performance.

## Camera authority

The catalog now has a configurable elevated exploration preset derived from the actual Babylon client: 8 m, pitch .5 rad, vertical FOV 62°. [Camera data](../ontology/game-camera.json) records provenance and the stage's fixed pivot assumption. The illustrations are closer portraits; matching their screen occupancy would hide gameplay-distance defects. Close front/side/back/three-quarter inspection supplements the gameplay view. Fixed camera/floor/light across male/female comparisons is mandatory.

## Approval and missing evidence

Art direction is DRAFT, all new meshes remain PROTOTYPE. This analysis does not canonize exact anatomy or approve an asset. Next valuable references: registered male and female neutral A-pose front/side/back with height scale; neutral head front/profile/three-quarter; hands; plain shirt/blouse/trousers/boots construction; Elf and Dwarf silhouettes alongside a Human at equal scale. Neutral-light material swatches and an actual gameplay screenshot help separate material intent from illustration lighting.
