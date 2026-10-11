# Production quality target

The user set **The Witcher 3** as the quality benchmark on 2026-10-10. This is
a target for the complete experience, not a claim that the current prototype
has reached it. The [human presentation reference](HUMAN_PRESENTATION_TARGET.md)
continues to guide close exploration framing and grounded motion.

For reproducible comparison, use the released 2015 game and the documented
[2022 presentation update](https://www.thewitcher.com/us/en/news/46681/the-witcher-3-wild-hunt-next-gen-update-trailer-and-redstreams-summary),
which added improved foliage/textures, a closer camera and control/UI options.
These establish useful comparison categories; they do not specify Torn Veil's
implementation or require a particular rendering technique. Reference footage
is a benchmark, not an asset source.

Torn Veil retains its own identity: the simulation generates consequences,
knowledge, relationships and history. Presentation consumes projected evidence.
A cinematic result must not invent canonical hits, equipment, knowledge or
story outcomes. Players and NPCs continue to use the same mechanics, and a
person may have zero or multiple bodies.

## Gates for a representative vertical slice

These are proposed engineering and review gates. An unchecked gate is work
remaining, even when a screenshot or isolated unit test looks good. Existing
[coverage](COVERAGE_LEDGER.md), [defects](KNOWN_DEFECTS.md) and milestone evidence
remain the detailed records; this page sets the cross-system acceptance bar.

| Area | Gate before calling the slice production quality | Current evidence / next gap |
|---|---|---|
| Human models | Inspect every cast rig at gameplay and conversation distance: expressive face/eyes, credible hands, consistent scale, fitted layered clothes; walk, run, guard, strike, crouch and death without exposed missing surfaces or severe clipping. Asset provenance and reproducible exports required. | Wren/Brann fit improved; extreme crouch contacts, facial performance, hair and broader wardrobe still need work. |
| Movement | Foot contacts agree with motion and sound; smooth starts, stops, turns, backward/side travel, slopes and small steps at 30/60/120 Hz. No correction spikes, clipping through obstacles or false ground above a drop. Test small/large bodies and different rigs. | Flat-ground slide reductions and 18 controlled terrain cases pass for one imported rig at three sizes; moving stairs, broader cast and frame-rate coverage remain. |
| Combat | Preparation/contact/recovery readable at gameplay distance; input responsiveness and guard/dodge transitions evaluated by a player; sound/VFX correspond to confirmed outcomes. Test misses, blocks, parries, injury, multiple opponents and tight spaces. | Canonical jab, guard, walking and running acceptance passes; richer encounters and a human feel review remain. |
| Environment | A town-to-woodland route has believable scale, material response, vegetation silhouettes, ground contact, building interiors and distant composition; canonical resource/collision identities remain intact. | Tree canopy and scanned/procedural materials exist; repetitive layouts, interiors, terrain transitions, vista and water need substantial art work. |
| Lighting | Same route and cast readable in clear midday, dusk, deep night and rain; skin/cloth retain detail, shadow bias does not detach feet, emissive windows/fire remain plausible. Review fixed-exposure before/after captures. | Controlled day/dusk/night/rain captures pass; shaded detail improves at unchanged exposure. Faces, interiors and deep-night palette still need review and art work. |
| Sound | Player and nearby NPC contact timing is convincing; surfaces distinguish themselves; combat, weather, interiors and music coexist without clipping or masking cues. Headphone and speaker listening review required. | Contact timing, projected floor/water materials and nearby stereo are implemented; five synthesized surface renders pass signal checks. Recorded Foley, listening review, mix, music and dialogue remain open. |
| Camera and UI | Exploration, conversation and combat preserve visibility/control; doors, slopes and vegetation do not cause uncomfortable snaps. UI is readable at 1080p, keyboard and physical controller usable, reduced motion and remapping honored. | Close follow and obstruction handling exist; physical controller and complete accessibility review remain open. |
| World and ontology | A first-hour route exposes perceivable causes, supported knowledge, social/economic consequences and persistence; two seeds produce plausibly different histories. No presentation-only victory, inventory or NPC knowledge. | Ownership/multiple-body safeguards and prior canonical regression pass; long-form player comprehension and systemic story quality need separate acceptance. |
| Performance and reliability | Record hardware/browser/resolution and quality tier; target 60 fps at 1080p on the reference machine, p95 frame <=20 ms and no recurring >50 ms stalls after warmup. One-hour route has bounded memory/resources; reconnect/save/reload preserve canonical state. | Prior performance evidence is bounded and older; current integrated content requires fresh measurement, then weak-hardware validation. |

## Implementation sequence

1. **Ground the existing people in the world.** Contact, terrain adaptation,
   material/light response, synchronized surface sound. Preserve the existing
   flat-ground and canonical-action checks. This is the active slice.
2. **Finish one encounter and its surroundings.** One polished town-to-forest
   route with an interior and a multi-opponent encounter; improve weapon handling,
   transitions, defensive feedback, camera visibility and local sound together.
3. **Bring the full cast to the same bar.** Deformation, clothing, faces, hands,
   hair, portraits and equipment fit across body types. Use a pose/contact-sheet
   matrix, then inspect the cast in the route's real lighting.
4. **Make the first hour legible.** Drive actual dialogue, trade, work, danger,
   injury/recovery and return-to-world flows. Improve explanations and UI from
   observed confusion, without scripting canonical outcomes to force a story.
5. **Scale the verified experience.** Varied settlements/biomes, more characters,
   systemic histories, longer sessions and slower hardware. Reuse canonical
   systems and measured presentation budgets rather than duplicate mechanics.

Each implementation slice ends with focused tests, typecheck/build as needed,
representative browser evidence, one independent review, and a pushed checkpoint.
Keep the last usable preview available. Record the seed, camera, overrides,
renderer, resolution and hardware with captures. Separate objective tests from
subjective art/feel judgments; a human verdict stays pending until one is given.
Do not spend the allowance rerunning unchanged tests or expanding unfinished
features when an existing gate still exposes a concrete defect.
