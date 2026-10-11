# Synthetic schema-30 compatibility fixture

The paired compact/reference JSON files were produced by the actual serializer
at commit `97f8146` (schema 30), before source-integrated growth introduced schema 31.
They are generated test data, not a player's save or rendered gameplay evidence.

The fixture contains a seeded realm, an open exterior door, canonical Tower entry,
trial consent and finite items, the same person/body/inventory/rank, nonzero injury
and health state, and witnessed/causally linked observations sharing an appearance.
Only `savedAt` is normalized to zero. The historical reader reloads both exports.
The reference file uses that historical writer's plain event representation;
tests compare the complete restored canonical serialization against it.

Schema-30 JSON predates the realm journal implementation. Journal tests import
this fixture and construct a checksummed format-1 compressed base to exercise
the supported checkpoint upgrade. They do not claim that an arbitrary old-engine
uncheckpointed tail is replay-compatible. Such tails must fail closed with files
retained until checkpointed by their matching source/runtime.

Generation recipe: export `src` and `package.json` from `97f8146` to an isolated
scratch directory; use its `RealmSession(731)`, open the Tower door, position the
fixture traveler in its atrium and call `applyTowerCommand` with `historic-entry-30`.
Set fixture health to 73 and injuries to `{arm: .125, leg: .05}`; emit the two
observation records in these files, then serialize once with compact events and
once with plain events. Keep this golden data independent of the current writer.
