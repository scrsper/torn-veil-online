# Torn Veil Online — Forward Development Roadmap
## v0.7 through v0.11

Current completed milestone: **v0.6 — Knowledge, Memory, Skills & Intent**

The next five versions are intended to establish enough ordinary-world reality that later magic,
ontological advancement, gods, civilizations, cultures, warfare, and conversational NPCs have
actual systems to interact with rather than special-case game mechanics.

The overarching progression is:

```text
v0.6
knowledge + memory + skills + intentions
        ↓
v0.7
economic circulation + environmental exposure + affordances
        ↓
v0.8
materials + fire + generalized processes + practical crafting
        ↓
v0.9
geology + mining + metallurgy + resource discovery
        ↓
v0.10
animals + ecology + hunting + domestication
        ↓
v0.11
social institutions + property + law + relationships
```

After these milestones, Torn Veil should be in a substantially better position to begin
implementing deeper civilization simulation, magic, and ontological progression.

---

## Global implementation rules

These rules apply to every version below.

### Evidence can change the roadmap

Before beginning each version:

1. Confirm the previous version is merged into `main`.
2. Read the previous version's full architecture report.
3. Run the complete test suite, typecheck, and production build.
4. Review all disclosed scaling risks and regressions.
5. Determine whether any discovered issue invalidates an assumption in the next milestone.

If an earlier milestone exposes a genuine architectural blocker to the next milestone: fix the
prerequisite first and document why the roadmap changed.

Do not blindly follow this roadmap when simulation evidence says the dependency is wrong.
Conversely, do not rewrite future milestones merely because ordinary tuning remains imperfect.

### One version = one architectural milestone

Each version should:

* live on its own branch
* have logical commits
* preserve deterministic simulation
* preserve canonical conservation rules
* increment `SAVE_VERSION` when required
* add deterministic tests
* run real headless benchmarks
* run actual browser verification
* produce a complete architecture report
* disclose regressions and scaling risks honestly

Do not weaken tests merely to make the milestone pass.

### Shared world-law philosophy

Prefer:

```text
world condition
→ consequence
→ perception
→ reasoning
→ action
```

over:

```text
world condition
→ NPC command
```

Examples:

Bad:

```text
rain
→ seek shelter
```

Desired:

```text
rain
→ wetness
→ cooling/exposure
→ discomfort or physiological cost
→ person evaluates destination, clothing, urgency, distance, shelter, health
→ person decides what to do
```

Bad:

```text
axe item
→ tree can be chopped
```

Desired:

```text
axe
→ known identity
→ material properties
→ cutting affordance
→ cutting capability
→ tree can be worked efficiently
```

Bad:

```text
gold deposit exists
→ miners appear
```

Desired:

```text
deposit discovered
→ knowledge spreads
→ expected reward exists
→ people evaluate risk/opportunity
→ some choose mining
```

### Future ontology contract

Do NOT implement full ontological advancement during these five versions.

However, all systems should remain compatible with:

```text
Normal
Iron
Bronze
Silver
Gold
Diamond
God
Astral
```

Conceptually:

**Normal** — Ordinary mortal biology and physical law.

**Iron** — Clearly superhuman but still recognizably embodied. Possible eventual effects:
increased strength, increased durability, reduced fatigue, somewhat reduced food/sleep
requirements.

**Bronze** — Heroic/superhuman. Ordinary mortal limitations become substantially weaker.

**Silver** — Legendary / low-supernatural. Ordinary human-scale physical constraints become
much less important.

**Gold** — Demigod scale. Potentially extreme physical capability and major supernatural
independence.

**Diamond** — Lesser/subordinate deity scale. Comparable conceptually to lower-tier gods or
divine beings subordinate to major pantheon gods.

**God** — Major pantheon deity. A body may increasingly represent a manifestation rather than
the totality of the being.

**Astral** — Primordial/Titan/raw-divinity scale. May ultimately operate under qualitatively
different relationships with space, time, embodiment, causality, perception, manifestation, and
biological dependency.

This progression should eventually alter which rules apply, rather than merely adding larger
numeric stats.

Important: `Material.Iron` and `OntologicalTier.Iron` are unrelated concepts. Likewise bronze,
silver, gold, and diamond material/economic meanings must never be conflated with ontological
ranks.

---

## v0.7 — Living World V
### Economic Circulation, Exposure & Affordances

**Goal:** Repair the economic-circulation gap discovered by v0.6 while establishing two
foundational world abstractions: (1) environmental conditions create consequences rather than
behavioral commands, and (2) objects possess both identity and functional affordances.

Suggested branch: `claude/v0.7-circulation-exposure-affordances`
Suggested report: `docs/V0_7_CIRCULATION_EXPOSURE_AFFORDANCES.md`

#### A. Complete ordinary economic circulation

v0.6 discovered that many occupations spend money but lack corresponding paid-labor paths. This
must be corrected before significantly richer cognition.

Ordinary productive occupations should be capable of earning money from real work. At minimum
audit: farmer, miller, baker, woodcutter, quarry worker, builder, hauler.

Do not simply issue everyone a daily salary. Payment should correspond to real economic
contribution wherever practical.

Potential model:

```text
economic demand
→ request/work
→ physical production
→ verified contribution
→ payment
```

Existing occupation schedules may remain useful, but performing productive work must
participate coherently in the economy.

#### B. Wealth must circulate rather than drain one-way

Track: wages, purchases, business revenue, business expenses, worker wealth, business/owner
wealth.

Avoid manufacturing currency simply to repair poverty. If currency enters or exits the
simulation, that must be explicit.

Re-run long-horizon wealth distribution. Determine whether ordinary working villagers can
generally work → earn → buy necessities → continue functioning without artificial grants.

#### C. Revisit hunger equilibrium through access, not meter cheating

v0.6 discovered excessive long-term hunger partly because wealth access collapses. Correct
economic access first. Then recalibrate food production, meal size, meal timing, metabolic
drain, and food accessibility only if evidence still shows an implausible population-wide
equilibrium.

Desired ordinary distribution: comfortable — common; noticeable — common; uncomfortable —
periodic; urgent — occasional; critical — unusual unless something is wrong.

Humans should still tolerate hunger. Do not revert to immediate eating whenever mild hunger
occurs.

#### Environmental exposure

Introduce a foundational exposure model. At minimum: wetness, ambient temperature pressure,
shelter protection. Potential later hooks: wind, snow, clothing, humidity, mud. Do not
implement everything yet.

**Rain is not an instruction.** Remove any behavioral logic equivalent to `if raining: shelter`.
Rain instead causes physical/environmental consequences, e.g. `rain → wetness rises`. Wetness
may influence comfort, cooling, temperature burden, future illness risk, tool/material
behavior.

A person may still choose shelter. But someone with an important destination should frequently
continue walking through ordinary rain.

Required scenario: person has committed destination + moderate rain + tolerable exposure →
person continues traveling.

Contrasting scenario: cold/heavy rain + no important commitment + convenient shelter → shelter
becomes attractive.

#### Affordance foundation

Objects should have both "what is this?" and "what can this enable?" Introduce a minimal
architecture capable of representing identity, composition/material, physical properties,
affordances, known uses. Do not build the complete crafting system yet.

Example — an axe should be representable conceptually as: identity: axe; composition: head,
handle, binding or equivalent; properties: sharp edge, hard head, handheld leverage;
affordances: cut, chop, strike; known use: fell trees, split timber, weapon-like use.

NPC knowledge and physical affordance must remain separate. A person may see an object without
knowing its conventional name. A knowledgeable person may understand more uses.

#### v0.7 Definition of Done

Demonstrate:

```text
productive villager
→ performs economically useful work
→ receives real payment
→ purchases food
→ seller receives payment
→ economy continues circulating
```

And:

```text
rain starts
→ person becomes wetter
→ person with meaningful destination continues through rain
→ another person chooses shelter because their circumstances differ
```

And:

```text
object exists
→ system knows identity
→ system knows material/composition
→ system exposes functional affordance
→ knowledgeable NPC can recognize a use
```

Run at minimum 30- and 90-day economic benchmarks.

#### v0.7 Explicit Non-Goals

Do not implement yet: full fire simulation, full crafting/invention, geology, mines, animals,
magical species, ontological advancement, advanced clothing system, disease, complex
corporations, banking.

---

## v0.8 — Living World VI
### Materials, Fire, Processes & Practical Crafting

**Goal:** Create the first generalized physical-process layer of Torn Veil. Prove that world
objects react according to their material properties and that tools can be constructed from
materials and functional requirements.

Suggested branch: `claude/v0.8-materials-fire-processes`
Suggested report: `docs/V0_8_MATERIALS_FIRE_PROCESSES.md`

#### A. Generalized material properties

Create centralized material definitions. Potential properties: density, hardness,
toughness/durability, flammability, thermal behavior, porosity/water absorption. Only implement
properties that actual v0.8 systems consume. Do not create dozens of unused scientific fields.

Initial materials may include: wood, stone, plant fiber, food/organic matter, metal placeholder
where necessary.

#### B. Composition matters

Objects and structures should increasingly know what they are made from.

Example: wood wall → combustible, lighter, easier to construct. Stone wall → noncombustible,
heavier, harder to construct.

Properties should be derived from material definitions where practical rather than copied into
every item.

#### C. Fire

Implement fire as a world process rather than a visual status effect.

Minimal model: fuel, heat, ignition, burning, spread, extinguishing.

Fire should interact with material, wetness, rain, environment.

Examples: dry wood → readily burns; wet wood → harder to ignite; stone → does not provide
ordinary fuel; rain → suppresses exposed fire; nearby combustible material → may ignite when
sufficiently heated.

Keep deterministic. Do not build computational fluid dynamics.

#### D. Fire consequences

Fire should eventually create useful and harmful affordances.

Minimum v0.8: heat, light if practical, material consumption, danger.

Potential immediate integrations: cooking, baking, warming.

Do not force every existing transform to require fire if doing so destabilizes the milestone.
Prove at least one production process uses real fire/heat.

#### E. Generalized processes

Introduce a reusable process abstraction where appropriate.

Conceptually: inputs + conditions + energy/work → outputs + byproducts.

Examples: wood + ignition + oxygen → heat + ash/smoke; raw food + heat → cooked food.

Future systems should be able to reuse this for smelting, fermentation, drying, decay, alchemy.
Do not attempt universal chemistry.

#### F. Practical crafting

Use v0.7's identity/composition/affordance layer. Prove at least one constructed tool.

Ideal vertical slice: stick + suitable stone + plant fiber/binding → stone axe.

The important architecture: functional requirements → compatible components → known
construction method → labor/tool skill → created object. Not merely: inventory has recipe
ingredients → spawn item.

Known recipes may remain the reliable route. Improvised invention can remain future work.

#### v0.8 Definition of Done

Demonstrate: dry wooden object → ignites under appropriate conditions → burns → consumes
fuel/material; and rain/wetness → materially alters ignition/fire behavior; and stone
structure/material → does not burn like wood; and raw components → recognized functional
composition → crafted tool → resulting tool provides real affordance/capability.

#### v0.8 Explicit Non-Goals

Do not implement: forest-fire megasimulation, advanced chemistry, magical fire, mining,
complete metallurgy, hundreds of craft recipes, advanced invention AI, animals.

---

## v0.9 — Living World VII
### Geology, Mining, Metallurgy & Resource Discovery

**Goal:** Make the land itself economically meaningful below the surface. Create geological
resources, prospecting, extraction, and a minimal metallurgy chain.

Suggested branch: `claude/v0.9-geology-mining-metallurgy`
Suggested report: `docs/V0_9_GEOLOGY_MINING_METALLURGY.md`

#### A. Geological world generation

The world should contain spatially varying geological resources.

Conceptually: terrain/region → geological formation → deposit distribution.

Potential resources: stone, coal, iron ore, copper ore, tin ore, silver, gold, gemstones.

Do not require every resource to have a complete economic chain during this milestone. Use a
data-driven deposit model capable of expansion.

#### B. Deposits have location and quantity

A mineral deposit is canonical world state. Extraction reduces it. No magical regeneration.

Deposits may differ in size, grade/concentration, depth/accessibility, material. Only implement
the subset needed for gameplay.

#### C. Prospecting and discovery

A deposit existing should not mean every NPC knows it exists. Knowledge must matter.

Possible discovery paths: surface exposure, prospecting, stream panning, existing mine,
observation, information from another person. Use v0.6 knowledge/memory architecture.

#### D. Placer mining

Implement a simple alternate extraction path such as gold panning if practical.

Conceptually: stream sediment + pan/work → chance/deterministic yield from placer deposit. This
should require far less infrastructure than hard-rock mining but generally produce lower
throughput.

#### E. Hard-rock mining

Create a real extraction chain.

At minimum: known deposit → worker travels → appropriate tools → physical extraction → ore →
hauling.

Mining should involve time, energy, fatigue, tool wear. Do not teleport ore.

#### F. Metallurgy

Build on v0.8 fire/process architecture.

Minimum chain: ore + fuel + heat → refined metal + waste/byproduct.

Implement enough metal types to prove the abstraction. A good minimum would include several of:
copper, tin, bronze, iron, silver.

Bronze should be an alloy/process result rather than an ontological concept.

#### G. Currency provenance

If silver remains ordinary currency, begin grounding it materially if scope permits: silver
deposit → silver ore → refined silver → minting → coin.

Do not introduce macroeconomic inflation simulation yet. But avoid architecture where silver
currency can never have a relationship to physical silver.

#### H. Risk-taking foundation

Introduce or formalize a small bounded risk-preference dimension if cognition architecture
supports it.

Potential factors: risk tolerance, ambition, expected reward, travel danger, resource
certainty, wealth, family obligations.

Do not implement a full psychology system. Prove merely that two NPCs can evaluate the same
uncertain resource opportunity differently. This prepares future gold rushes, exploration,
dangerous magic, war, entrepreneurship.

#### v0.9 Definition of Done

Demonstrate: mineral deposit exists → initially unknown → NPC discovers it → knowledge becomes
canonical → extraction begins → ore physically moves → fire/process system refines it → usable
metal results.

And preferably: valuable but risky opportunity → one NPC accepts → another declines, based on
real differing traits/state.

#### v0.9 Explicit Non-Goals

Do not implement: complete geological science, dozens of ore minerals, advanced mine collapse
simulation, macroeconomics, full boomtown formation, magical ores, ontological materials,
industrial-scale machinery.

---

## v0.10 — Living World VIII
### Animals, Ecology, Hunting & Domestication

**Goal:** Populate Torn Veil with non-human living creatures that participate in the same
physical world rather than functioning as decorative mobs.

Suggested branch: `claude/v0.10-animals-ecology`
Suggested report: `docs/V0_10_ANIMALS_ECOLOGY.md`

#### A. Data-driven animal species

Animals need reusable species definitions. Potential characteristics: body size, metabolism,
hydration, sleep, temperature tolerance, diet, movement, perception, fear, aggression,
reproduction, lifespan. Do not build separate AI architecture for every species. Use reusable
behavior components.

#### B. Seed-dependent ecology

World seed and environment should influence which animals exist and where.

Conceptually: climate + vegetation + water + terrain → viable animal populations. This
establishes the future direction toward a seed-generated magical Earth. Do not generate
hundreds of species yet.

#### C. Representative ecological roles

Implement several species representing different roles. A strong initial set might include:
small prey animal, large herbivore, predator, domestic food animal, work/domestic animal — for
example rabbit, deer, wolf, chicken, cattle/ox. Exact species may differ. The architecture
should allow a future plethora of species without changing the core simulation.

#### D. Animal cognition is not human cognition

Animals should use simpler perception → instinct → memory → needs → behavior rather than the
entire human economic/social cognition stack.

Examples: deer — graze, drink, rest, flee; wolf — seek prey, hunt, eat, rest, defend territory;
chicken — forage, drink, roost, flee.

#### E. Animals are physical resources too

A living animal should not simply drop arbitrary loot.

Preferred chain: animal → death → carcass → butchery → meat + hide + bone + other usable
material/waste.

Yield may depend on species, body size, butchery skill, tool, condition of carcass. Food should
spoil normally.

#### F. Hunting

Humans should be able to hunt. Hunting requires knowledge/perception, travel, weapon/tool
capability, risk, animal behavior. Do not implement a massive combat overhaul. Use the existing
combat/action architecture where possible.

#### G. Domestication

Implement limited domestic-animal relationships. Potential behaviors: ownership, feeding,
housing/penning, breeding, harvesting products.

At least one animal should have an ongoing non-death economic function. Examples: chicken →
eggs; cattle → milk; ox → hauling power.

#### H. Work animals

If cattle/oxen are included, prove combined affordance: human + animal + harness/cart if needed
→ greater transport capability. Do not represent this merely as `haulBonus +5`. The actual
animal and equipment should create the capability.

#### I. Ecological populations

Animals should consume actual resources. At minimum prove: herbivore population → consumes
vegetation/food; and predator → consumes prey. Population reproduction/death should be bounded
and deterministic. Avoid instant ecosystem explosions.

#### v0.10 Definition of Done

Demonstrate: wild herbivore → eats/drinks/rests → reacts to danger; predator → detects/hunts
prey; human → hunts animal → carcass → butchery → food/materials; and at least one human ↔
domestic animal relationship with a real practical/economic consequence.

#### v0.10 Explicit Non-Goals

Do not implement: hundreds of animal species, magical creatures yet, advanced genetics,
detailed veterinary medicine, full evolutionary simulation, complex animal training, giant
monster ecology.

---

## v0.11 — Living World IX
### Social Reality: Property, Institutions, Law & Relationships

**Goal:** Establish the nonphysical world as canonical simulation state. People should live not
only in physical reality but also in systems of ownership, households, employment, promises,
debts, law, authority, reputation, kinship, marriage, citizenship, religion, crime.

Not every system requires full depth in this milestone. The goal is to create a reusable
social-reality architecture and prove it through several real vertical slices.

Suggested branch: `claude/v0.11-social-reality-institutions`
Suggested report: `docs/V0_11_SOCIAL_REALITY_INSTITUTIONS.md`

#### A. Distinguish types of truth

The simulation should increasingly distinguish physical fact, social fact, legal fact, personal
belief, cultural norm.

Example — physical fact: "A took object X from B." Social/legal interpretation: "B owned X. A
lacked permission. jurisdiction prohibits this. therefore authorities classify it as theft."
Another society might interpret the same relation differently.

#### B. Ownership

Ownership must become canonical. Objects, animals, structures, land/resource rights where
practical may have recognized owners. Distinguish physical possession from social/legal
ownership. A thief can possess something without legally owning it.

#### C. Households and kinship

Create canonical relationships such as parent, child, spouse/partner, household member.
Households may share food, shelter, wealth/resources where culturally appropriate,
responsibilities. This should improve the simplistic individual-only economy.

#### D. Employment and contracts

Formalize the social relationship around work. Distinguish one-time request, employment
relationship, promise/contract. A promise or contract should have parties, terms, status,
obligation, completion/breach. Keep the first implementation narrow.

#### E. Debt

Introduce a minimal obligation abstraction if practical. Debt should not merely be negative
wealth.

Conceptually: debtor, creditor, amount/obligation, terms, status. Do not build banking yet.

#### F. Law and jurisdiction

Settlements/factions should be capable of recognizing rules. A law system should evaluate
events rather than change physics.

Example: "person kills another" is physical reality. Whether that is murder, self-defense,
execution, or legal combat depends on jurisdiction and circumstances. Do not attempt a
comprehensive legal code. Implement a small rule framework.

#### G. Authority

Some social actors/institutions should possess recognized authority. Examples: guard, lord,
council, temple, court. Authority should be socially recognized, not a physics capability.

#### H. Crime and enforcement

Prove at least one legal vertical slice.

Ideal: object has owner → another person takes it without permission → act becomes
known/witnessed → jurisdiction classifies it as theft → authority can respond →
reputation/relationship changes. Do not require sophisticated policing AI.

#### I. Reputation

People should form socially relevant beliefs about others. Potential dimensions: trust,
reliability, danger, criminal reputation, professional competence. Keep bounded. Use
memory/knowledge architecture rather than global omniscience.

#### J. Marriage and social status

Marriage should eventually be a canonical recognized relationship rather than flavor text.
Likewise citizen, prisoner, vassal, employee, debtor should be social/legal relations, not
biological identity.

#### K. Coercive institutions / slavery architecture

If fictional societies later contain slavery, serfdom, debt bondage, caste systems, or similar
institutions, represent them as social/legal/coercive relationships, never inherent biological
properties.

Conceptually: institution/jurisdiction recognizes coercive status → person has restricted
autonomy → forced obligations → movement/work/property consequences.

Different societies may recognize or reject the institution. Do not hardwire `species X =
slave`. The architecture must allow one culture to consider a practice legitimate, another to
consider it criminal, individual characters to disagree. This keeps cultural morality distinct
from physical reality.

A full slavery system is not required for v0.11; the relation/institution framework merely must
not prevent such fictional societies later.

#### L. Religion

Introduce religion primarily as social reality. Potential canonical concepts: religious
institution, belief, worship, doctrine, priesthood, sacred place.

Do NOT yet equate "people believe deity exists" with "deity objectively exists." That
distinction will matter enormously when actual gods are implemented.

#### v0.11 Definition of Done

Prove several independent social systems share one coherent architecture.

At minimum:

Property/crime: ownership → unauthorized taking → witnessed/known act → legal classification →
social consequence.

Relationship/household: kinship/household → meaningful resource or behavior consequence.

Promise/employment: social obligation → action → fulfillment or breach → memory/reputation
consequence.

And demonstrate that: physical truth ≠ legal interpretation ≠ individual belief.

#### v0.11 Explicit Non-Goals

Do not implement: full national governments, complex constitutional law, deep politics,
elections, banking, complete taxation, massive religious systems, actual divine intervention,
full slavery economy, full war simulation, LLM conversational NPCs as the primary decision
engine.

---

## Cross-version architectural objective

By the end of v0.11, Torn Veil should contain the beginnings of six interacting layers.

```text
1. PHYSICAL REALITY
terrain, materials, weather, fire, resources, tools, structures
        ↓
2. BIOLOGICAL REALITY
humans, animals, metabolism, sleep, water, temperature, strength, dexterity
        ↓
3. ECOLOGICAL REALITY
plants, animals, predation, food, resource regeneration/depletion
        ↓
4. ECONOMIC REALITY
work, production, transport, currency, prices, ownership, resource scarcity
        ↓
5. COGNITIVE REALITY
perception, knowledge, memory, skills, risk, intentions, commitments
        ↓
6. SOCIAL REALITY
relationships, households, promises, employment, law, authority, religion, reputation
```

These layers should interact through canonical state.

### After v0.11

Do not lock the exact sequence yet, but likely future milestones include: civilization
formation, culture, larger settlements, trade between settlements, warfare, politics, religious
development, advanced crafting/technology, magic, ontological advancement, magical ecology,
actual gods, Astral entities.

Magic should increasingly act by modifying existing laws.

Examples: growth magic → accelerates real plant growth process; fire magic → creates/manipulates
actual fire; strength magic → modifies actual physical capability; divine sustenance → modifies
metabolic dependency; telekinesis → supplies movement/force affordance; ontological advancement
→ modifies which ordinary constraints apply.

Do not create a parallel "magic minigame" disconnected from ordinary reality.

---

## Milestone handoff protocol

For Claude, Codex, or another implementation agent:

### At the beginning of each version

Read: (1) this roadmap, (2) the immediately previous architecture report, (3) relevant existing
source/tests.

Then state: confirmed base SHA, baseline test count, known prerequisite risks, whether the
planned milestone remains valid.

If valid, proceed. If invalidated by concrete evidence, revise only the affected roadmap section
and explain why.

### At the end of each version

Produce `docs/V0_X_<MILESTONE>.md` containing: branch, final SHA, commits, tests, typecheck,
build, save version, implementation details, causal-chain evidence, conservation evidence,
determinism evidence, browser verification, benchmark table, regressions discovered while
building, honest scaling risks, implications for the next version.

The final section must explicitly answer: **Does the evidence from this milestone require
changing the next planned milestone?** Answer `NO` or `YES` with concrete reasons.

---

## Final roadmap principle

The purpose of these five versions is not to add as many features as possible. The purpose is
to establish ordinary reality.

Ordinary people should increasingly live in a world where: rain makes them wet; fire burns
wood; stone does not burn; tools work because of their physical properties; materials come from
somewhere; metal comes from ore; valuable resources must be discovered; animals eat and can be
eaten; predators hunt; workers must earn money; property can be owned or stolen; promises can be
kept or broken; laws depend on society; people remember what happened; people disagree about
what it means.

Once those rules are established, supernatural progression becomes meaningful. A Gold-tier
demigod ignoring rain, carrying tons, surviving without ordinary food, manipulating fire, or
tearing ore directly from the earth is impressive precisely because a Normal human cannot. A God
is meaningful because ordinary social and physical reality already exists. An Astral being is
meaningful because the player understands which assumptions of existence it is violating.

Build the mundane world deeply enough that transcending it has weight.
