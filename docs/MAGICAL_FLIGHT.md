# Personal magical flight

Personal flight is a new continuous application of Torn Veil's existing gravity
and ward knowledge. The older abilities produced combat effects; their earlier
descriptions did not already implement flight, breathable space or a transport
system. The formulas below are explicit game rules, not measured human or
physical constants.

## Authority and sources

`src/sim/physical/arcana/flight.ts` exports the read-only
`assessMagicalFlight(world, person, body, environment)` projection. It reads the
same Person, Body, knowledge, equipment and reserves used by ordinary arcana.
It never initializes an arcane body, refills mana, grants a skill, advances a
clock or emits an event.

Gravity control requires a recorded learning of `ess-gravity` or `book-well`.
Protection requires a learned definition whose kernel is `ward`. The learned
entry must reference an existing `arcane_learned` event whose actor, item,
ability, source kind and owned learning body agree with the retained source.
Consumed essences remain valid learning sources. Merely adding a learned-map
label, giving a character a title, or changing an ontology rank grants nothing.

Capacity comes from the existing `arcaneCapacity` calculation: the componentwise
maximum of embodied transformation capacity and valid equipped focus capacity.
Carried but unequipped, broken or foreign equipment does not contribute.
Existing learning/equipment/transformation receipt IDs are exposed as causes.
The assessment uses indexed event lookups, not a scan of journal history.

A living, conscious owned body must be present, or be the exact body retained
by an active canonical universe binding. Sleeping, downed, subdued, surrendered,
restrained or busy bodies cannot begin shaping lift. The host must still own
admission, input sequencing, spending, simulation and save validation.

New `explore` and `ascend` entries use `settlementRevision: 1` and map the
character's actual town feet and facing onto Cinderveil. The inactive campaign
preview uses that same builder, so accepting entry preserves the preview pose.
`ascend` additionally requires the capability assessment and starts personal
flight at that point. Town return maps the current supported settlement point
and facing back to the original Body. Existing gateway expeditions remain
pinned to their previous geography; viewing or loading one does not migrate it.
This is a reversible coordinate/residency handoff with shared geometry, not the
creation of another character or an invented replacement town.

## Continuous capability

The authored constants are in `MAGICAL_FLIGHT_POLICY`. Let:

- `A`, `P`, `R` be amplitude, aperture and reserve.
- `v` be veilcraft proficiency, clamped to 0–1.
- `m = (75 × bodySizeFactor + knownLoadKg) / 75`.
- `c = (1 + .35v) × currentExertionCapacity ×
  clamp(min(energy, hydration) / .5, 0, 1)`.

`currentExertionCapacity` and the fatigue multiplier come from the shared
physical-capability layer, including wounds, fatigue, heat and short exertion.
The 75 kg reference body is an authored estimate scaled by the existing size
trait, not a newly measured body mass.

| Quantity | Rule |
| --- | --- |
| Lift acceleration | `13 × A × c / m` m/s² |
| Forward speed | `min(2600, 10 × A^.75 × P^.9 × c / sqrt(m))` m/s |
| Steering acceleration | `max(0, lift − gravity) + .12 × speed` m/s² |
| Ward strength | `wardPower × sqrt(A × P) × c / sqrt(m)` |
| Control altitude | `24 × P × sqrt(A) × c / m` metres |
| Mana per second | `(1.1 + .015A + .025P + protectionCost) × sqrt(m) / (1 + .15v)` |
| Nominal effort per second | `.0004 × sqrt(m) / conditioning × max(.5, fatigueMultiplier)` |

Protection costs `.6` mana/s when ward strength reaches the authored space
envelope demand of 8; otherwise that term is zero. Energy below .1, hydration
below .1, fatigue at least .97, or exhausted burst capacity prevents sustained
lift.

Hovering requires enough lift to support local gravity and at least one second
of forecast endurance. Controlled forward flight also requires a .75 m/s² lift
margin and speed of at least 6 m/s. A body above its current ceiling can retain
lift to descend; forward flight is unavailable there.

Without sufficient protection and a control altitude at least 50 m beyond the
atmosphere, altitude is capped at the lesser of control altitude and 70% of
atmosphere height. With both, the envelope is the greater of control altitude
and the theoretical distance reachable with **full** reserve minus a 12-second
landing allowance. Remaining mana does not move that geometric ceiling down
onto the body. Actual remaining reserves still bound every admission and tick.
`spaceEnvelope` exposes that physical ward/lift capability independently from
`canCrossSpace`, which also requires route reserves. Losing the allowance for a
new route must not remove fast, controlled emergency descent from a protected
body already aloft.

Resource mass is read from `RESOURCE_MASS_KG` for actual held, positive inventory
stacks. Duplicate inventory IDs are counted once. The projection reports
`knownLoadKg`, `unweighedStacks` and the ordinary physical `safeCarryMassKg`.
It does not fabricate masses for missing item types. Therefore this is
incomplete cargo accounting, particularly for equipment and other unweighed
items; that limitation appears in the returned reasons.

## Reserve forecasting and traversal

Endurance is the smaller of remaining mana divided by mana rate and remaining
burst capacity divided by effort rate and the existing exertion burst scale.
The forecast is capped at an hour and assumes no replenishment while flying.
This is a constant-condition forecast, not a guarantee: damage, exertion,
cargo, equipment changes and route geometry can invalidate it.

For an explicit route of length `d`, admission requires:

`routeSeconds = 12 + d / speed + speed / acceleration`

The extra `speed / acceleration` covers acceleration and braking compared with
constant-speed travel; it deliberately overestimates short-route cost. The host
must pass the actual conservative route length, then compare both mana and
effort requirements with current endurance. `personalRouteDistance` includes
distance to the destination, a half-circumference avoidance allowance and
additional climb/descent distance. Invalid targets yield no valid admission.

`src/sim/world/universe/personalFlight.ts` advances at the existing 20 Hz fixed
step. Lift starts at the body's actual position. Movement accelerates toward a
desired velocity, sweeps terrain and checks Atlas proxies. The ceiling brakes
upward motion instead of relocating the body to it. Contact resolves onto
supported dry terrain; the small final surface-contact correction is distinct
from relocating between planets.

Manual input cancels cruise. Low reserves initiate descent. Once lift is
unavailable, momentum remains and local inverse-square gravity plus atmospheric
drag advance the fall. The host receives spent mana/effort and contact speed;
it must apply the costs and any bodily consequences. These returned values are
not themselves mutations to the Person or Body.

The vessel remains at its parked world and position. Landing elsewhere records
that world's discovery without bringing the vessel along, so ordinary vessel
launch is unavailable there. Gravity flight does not grant interstellar warp.

`src/server/universeBody.ts` advances the retained body's ordinary physiology
once per travel step while that body remains absent from planar collision and
perception. Personal powered flight uses the existing craft activity rate plus
incremental `spendExertion` work. Its mana is charged once and its sampling
timestamp advances. Falling or coasting in personal flight does not regenerate
mana. Grounded residency and protected vessel rest use the existing mana and
exertion recovery laws; no arcane component is created for someone who lacks one.
Recovery follows simulated elapsed ticks, not wall-clock time since disconnect.
Home surface residency uses world weather; other worlds currently use an
explicit calm baseline. This scheduling is not an alien climate model.

The canonical `universe_travel` soar event retains the learning causes and
assessment. The active flight references that event and records cumulative
mana/effort expenditure; landing records those totals. Event compaction retains
the referenced receipt and its causal history. One realm journal owns these
mutations along with the original Person, Body, inventory and world clock.
Midflight save validation checks remaining mana against the initial soar
receipt minus recorded expenditure. A parked vessel must remain in the current
system: personal flight cannot change stars, and piloting the vessel clears the
parked record.

## Verification and remaining limits

The capability tests in `tests/universe/magic-capacity.test.ts` cover source
receipts, rank independence, actual equipped capacity, mass and body-condition
effects, hover-only capability, finite routes, ward failure, invalid inputs,
read-only behavior and save/reload equivalence. The local reference flies at
about 10 m/s for less than two minutes. Capacity 20/12/320 with learned gravity
and ward supports roughly 0.9 km/s at roughly 2.3 mana/s with light load. These
figures are test calibration points, not automatic player grants.

`tests/universe/personal-flight.test.ts` covers continuous lift and acceleration,
the local ceiling, depletion followed by falling and contact, refused routes,
manual cancellation, and one complete seeded crossing with finite resource
spending and a vessel left on the original planet. It does not certify every
planet, weather state, cargo load or obstacle layout.

`tests/universe/canonical-flight.test.ts` covers exact per-step costs and
physiology, absence from planar body queries, preserved identity/inventory,
compacted causal history, midflight save/reload, ordered journal replay,
grounded recovery without offline catch-up, and a canonical crossing whose
parked vessel survives reload. Additional regressions reject cross-system
personal-flight records, erased costs, replenished midflight mana and rejected
commands that mutate state. Protected emergency descent is tested after reserve
loss. At this checkpoint the three flight suites contain 23 passing tests.

`tests/universe/canonical-settlements.test.ts` now contains 17 passing tests for exact
preview/entry pose in both ordinary and focused geometry, direct ascent without
relocation, rejected unlearned ascent, retry idempotence, preserved Tower,
inventory and quest state, return position/facing, live wall collision and save
validation, and unchanged legacy gateway geography. Later regressions cover
historical door changes, focused paving support, immutable entry receipts and
refusal of unsupported replacement geometry after mapped travel.

The normal-quality browser journey completed 23 checks with no HTTP, browser
or asset errors: town preview, walking, personal ascent, another planet's
landing and reload, and home return. The final restart initially exposed a
paving support bug; the exact preserved checkpoint now loads unchanged after
repair. Full evidence and the separate restored-town followup are in
`docs/evidence/atlas-flight/final-run/RESULTS.md`.

Outstanding integration concerns must remain explicit:

- A protective-envelope strength is a capability rule. It does not by itself
  implement oxygen, vacuum exposure, temperature, radiation or pressure injury.
- Ordinary recovery excludes absent planar bodies; the universe host adapter
  is therefore required. Its grounded/vessel recovery is tested, but ordinary
  food, water and care actions in the astronomical domain still need complete
  interaction coverage.
- Reserve admission cannot guarantee a dry, unobstructed emergency landing.
  Water, steep terrain and coarse Atlas proxies need broader physical outcomes
  and route acceptance coverage. No rescue teleport is provided.
- Some Atlas models have conservative node boxes or whole-model bounds.
  Rendering a doorway or interior does not certify that collision supports it.
- Town geometry and spherical positions share a reversible chart and canonical
  collision source. The ordinary town controller and universe controller still
  use an explicit residency handoff, and their interaction capabilities are not
  interchangeable. Legacy expeditions retain their original gateway transition.
- The movement module reports contact speed. At this checkpoint the host does
  not yet apply corresponding impact injury, so fall contact alone must not be
  described as a complete physical consequence model. This deliberately follows
  the current vessel collision policy; a health/death policy requires its own
  canonical consequence and persistence work.
- Browser controls, visual continuity and camera behavior require their own
  playtest acceptance; passing simulation tests is not visual verification.
