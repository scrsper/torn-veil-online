"""Build presentation-only activity and retarget mappings from the Character Foundry audit.

Character meshes and modular parts are NOT selected here. `src/foundry/resolve.ts` is the single
asset resolver for appearance. This helper consumes the same machine-local catalogue and writes
only Unreal execution details that the TypeScript Foundry cannot create: activity animation paths
and generated retarget AnimBlueprint class paths.

Input:  .debug/character-foundry/catalogue.json (audit_character_assets.py)
Output: Content/TornVeil/Presentation/CharacterPalette.json
"""
import argparse
import json
import os

ACTIVITY_KEYS = [
    'travel', 'work', 'work/forge', 'work/bake', 'work/mill', 'work/tend', 'work/craft', 'work/serve',
    'work/chop', 'work/gather', 'work/repair', 'work/inspect', 'work/operate', 'work/record',
    'eat', 'eat/sit_and_eat', 'eat/eat_standing', 'drink', 'drink/drink_from_source', 'drink/drink_vessel',
    'rest', 'rest/sleep', 'rest/seated', 'rest/pray', 'socialize', 'socialize/converse',
    'socialize/sit_and_talk', 'trade', 'trade/barter', 'carry', 'carry/haul', 'carry/carry_travel',
    'flee', 'injured', 'injured/downed', 'idle',
]


def object_path(entry):
    return entry['package'] + '.' + entry['name']


def score(entry, animation_target, retarget_skeletons):
    skeleton = entry.get('skeleton') or ''
    if skeleton == animation_target:
        return 0
    if skeleton in retarget_skeletons:
        return 1
    return None


def choose(candidates, key, animation_target, retarget_skeletons):
    family, _, detail = key.partition('/')
    needles = [part for part in (detail or family).split('_') if len(part) > 2]
    best = None
    for entry in candidates:
        if entry.get('proposedFamily') != family:
            continue
        rank = score(entry, animation_target, retarget_skeletons)
        if rank is None:
            continue
        lowered = (entry.get('name') or '').lower()
        matched = sum(1 for needle in needles if needle in lowered)
        # A family fallback may use any classified clip. A detailed request needs at least one
        # detail token match or remains unresolved rather than claiming the wrong action.
        if detail and matched == 0:
            continue
        candidate_key = (rank, -matched, len(lowered), entry.get('package', ''))
        if best is None or candidate_key < best[0]:
            best = (candidate_key, entry)
    return best[1] if best else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalogue', default='.debug/character-foundry/catalogue.json')
    parser.add_argument('--out', default='unreal/TornVeilOnline/Content/TornVeil/Presentation/CharacterPalette.json')
    parser.add_argument('--retarget', action='append', default=[],
                        help='SKELETON_PACKAGE=ANIM_BP_GENERATED_CLASS_PATH')
    args = parser.parse_args()

    with open(args.catalogue, encoding='utf-8') as handle:
        catalogue = json.load(handle)

    retargets = dict(pair.split('=', 1) for pair in args.retarget)
    target = catalogue.get('animationTarget') or ''
    animations = catalogue.get('animations') or []
    palette = {
        'schema': 2,
        'purpose': ('Unreal-only activity and retarget execution mappings. Character meshes and '
                    'parts are selected by the shared Character Foundry resolver.'),
        # Regenerating this file must not cost it the instructions for regenerating it. Emitting
        # them here rather than hand-keeping them in the checked-in copy is what stops the next
        # rebuild silently deleting the only note that says how the file is produced.
        'howToFill': [
            '1. In the editor, run unreal/scripts/audit_character_assets.py to write the one '
            'machine-local Foundry catalogue for meshes, parts, skeletons, retargeters and '
            'activity animations.',
            '2. Run unreal/scripts/build_character_palette.py to rewrite this file from that '
            'catalogue. Appearance assets are already selected by the Foundry; this file maps '
            'activity clips only.',
            '3. For a visible character on a skeleton other than the driver, run '
            'unreal/scripts/build_character_retarget.py first and pass its --retarget argument '
            'to the palette builder.',
        ],
        'driverSkeletons': [target] if target else [],
        'activities': {},
        'retargets': retargets,
        'unresolved': {'activities': []},
    }

    for key in ACTIVITY_KEYS:
        picked = choose(animations, key, target, set(retargets))
        if picked:
            palette['activities'][key] = object_path(picked)
        else:
            palette['unresolved']['activities'].append(key)

    palette['coverage'] = {'activities': f"{len(palette['activities'])}/{len(ACTIVITY_KEYS)}"}
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as handle:
        json.dump(palette, handle, indent=2, sort_keys=True)
        handle.write('\n')
    print('CHARACTER_PRESENTATION_PALETTE', json.dumps(palette['coverage']))


if __name__ == '__main__':
    main()
