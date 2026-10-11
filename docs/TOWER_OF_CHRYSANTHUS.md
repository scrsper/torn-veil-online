# The Tower of Chrysanthus

A 100-floor procedural roguelite combat tower, part of Torn Veil but separate from the canonical world for now. It is the
proving ground for combat, loot, capability growth, emergent classes, gods and monsters, condensed so they can be played
and tested while the world simulation develops separately.

Play: `Play Tower of Chrysanthus.cmd` (static build on :7505), or `npm run web:dev` and open
`http://127.0.0.1:5180/?arena=1&tower=1`. Add `&seed=N` for a specific tower, or `&floor=N` to start higher (testing).
The Combat Gym panel has an **Enter the Tower of Chrysanthus** button.

## Controls (Diablo 4 layout, Witcher 3 / Elden Ring combat)

- **Camera:** an elevated third-person camera aimed at the chest (about 7.6 m back and 20° down). It pulls back for crowds and big foes, rises over ruin walls, and goes over the shoulder while aiming the bow. Drag with the middle mouse button to orbit; the wheel zooms. See docs/web/CAMERA.md.
- **Move:** WASD (camera-relative), Shift sprint, mouse aim.
- **Attacks:** LMB light chain. RMB heavy: hold to charge at the wind-up and release for scaled damage, knockback and hit-stop. A heavy also finishes a light combo, and heavies chain into each other.
- **Defence:** Space dodges (a roll when moving forward). F guards; raising the guard just before a hit parries, staggering the attacker and refunding stamina.
- **Skills (1–7):** there are no fixed skills. Slots fill from what you absorb, read and become (see *Skills* below).
  The number of slots grows with your measured tier: 2 at Normal, then 3, 4, 5 and 6, plus one more when a confluence forms.
  Skills share the stamina bar and have cooldowns. **G** reads the top scroll in your pocket (up to 5).
  The Combat Gym sandbox keeps the four Witcher-style signs (Ember, Gust, Ward, Frost Sigil) on 1–4.
- **Other keys:** Q drinks a flask (heals over a second; refilled each floor; potions add flasks). Health does not regenerate on its own in the tower. Tab cycles drawn weapons (F1–F4 select one directly). E uses a shrine. K opens the Codex.

## PS5 controller (DualSense)

Plug it in over USB or Bluetooth (Chrome and Edge present it as a standard gamepad). The HUD switches to controller glyphs the moment you touch it.

| Input | Action |
|---|---|
| Left stick | Move (relative to the camera) |
| Right stick | Orbit the camera |
| R3 | Recentre the camera behind you |
| R1 | Light attack (chain) |
| R2 | Heavy attack (hold to charge). Bow: hold to aim, release to loose |
| L1 | Guard (raise it just in time to parry) |
| ○ | Tap: dodge or roll. Hold: sprint |
| ✕ | Interact (shrines, revives); confirm in menus |
| □ | Flask |
| △ | Next weapon |
| **Hold L2 +** □ △ ○ ✕ R1 R2 L1 | Skill slots 1–7 |
| D-pad ↑ / ↓ | Drink from the belt / read a scroll |
| D-pad ← / → | Previous / next weapon |
| Touchpad | Spellbook |
| Create | Codex |
| Options | Pause and show the controls |

- **Menus:** every card choice, dialogue, Spellbook page and message works with the D-pad (or a flick of the left stick), ✕ to confirm and ○ to back out.
- **Aiming:** attacks and spells aim at the foe you are facing or moving toward.
- **Rumble:** on hits taken, blocks and critical hits.
- **Checking:** `scripts/web/arena-pad.ts` drives a virtual DualSense through every binding (19/19 pass). It hasn't been tried on a physical pad yet.

## Movement at ease

Out of combat (no foe within about 9 m, no recent blows) the hero walks, runs and stands relaxed: arms loose and weapon slung across the back. A foe drawing near, a hit taken, or any attack, guard, aim or cast draws the weapon at once into the combat stance.

## Bodies and held equipment

- **Hero body:** the ontology creator's current Human family (`tools/ontology/ontology/morphology/human-family.json`):
  `tv-human-male-v2` (default) or `tv-human-female-v1`, chosen in the Codex (K) and used from the next climb.
  - **Staging:** `npm run web:creator` (run by `web:dev` / `web:build`) copies them byte-for-byte, hash-checked
    against the provenance registry, into `web/public/arena/creator/` with `creator.json`.
  - **Status:** both are CC0 MakeHuman/MPFB PROTOTYPE bodies.
  - **Motion:** the existing Tower clips are baked onto each body's own rig.
  - **Appearance:** the male body gets the creator's seeded jaw morph and linen/leather palette from the climber's
    identity (the same seeding as the editor, on the climber id rather than an ontology entity). The female body has
    no authored variants, and that is reported.
  - **Fallback:** an unstaged body falls back to the earlier MPFB ranger with a visible notice.
- **Customization:** the Codex panel's Character section, saved in this browser (`tv.tower.appearance.v1`), separate
  from expedition checkpoints. Body, height (95–105%, held gear scales with it) and hair on/off work on both bodies;
  jaw width (`TV_JawWidth`) and re-roll (seeded jaw and cloth colours) on the male body only. The female body has no
  authored morph or palette, and the panel says so.
- **Spell visuals:** a missile's end follows its outcome (hit, blocked, wall, out of range). The nova draws one border
  at its 4.2 damage radius, and fields fade out when they end. Presentation only.
- **Stances:** calm movement uses the upright unarmed clips. Near foes, the sword-and-shield ready stance keeps the
  authored weapon arms over an upright body. Guard and attacks are unchanged.
- **Equipment size:** `src/web/items/physicalFit.ts` sizes held items against the metric item catalog's type ranges,
  or explicit per-item targets for unit-less KayKit gear. It scales about each item's grip, so reach and damage are
  unchanged.
- **Shield:** the sword-and-shield shield is catalog TV-081 *Round Watch*, drawn as a recorded vertical-grip render
  variant (only its handle bar is turned; the GLB is untouched).
- **Checks:** `scripts/web/tower-sword-shield.ts`, `scripts/web/tower-creator.ts`.

## Magic and the god

Magic (element × form; 80 spells that emerge from affinity and learned forms), elemental reactions, imbuing, potions, the Proving Hall (floor 0) and Chrysanthus himself (the floor-10 trial and the summit) are described in docs/TOWER_MAGIC.md.

## Monsters

Each floor belongs to a faction, and about a fifth of its foes come from the others (`floorgen.ts`):

- **Greenskins.** Goblins (big heads, long arms, huge hands and feet on short legs; fast, knives, packs of four),
  goblin archers, orcs (top-heavy: small heads on huge shoulders, long thick arms, big hands; guard-breaking two-handed
  swings) and orc chiefs. Goblins hold floor 1.
- **The dead.** Skeletons (brittle, relentless, in ranks), robed skeleton mages (orbs), and skeleton brutes (thick bones,
  greatswords; the undead floors' bosses). They appear from floor 3, and burst into bone shards when they die.
- **Raiders.** Human raiders, soldiers, archers and mystics.

Creature bodies come from `build_arena_stylized.py`:
- Orcs and goblins are MPFB bodies **re-proportioned on the rig**: pose bones are scaled, baked into the meshes, and
  applied as the new rest. They also get face targets, authored tusks and ears, and green skins.
- Skeletons are the same game-engine rig with all flesh removed and a **low-poly bone set rigidly skinned to it**:
  limb bones with joint knobs, vertebrae, a ribcage, a pelvis, and a skull with jaw, sockets and glowing eyes.
- Clips are baked once on the reference human. Each body's pelvis track is rescaled to its own leg length, so short
  goblins don't float.
- A **creature posture** layer runs after animation, so the same motion capture reads as a different animal: the spine
  curls forward, the head lifts back to the horizon and the shoulders roll in. It eases while running.

## How a climb works

- You start with **bare hands and plain cloth** (fists: jab, cross, hook, uppercut, roundhouse; kick; roll).
- Each floor is generated from (run seed, floor) by `src/web/arena/tower/floorgen.ts`:
  - **Layout:** ruined stone buildings with doorways, furnished interiors, chests, and courtyard clutter to smash.
  - **Every floor:** defeat every foe, then the door at the far wall opens. Walk through it to climb the stair.
  - **Every 5th floor:** a named boss, such as *Draun of the Black Forge*.
  - **Every 10th floor:** a god's shrine and its champion. Beat the champion, then press E at the shrine for a boon.
    The choices are the god's favour (+2 domain affinity), a pact (+30% damage for −20% health, a bane for power), or mending.
  - **Floor 100:** the summit deity.
  - **Size:** the map grows every 25 floors.
  - **Tier bands:** every 15 floors, with their own look: Root Cellars (Normal) → Iron Halls → Bronze Galleries →
    Silver Cloisters → Gilded Courts → Crystal Spires → Threshold of Chrysanthus.
- **Loot** drops from foes, chests, bosses and loot boxes (`items.ts`). It follows Diablo:
  - **Rarity:** Common, Magic, Rare, Legendary, Mythic (from floor 25). Odds rise with depth and the source.
  - **Affixes** are scaled by item level: damage, attack speed, movement, maximum life, life per hit, critical chance,
    cooldown reduction, damage reduction, thorns, flask charges and elemental affinity.
  - **Names:** Magic items are named from their affixes (*Keen Veilguard of Haste*). Rares get generated two-word
    names (*Ghoul Thirst*, *Grim Shell*).
  - **Legendary powers:** Legendary and Mythic items carry a named power, and Legendaries, Mythics and essences show
    a loot beam. The powers:
    - *Funeral Pyre:* kills burst into flame.
    - *Thunderhead:* every 6th blow chains lightning.
    - *Red Thirst:* kills heal.
    - *Echoing Rune:* skills may skip their cooldown.
    - *Winter's Teeth:* blows on chilled foes crit.
    - *Bulwark of Ages:* a parry raises a ward.
    - *Reaper's Due:* kills shorten cooldowns.
    - *Avalanche:* heavy blows send a shockwave.
  - **Slots:** a weapon per moveset (the user's Torn Veil Arsenal), armour and a charm. Only what you wear and the drawn
    weapon count. A better item is equipped; a worse one is salvaged.
  - **Other drops:** skill books, scrolls, essences and healing draughts.
- **Death** ends the run (roguelite). R begins a new climb.

## Skills (`skills.ts`)

Skill slots are emergent: every slotted skill comes from something the climber absorbed, read or became.

- **Essences** (*He Who Fights With Monsters*). Monsters yield essences of their nature: goblins swift or shadow, orcs
  blood or iron, skeletons bone, mages fire, ice, storm or life.
  - Absorbing one grants its ability: Immolate, Rime Circle, Chain Lightning, Blink Strike, Iron Skin, Shadow Step,
    Mending, Bone Spear or Blood Frenzy.
  - The third essence forms a **confluence**, an ultimate that carries every rider of its parts. Named confluences
    include Doom (bone+blood+shadow), Wildfire, Tempest, Undying, Forge, Predator, Sunbirth and Crypt; any other trio
    composes a name.
  - Further essences resonate and rank up your skills. A god's shrine offers its essence.
- **Skill books** teach their element's skill permanently and add affinity. Re-reading a known one ranks it up.
- **Class signatures.** An emerged class grants its signature skill, tinted by its element: Hundred Fists, Whirlwind,
  Earthsplitter, Reaving Cleave, Volley or Iron Body (*Rimebreaker: Earthsplitter*). When the class changes, the new
  signature replaces the old one in place.
- **Scrolls** are one strong cast, read with G: Falling Star, Forked Sky, Mending, the Gale, the Ossuary.
- **Power and rank.** Power comes from rank (books, resonance, and one rank per 25 casts), the affinity of the skill's
  element, and depth.
- **Full slots.** When your slots are full, the new skill waits until the floor is clear, then you choose which slot it
  replaces or keep it for the next slot you earn.

## Achievements and loot boxes (`achievements.ts`)

After *Dungeon Crawler Carl*: the tower's system voice notices what you do, names it, mocks you a little, and awards a
**Bronze, Silver, Gold, Platinum, Legendary or Celestial box**.

- **Examples:** First Blood, Bare Knuckle Enthusiast, The Blender (a 50-hit combo), Not Today (a parry), Property
  Damage, Pentakill Is Not a Real Word, Untouchable (a flawless floor), Not Dead Yet, You Are What You Kill (an
  essence), Confluence, Funny Bones (20 skeletons), Tusk Collector, and depth markers up to Chrysanthus.
- **Opening:** boxes open when the floor is clear, and their loot spills at your feet. Box tier sets loot quality;
  Legendary and Celestial boxes hold essences.
- **Record:** lifetime achievements are kept in the browser beside the class Codex.

## Constitution alignment

- **Capability decides skills too.** Skills come from capability (essences absorbed, books read, a class earned), and slots grow with the measured tier. Nothing is picked from a menu.
- **§12 Capability before class / §IX.** The truth is the `CapabilitySheet` (`capability.ts`):
  - Style proficiency (fists, blade, heavy, axe, bow) grows with landed blows and kills.
  - Elemental affinities come from tomes and boons, and grow slowly with use.
  - History is tracked: kills, bosses, floors, tomes, boons, and floors fought without a weapon.
- **Emergent classes.** A class emerges when the sheet matches a qualifying pattern:
  - A dominant style alone: Brawler, Blademaster, Warden, Reaver, Ranger.
  - Style plus a dominant affinity: a composed name such as **Stormfist**, Flamebrand, Rimeshot or Thornbreaker.
  - An earned exception: **Iron Ascetic** (fists rank 4+, three or more floors fought without a weapon).
  - Classes evolve as the pattern changes, and grant a modest boon.
- **§60 Emergent progression meta.** Every discovered class is written to the **Codex** (press K) with its qualifying
  pattern, tier, first floor and seed. It is stored in the browser and can be exported as JSON. A shared server Codex is
  the multiplayer step.
- **§13–14 Tiers are summaries.** Your tier (Normal → Iron → … → God) is computed from measured capability, not from the
  floor number.
- **§42 Gods are entities.** Pyrrhos (flame), Isveld (frost), Thalor (storm), Ysra (swift), Ankh-Varro (iron), Nyx-Sel
  (shadow) and Maelith (verdance) each have a domain and offer domain boons. Pacts trade a bane for power.

Elemental effects on your blows (`tower.ts`):
- **Flame:** burns (damage over time).
- **Frost:** chills (slows movement).
- **Storm:** chains to nearby foes.
- **Shadow:** a second strike.
- **Verdance:** heals you.
- **Swiftness:** attack and move speed.
- **Iron:** armour and health.

## Status (2026-10-04)

| Feature | Status | Evidence |
|---|---|---|
| Floors 1–100 generate (seeded, sizes, bands, boss/shrine/summit) | VERIFIED (floors 1–11, 25, 47 loaded) | `scripts/web/tower-climb.ts` runs |
| Clear → door → stair → next floor | VERIFIED | Bot climbed 1→8 in 200 s |
| Loot drops and pickups, weapon unlocks, armour | VERIFIED | Worn/Common weapons, Common and Fine armour picked up |
| Emergent classes plus Codex | VERIFIED | Brawler → Warden (switched to greatsword); Stormfist after Thalor's boon |
| Boss floors with boss bar | VERIFIED (floor 5 cleared, floor 25 boss spawned) | climb reports |
| God shrine boons | VERIFIED (Thalor) | `climb-shrine` cards screenshot |
| Navigation around ruins (foes, companions) | IMPLEMENTED, bot-verified | Grid flow field in `nav.ts` |
| Elemental effects | IMPLEMENTED BUT UNVERIFIED visually | Storm affinity reached 2; procs not inspected frame by frame |
| Emergent skill slots (essences, confluence, books, class signatures, scrolls) | VERIFIED (bot) | Seed 11: Doom confluence and Warden's Earthsplitter by floor 8; seed 23: Rimebreaker signature |
| Diablo loot (rarity, affixes, names, legendary powers) | VERIFIED (bot) | Rares named *Ghoul Thirst* and *Grim Shell*; Funeral Pyre worn; odds tightened after Mythics came too early |
| DCC achievements and boxes | VERIFIED (bot) | 15 achievements on floors 3–10 (seed 23), boxes opened at floor clear |
| Skeletons and creature orcs and goblins | VERIFIED visually | `scripts/web/arena-creatures.ts` lineup (posture on/off); undead floors in the seed-23 climb |
| Balance beyond floor ~12 | UNVERIFIED | Needs human play |
| Multiplayer | NOT STARTED | See roadmap |

All runs are automation evidence, not human playtests.

## Roadmap (next steps, in order)

1. **Human play feedback** on floors 1–15: pace, loot rate, difficulty curve, and how class emergence feels.
2. **Monster variety:** liches, necromancers, cultists, pixies, griffins, with caster, flyer and swarm behaviours. Creature-specific motion clips (a goblin scurry, a lurching skeleton walk).
3. **More floor objectives:** survive, rescue an NPC, destroy a ritual, timed escape, puzzle doors, friendly or neutral NPCs.
4. **Abilities:** essence ranks with new abilities per rank (as in HWFWM), more confluences, and class evolutions.
5. **Multiplayer:** a small authoritative room server on the existing gateway/websocket stack. Friends join a climb in
   the browser, there is a shared server-side Codex, and you can watch or co-play together.
6. **Persistence:** run history and the global Codex on the server; meta-unlocks if wanted.
7. **Integration** into the canonical world later, as a dungeon (Constitution §41) once combat rules are settled.
