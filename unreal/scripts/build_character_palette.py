"""Write Content/TornVeil/Presentation/CharacterPalette.json from the local human inventory.

Input: docs/evidence/embodied-people/human-asset-inventory.json (audit_human_assets.py).
Output: the palette UTVCharacterPalette reads at runtime — the ONLY file in the project that
maps the bridge's semantic tokens onto machine-local asset paths.

Run in the editor, or standalone with python3 (it only reads and writes JSON).

Selection policy, in order:
  1. a mesh/clip on the driver skeleton, because it costs no retargeting;
  2. otherwise a mesh/clip on a skeleton listed in `retargets`, which needs an IK Retargeter;
  3. otherwise nothing. A token with no local asset is LEFT OUT rather than pointed at
     something approximate — the renderer then keeps the driver silhouette for that slot and
     says so in its diagnostics, which is the honest reading of "not installed here".

Nothing here is authoritative about appearance: the simulation still decides who each person
is. This file only decides what the installed library shows for a token.
"""
import argparse
import json
import os

DRIVER_SKELETON = '/Game/Characters/Mannequins/Meshes/SK_Mannequin'

# The Torn Veil human presentation palette: the token vocabulary the bridge emits, grouped so a
# reviewer can see at a glance which of it the local library actually covers.
BODY_TOKENS = [
    'body_human_adult_m', 'body_human_adult_f', 'body_human_elder_m', 'body_human_elder_f',
    'body_human_adolescent_m', 'body_human_adolescent_f', 'body_human_child',
]
PART_TOKENS = {
    'hair': ['hair_short_crop', 'hair_tied_back', 'hair_long_loose', 'hair_braided', 'hair_topknot', 'hair_shaved'],
    'facialHair': ['beard_stubble', 'beard_short_beard', 'beard_full_beard', 'beard_moustache'],
    'headwear': ['headwear_helm', 'headwear_hood', 'headwear_cap', 'headwear_wide'],
    'torso': ['apron_smith', 'apron_baker', 'apron_dusty', 'tunic_work', 'jerkin_travel', 'gambeson_guard',
              'gambeson_officer', 'coat_merchant', 'vest_tavern', 'robe_ceremonial', 'robe_healer',
              'tunic_destitute', 'tunic_plain', 'tunic_modest', 'tunic_comfortable', 'tunic_fine'],
    'legs': ['trousers_destitute', 'trousers_plain', 'trousers_modest', 'trousers_comfortable', 'trousers_fine'],
    'feet': ['boots_work', 'boots_travel', 'shoes_soft', 'shoes_fine', 'barefoot'],
    'outerwear': ['apron_plain'],
    'accessory': ['tool_hammer', 'tool_peel', 'tool_hoe', 'tool_axe', 'sack_grain', 'bow', 'spear',
                  'sword', 'ledger', 'tray', 'prayer_beads', 'satchel', 'pack'],
}
ACTIVITY_KEYS = [
    'travel', 'work', 'work/forge', 'work/bake', 'work/mill', 'work/tend', 'work/craft', 'work/serve',
    'work/chop', 'work/gather', 'work/repair', 'work/inspect', 'work/operate', 'work/record',
    'eat', 'eat/sit_and_eat', 'eat/eat_standing', 'drink', 'drink/drink_from_source', 'drink/drink_vessel',
    'rest', 'rest/sleep', 'rest/seated', 'rest/pray', 'socialize', 'socialize/converse',
    'socialize/sit_and_talk', 'trade', 'trade/barter', 'carry', 'carry/haul', 'carry/carry_travel',
    'flee', 'injured', 'injured/downed', 'idle',
]


def score(entry, retarget_skeletons):
    """Lower is better. Only assets we can actually drive are considered at all."""
    skeleton = entry.get('skeleton') or ''
    if entry.get('sharesDriverSkeleton'):
        return 0
    if skeleton in retarget_skeletons:
        return 1
    return None


def choose(candidates, token, retarget_skeletons):
    """Pick the best drivable candidate whose name most specifically matches the token."""
    needles = [part for part in token.split('_') if len(part) > 2]
    best = None
    for entry in candidates:
        rank = score(entry, retarget_skeletons)
        if rank is None:
            continue
        name = entry['name'].lower()
        matched = sum(1 for needle in needles if needle in name)
        if matched == 0:
            continue
        key = (rank, -matched, len(entry['name']))
        if best is None or key < best[0]:
            best = (key, entry)
    return best[1] if best else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inventory', default='docs/evidence/embodied-people/human-asset-inventory.json')
    parser.add_argument('--out', default='unreal/TornVeilOnline/Content/TornVeil/Presentation/CharacterPalette.json')
    parser.add_argument('--retarget', action='append', default=[],
                        help='SKELETON_PATH=ANIM_BP_CLASS_PATH for a non-driver humanoid skeleton')
    parser.add_argument('--authored', action='append', default=[],
                        help='CHARACTER_KEY=SKELETAL_MESH_PATH for a uniquely modelled character')
    args = parser.parse_args()

    with open(args.inventory) as handle:
        inventory = json.load(handle)

    retargets = dict(pair.split('=', 1) for pair in args.retarget)
    authored = dict(pair.split('=', 1) for pair in args.authored)
    retarget_skeletons = set(retargets)

    meshes = inventory['skeletalMeshes']
    animations = inventory['animations']

    palette = {
        'schema': 1,
        'purpose': ('Semantic token -> local asset. Written by build_character_palette.py from an '
                    'actual asset-registry inventory; never hand-listed from filenames. Canonical '
                    'simulation contains none of these paths.'),
        'driverSkeletons': sorted({DRIVER_SKELETON} | {s for s in inventory.get('skeletons', {}) if s.startswith(DRIVER_SKELETON)}),
        'authored': dict(authored),
        'bodies': {},
        'parts': {},
        'activities': {},
        'retargets': dict(retargets),
        'unresolved': {'bodies': [], 'parts': [], 'activities': []},
    }

    body_candidates = [m for m in meshes if m.get('proposedSlot') in ('body', 'head')]
    for token in BODY_TOKENS:
        picked = choose(body_candidates, token, retarget_skeletons)
        if picked:
            palette['bodies'][token] = picked['path'] + '.' + picked['name']
        else:
            palette['unresolved']['bodies'].append(token)

    for kind, tokens in PART_TOKENS.items():
        candidates = [m for m in meshes if m.get('proposedSlot') == kind]
        for token in tokens:
            picked = choose(candidates, token, retarget_skeletons)
            if picked:
                palette['parts'].setdefault(kind, {})[token] = picked['path'] + '.' + picked['name']
            else:
                palette['unresolved']['parts'].append(kind + '/' + token)

    for key in ACTIVITY_KEYS:
        family = key.split('/')[0]
        detail = key.split('/')[1] if '/' in key else None
        candidates = [a for a in animations if a.get('proposedFamily') == family]
        picked = choose(candidates, detail or family, retarget_skeletons)
        if picked:
            palette['activities'][key] = picked['path'] + '.' + picked['name']
        else:
            palette['unresolved']['activities'].append(key)

    palette['coverage'] = {
        'bodies': f"{len(palette['bodies'])}/{len(BODY_TOKENS)}",
        'parts': f"{sum(len(v) for v in palette['parts'].values())}/{sum(len(v) for v in PART_TOKENS.values())}",
        'activities': f"{len(palette['activities'])}/{len(ACTIVITY_KEYS)}",
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w') as handle:
        json.dump(palette, handle, indent=2, sort_keys=True)
    print('CHARACTER_PALETTE', json.dumps(palette['coverage']))
    if palette['unresolved']['bodies']:
        print('CHARACTER_PALETTE_UNRESOLVED_BODIES', json.dumps(palette['unresolved']['bodies']))


if __name__ == '__main__':
    main()
