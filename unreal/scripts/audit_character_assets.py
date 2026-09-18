"""Character Foundry Stage A: read-only inventory of this machine's installed human-character assets.

Run inside the Unreal Editor (see unreal/scripts/Run-EditorPython.ps1):

    Run-EditorPython.ps1 -Script unreal/scripts/audit_character_assets.py

Writes a MACHINE-LOCAL catalogue to `.debug/character-foundry/catalogue.json` (gitignored). The
paths in it name licensed Fab/Marketplace and engine content that is not redistributable, so it is
deliberately never committed and never enters canonical simulation state — it is read by the
presentation layer only. See docs/CHARACTER_FOUNDRY.md and src/foundry/catalogue.ts, which defines
the schema this emits.

Like audit_local_environment.py, this only reads the AssetRegistry: no asset is loaded, saved,
moved, or modified, and no external account is touched.
"""
import collections
import datetime
import json
import os
import re
import socket

import unreal

# --- Classification ---------------------------------------------------------------------------
#
# Content packs name things inconsistently, so slotting is by keyword over the package path plus
# asset name, most specific first. Getting a pack classified better is a change HERE; the
# resolver (src/foundry/resolve.ts) never learns about any particular pack.

SLOT_PATTERNS = [
    ('facialHair', r'beard|moustache|mustache|stubble|goatee|facialhair'),
    ('hair', r'\bhair\b|hairstyle|groom|_hair|hair_'),
    ('footwear', r'boot|shoe|sandal|geta|footwear|greave'),
    ('armor', r'armou?r|lamellar|cuirass|breastplate|pauldron|chainmail|plate_'),
    ('robe', r'robe|kimono|cassock|habit|gown'),
    ('upperGarment', r'shirt|tunic|jacket|coat|vest|top_|torso|upperbody|blouse|doublet|haori'),
    ('lowerGarment', r'pants|trouser|skirt|hakama|legs?_|lowerbody|breeches|kilt'),
    ('accessory', r'hat|hood|helm|cap|belt|scarf|bag|pack|pouch|jewel|necklace|earring|beads|mask|cloak|glove|bracer'),
    ('head', r'\bhead\b|face|skull|_hd\b'),
    ('body', r'body|torso_full|fullbody|base_?mesh|skm_|sk_'),
]

# Descriptive tags the resolver matches on. Same idea: keyword -> tag, evaluated over path + name.
TAG_PATTERNS = [
    ('female', r'female|_f\b|_fem|woman|girl'),
    ('male', r'(?<!fe)male|_m\b|_masc|\bman\b|boy'),
    ('unisex', r'unisex|neutral'),
    ('child', r'child|kid|young|boy|girl|teen'),
    ('elder', r'elder|old|aged|senior'),
    ('adult', r'adult|grown'),
    ('slim', r'slim|thin|skinny|lean'),
    ('heavy', r'heavy|fat|large|bulk'),
    ('muscular', r'muscul|strong|athletic|buff'),
    ('average', r'average|medium|normal|standard'),
    ('kimono', r'kimono|haori|yukata'),
    ('hakama', r'hakama'),
    ('robe', r'robe|gown|cassock|habit'),
    ('tunic', r'tunic|shirt|blouse|doublet'),
    ('coat', r'coat|jacket|cloak'),
    ('trousers', r'trouser|pants|breeches|legs?_'),
    ('skirt', r'skirt|dress'),
    ('wrap', r'wrap|sash|drape'),
    ('armor', r'armou?r|lamellar|cuirass|plate_|mail'),
    ('lamellar', r'lamellar|scale_?armou?r'),
    ('rags', r'rag|tatter|torn|beggar'),
    ('worn', r'worn|dirty|weather|used|damaged'),
    ('noble', r'noble|royal|rich|lord|fine|ornate'),
    ('peasant', r'peasant|common|poor|farmer|villager|work'),
    ('formal', r'formal|ceremon|ritual'),
    ('light', r'light|thin_'),
    ('fur', r'fur|pelt'),
    ('leather', r'leather|hide'),
    ('silk', r'silk|satin'),
    ('short', r'short|crop|buzz|pixie|bob'),
    ('long', r'long|flow'),
    ('bound', r'bun|ponytail|topknot|braid|tied|updo'),
    ('loose', r'loose|down|wavy|curly'),
    ('wavy', r'wavy|curl'),
    ('braid', r'braid|plait'),
    ('ponytail', r'ponytail|tail'),
    ('bun', r'\bbun\b'),
    ('topknot', r'topknot|chonmage'),
    ('updo', r'updo|upstyle'),
    ('beard', r'beard|goatee|moustache|mustache'),
    ('boots', r'boot|greave'),
    ('sandals', r'sandal|geta|zori'),
    ('shoes', r'shoe'),
    ('hat', r'hat|cap\b|straw'),
    ('hood', r'hood'),
    ('helm', r'helm'),
    ('beads', r'beads|rosary|mala'),
    ('staff', r'staff|cane|walking'),
    ('sword', r'sword|katana|blade|scabbard|sheath'),
    ('jewelry', r'jewel|necklace|earring|pendant|bangle|filigree'),
    ('hairpin', r'hairpin|kanzashi|ornament'),
    ('scarf', r'scarf|muffler'),
    ('belt', r'belt|cord|obi'),
    ('pack', r'backpack|rucksack|\bpack\b'),
    ('satchel', r'satchel|pouch|bag'),
    ('apron', r'apron'),
    ('stole', r'stole|mantle'),
    ('fan', r'\bfan\b'),
]

# Activity clips share the same inventory because appearance realization and animation compatibility
# must agree on the machine's skeleton graph. They are presentation execution assets, not appearance.
ACTIVITY_PATTERNS = [
    ('work', r'work|craft|forge|hammer|smith|saw|mine|chop|axe|dig|bake|knead'),
    ('eat', r'\beat\b|eating|meal|food'),
    ('drink', r'drink|mug|tankard|sip'),
    ('rest', r'\bsit\b|sitting|chair|sleep|\blie\b|lying|rest|idle_relax|kneel|pray'),
    ('socialize', r'talk|speak|converse|gesture|wave|greet|\bbow\b|laugh|shrug|explain|clap|point'),
    ('trade', r'trade|barter|give|offer|hand'),
    ('carry', r'carry|haul|lift|pickup|crate|sack'),
    ('travel', r'walk|jog|run|sprint|stride'),
    ('flee', r'flee|panic|scared|afraid|shrink'),
    ('injured', r'injur|limp|wound|hurt|death|die|downed|slump'),
]

SKELETAL_CLASSES = {'SkeletalMesh'}
GROOM_CLASSES = {'GroomAsset'}
STATIC_CLASSES = {'StaticMesh'}
CANDIDATE_CLASSES = SKELETAL_CLASSES | GROOM_CLASSES | STATIC_CLASSES

# Packs that are unambiguously not people. Skipping them keeps the catalogue honest rather than
# filling the accessory slot with tablecloths and chairs.
EXCLUDE_PATH = re.compile(
    r'/AdvancedVillagePack/|/Free_Medieval_Environment_Props|/RPGEnvironmentVFX/|/Megaplant|'
    r'/ThirdParty/Quaternius/|/WaterPlane/|/TornVeil/LocalPalette/|/Environment/|/Landscape', re.I)


def classify_slot(haystack):
    for slot, pattern in SLOT_PATTERNS:
        if re.search(pattern, haystack, re.I):
            return slot
    return None


def classify_tags(haystack):
    return [tag for tag, pattern in TAG_PATTERNS if re.search(pattern, haystack, re.I)]


def classify_activity(haystack):
    for family, pattern in ACTIVITY_PATTERNS:
        if re.search(pattern, haystack, re.I):
            return family
    return None


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(['/Game'], False)
    assets = registry.get_assets_by_path('/Game', True, True)

    skeleton_meshes = collections.Counter()
    skeleton_anims = collections.Counter()
    skeleton_names = {}
    entries, animations, retargeters, skipped = [], [], [], collections.Counter()

    for asset in assets:
        package = str(asset.package_name)
        name = str(asset.asset_name)
        kind = str(asset.asset_class_path.asset_name)
        haystack = package + '/' + name

        if kind == 'Skeleton':
            skeleton_names[package] = name
            continue
        if kind in ('IKRetargeter',):
            retargeters.append(dict(
                package=package,
                sourceSkeleton=str(asset.get_tag_value('SourceSkeleton') or '') or None,
                targetSkeleton=str(asset.get_tag_value('TargetSkeleton') or '') or None))
            continue
        if kind in ('AnimSequence', 'AnimMontage', 'BlendSpace', 'BlendSpace1D', 'AnimBlueprint'):
            skeleton = str(asset.get_tag_value('Skeleton') or '')
            if skeleton and '\'' in skeleton:
                skeleton = skeleton.split('\'')[-2]
            if skeleton:
                skeleton_anims[skeleton] += 1
            if kind != 'AnimBlueprint':
                family = classify_activity(haystack)
                animations.append(dict(package=package, name=name, assetClass=kind,
                                       skeleton=skeleton or None, proposedFamily=family))
            continue
        if kind not in CANDIDATE_CLASSES:
            continue
        if EXCLUDE_PATH.search(package):
            skipped['excluded-pack'] += 1
            continue

        slot = classify_slot(haystack)
        if not slot:
            skipped['unclassified'] += 1
            continue

        skeleton = str(asset.get_tag_value('Skeleton') or '')
        if skeleton and '\'' in skeleton:
            skeleton = skeleton.split('\'')[-2]
        if kind in SKELETAL_CLASSES and skeleton:
            skeleton_meshes[skeleton] += 1

        row = dict(package=package, name=name, assetClass=kind, slot=slot, tags=classify_tags(haystack))
        if skeleton:
            row['skeleton'] = skeleton
        materials = asset.get_tag_value('Materials')
        if materials:
            row['materialSlots'] = [m for m in re.split(r'[,\s]+', str(materials)) if m][:16]
        morphs = asset.get_tag_value('MorphTargets')
        if morphs:
            row['morphTargets'] = [m for m in re.split(r'[,\s]+', str(morphs)) if m][:64]
        entries.append(row)

    # The animation target is the skeleton this project's motion is actually bound to: most
    # animations, with retargeters pointing at it. Everything else is a source to retarget FROM.
    target = None
    if skeleton_anims:
        target = max(skeleton_anims.items(), key=lambda kv: (kv[1], skeleton_meshes[kv[0]]))[0]

    skeletons = [dict(package=pkg, name=skeleton_names.get(pkg, pkg.rsplit('/', 1)[-1]),
                      family=re.sub(r'(_Skeleton|SK_|SKM_)', '', skeleton_names.get(pkg, pkg.rsplit('/', 1)[-1])).lower(),
                      meshCount=skeleton_meshes.get(pkg, 0), animCount=skeleton_anims.get(pkg, 0))
                 for pkg in sorted(set(list(skeleton_names) + list(skeleton_meshes) + list(skeleton_anims)))]

    catalogue = dict(
        schema=1,
        generatedAt=datetime.datetime.utcnow().isoformat() + 'Z',
        machine=socket.gethostname(),
        animationTarget=target,
        skeletons=skeletons,
        retargeters=retargeters,
        entries=entries,
        animations=animations)

    root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
    folder = os.path.join(root, '.debug', 'character-foundry')
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, 'catalogue.json'), 'w', encoding='utf-8') as stream:
        json.dump(catalogue, stream, indent=2)

    by_slot = collections.Counter(row['slot'] for row in entries)
    print('TV_CHARACTER_AUDIT', len(entries), 'character assets;',
          len(animations), 'animation assets;', len(skeletons), 'skeletons;', len(retargeters), 'retargeters;',
          'target=' + str(target))
    for slot, count in sorted(by_slot.items()):
        print('  slot', slot, count)
    for reason, count in sorted(skipped.items()):
        print('  skipped', reason, count)
    if not entries:
        print('  NOTE: no character assets classified. Install human/clothing/hair packs, or widen '
              'SLOT_PATTERNS above if this machine names them differently.')


main()
