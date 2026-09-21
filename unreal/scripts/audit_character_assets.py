"""Character Foundry Stage A: read-only inventory of this machine's installed human-character assets.

Run inside the Unreal Editor (see unreal/scripts/Run-EditorPython.ps1):

    Run-EditorPython.ps1 -Script unreal/scripts/audit_character_assets.py

Writes a MACHINE-LOCAL catalogue to `.debug/character-foundry/catalogue.json` (gitignored). The
paths in it name licensed Fab/Marketplace and engine content that is not redistributable, so it is
deliberately never committed and never enters canonical simulation state — it is read by the
presentation layer only. See docs/CHARACTER_FOUNDRY.md and src/foundry/catalogue.ts, which defines
the schema this emits.

Like audit_local_environment.py, nothing is saved, moved, or modified, and no external account is
touched. Unlike it, this script does *load* skeletons and skeletal meshes read-only, because the
one question that matters most — "is this actually a person?" — has no AssetRegistry tag. Reading a
bone hierarchy is the only honest way to answer it; see `humanoid_bones`.
"""
import collections
import datetime
import hashlib
import json
import os
import re
import socket

import unreal

# --- Classification ---------------------------------------------------------------------------
#
# Content packs name things inconsistently. Classify the asset name before consulting folders:
# an "Armors" folder can contain heads, hair and bags. Getting a pack classified better is a change HERE; the
# resolver (src/foundry/resolve.ts) never learns about any particular pack.

SLOT_PATTERNS = [
    ('facialHair', r'beard|moustache|mustache|stubble|goatee|facialhair'),
    ('hair', r'\bhair\b|hairstyle|groom|_hair|hair_'),
    ('footwear', r'boot|shoe|sandal|geta|waraji|zori|tabi|footwear|greave|oxford|loafer|dressflats'),
    ('head', r'\bhead\b|face|skull|_hd\b'),
    ('robe', r'robe|kimono|cassock|habit|gown'),
    ('upperGarment', r'shirt|tunic|kosode|jacket|\bcoat\b|\bvest\b|\btop\b|torso|upperbody|blouse|doublet|haori|turtleneck|scoopneck|crewneck|buttonopen|buttondown'),
    ('lowerGarment', r'pants|jeans|trouser|slacks|skirt|hakama|\blegs?\b|lowerbody|breeches|kilt'),
    # Word boundaries matter more here than anywhere else: without them `pack` matched every asset
    # in a pack whose folder is called `..._Motion_Pack`, and `cap` matches "capture", "escape" and
    # "capacity". The same lesson applies to `top_` under upperGarment.
    ('accessory', r'\bhat\b|\bobi\b|maekake|apron|hood|helm|\bcap\b|\bbelt\b|scarf|\bbag\b|\bpack\b|pouch|jewel|necklace|earring|beads|mask|cloak|cape|glove|gauntlet|bracer|holster|patch|drops'),
    ('armor', r'armou?r|lamellar|cuirass|breastplate|pauldron|chainmail|plate_|bulletproof'),
    # `sk_`/`skm_` is the catch-all of last resort: in practice every skeletal mesh in a project
    # matches it, including pickaxes, lockers, flashlights and deer. That is only safe because
    # `body` and `head` are additionally gated on a humanoid bone hierarchy below — the naming
    # convention proposes, the skeleton decides.
    ('body', r'body|torso_full|fullbody|base_?mesh|skm_|sk_'),
]

# Slots whose asset has to be an actual person. Anything else a naming convention sweeps up here is
# rejected on evidence rather than on a blocklist that would need a new line per content pack.
HUMANOID_SLOTS = {'body', 'head'}

# Two rig vocabularies cover every humanoid pack seen so far: Epic's UE4/UE5 mannequin convention
# and the Mixamo/Maya convention that most motion-capture packs ship. A rig is humanoid when it has
# a spine, a head, and a left/right pair of both arms and legs in ONE of these vocabularies. Bone
# counts and mesh sizes are deliberately not used: a 90-bone prop and a 90-bone person look
# identical by that measure.
HUMANOID_SIGNATURES = [
    ('ue', [('pelvis',), ('spine_01', 'spine_02', 'spine_03'), ('head',),
            ('upperarm_l',), ('upperarm_r',), ('thigh_l',), ('thigh_r',)]),
    ('mixamo', [('Hips',), ('Spine', 'Spine1', 'Spine2', 'Chest'), ('Head',),
                ('LeftArm', 'LeftShoulder'), ('RightArm', 'RightShoulder'),
                ('LeftUpLeg', 'LeftLeg'), ('RightUpLeg', 'RightLeg')]),
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
    ('kimono', r'kimono|kosode|haori|yukata'),
    ('hakama', r'hakama'),
    ('obi', r'(?<![a-z])obi(?![a-z])'),
    ('robe', r'robe|gown|cassock|habit|kosode_wide|moskirt'),
    ('tunic', r'tunic|shirt|blouse|doublet|kosode'),
    ('coat', r'coat|jacket|cloak|haori'),
    ('trousers', r'trouser|pants|breeches|legs?_|hakama'),
    ('skirt', r'skirt|dress'),
    ('wrap', r'wrap|sash|drape|kosode_wide|(?<![a-z])obi(?![a-z])'),
    ('armor', r'armou?r|lamellar|cuirass|plate_|mail'),
    ('lamellar', r'lamellar|scale_?armou?r'),
    # Letter lookarounds, not \b. Every asset name in this project is underscore-separated,
    # and \b does not fire between an underscore and a letter -- so \btorn\b missed
    # SK_Torn_Cloak, while a bare torn matched the project's own name and tagged every
    # asset under /Game/TornVeil/ as rags. Both are disqualifying for anyone above poor.
    ('rags', r'(?<![a-z])rags?(?![a-z])|tatter|(?<![a-z])torn(?![a-z])|beggar'),
    ('worn', r'worn|dirty|weather|used|damaged'),
    ('noble', r'noble|royal|rich|lord|fine|ornate'),
    ('peasant', r'peasant|common|poor|farmer|villager|work'),
    # Distinct from 'peasant': the manifest ranks a working cut above a formal one for the
    # work_kimono silhouette, and without a tag of its own that preference matched nothing.
    ('work', r'(?<![a-z])work(?![a-z])'),
    ('formal', r'formal|ceremon|ritual|kosode_wide'),
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
    # Ashford has no closed shoe: its sandals answer a request for 'shoes' because that is what
    # this culture's ordinary footwear is. Without this an ordinary resident in a tunic/trousers
    # silhouette resolves to City Sample oxfords and the whole settlement reverts to modern.
    ('sandals', r'sandal|geta|zori|waraji'),
    ('shoes', r'shoe|geta|waraji|zori'),
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
    ('apron', r'apron|maekake'),
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
    r'/ThirdParty/Quaternius/|/WaterPlane/|/TornVeil/LocalPalette/|/Environment/|/Landscape|'
    # Motion packs. A pack shipped as one FBX per clip imports a rig preview mesh alongside every
    # clip, and those meshes are whole bodies in a T-pose -- never wearable content. Their
    # animations and skeletons are collected further up, before this check, so excluding the path
    # costs no motion; it only stops 100+ identical rig meshes entering the accessory slot.
    r'/Motifect_[A-Za-z_]*Motion_Pack/|/AnimStarterPack/|'
    # Demo prop meshes that ship beside a sample animation set: ladders, lockers, pickaxes.
    r'/FreeSampleAnimationSet/Demo/Meshes/|/Polytope_Studio/(?:Modular_Armors/)?Demo/', re.I)


# Epic's own mannequins are the one place where a hand-written interpretation beats any regex:
# `Manny` and `Quinn` carry no descriptive token at all, so without this table the Foundry cannot
# honour `presentation` even though the two meshes plainly differ. This is the same kind of
# deliberate, checkable reading as src/sim/world/characterArchetypes.ts — an author's statement
# about known content, not a guess derived from a filename.
# `placeholder` marks the engine/template silhouettes. They are complete, animatable bodies and
# must stay in the catalogue -- on a machine with no character packs they are the only thing
# standing between a person and no mesh at all. But they are untextured grey dummies, so they must
# never win a slot a real character asset could have filled. They tie with real modular bodies on
# every tag a rule ranks by (`female`+`slim` is as true of Quinn as of a City Sample body), and a
# tie is broken by the person's own stream -- which is why, before this tag existed, roughly a
# third of a settlement rendered as mannequins. `slotRules` forbids the tag, and `resolveSlot`
# drops forbidden tags only after every relaxation step, so the fallback still works and is still
# last.
KNOWN_BODY_TAGS = [
    (r'/SKM_Manny(_Simple)?$', ['male', 'adult', 'average', 'placeholder']),
    (r'/SKM_Quinn(_Simple)?$', ['female', 'adult', 'slim', 'placeholder']),
    (r'/SKM_UEFN_Mannequin$', ['unisex', 'adult', 'average', 'placeholder']),
    (r'/HeroTPP$', ['male', 'adult', 'muscular', 'placeholder']),
]

_BONE_CACHE = {}
bone_probe_method = 'none'


def bone_names(mesh):
    """Bone names of a skeletal mesh's reference skeleton.

    UE's Python surface for this has moved between versions, so each known route is tried in turn
    and the one that worked is reported in the catalogue. A failure here returns an empty set, which
    makes the humanoid gate fail *closed* -- an unclassifiable mesh is left out of the catalogue
    rather than being offered to the resolver as a possible human body.
    """
    global bone_probe_method
    key = str(mesh.get_path_name())
    if key in _BONE_CACHE:
        return _BONE_CACHE[key]
    names = set()
    try:
        component = unreal.SkeletalMeshComponent()
        if hasattr(component, 'set_skeletal_mesh_asset'):
            component.set_skeletal_mesh_asset(mesh)
        else:
            component.set_skeletal_mesh(mesh)
        count = component.get_num_bones()
        names = {str(component.get_bone_name(index)) for index in range(count)}
        if names:
            bone_probe_method = 'SkeletalMeshComponent.get_bone_name'
    except Exception:
        names = set()
    if not names:
        try:
            skeleton = mesh.get_editor_property('skeleton')
            names = {str(n) for n in unreal.Skeleton.get_reference_pose_bone_names(skeleton)}
            if names:
                bone_probe_method = 'Skeleton.get_reference_pose_bone_names'
        except Exception:
            names = set()
    _BONE_CACHE[key] = names
    return names


def package_of(path):
    """Normalise an Unreal path to its package form.

    The AssetRegistry gives a skeleton two different ways: `asset.package_name` is
    `/Game/X/SK_Y`, while a `Skeleton` tag on a mesh or animation is the object path
    `/Game/X/SK_Y.SK_Y`. Mixing the two silently doubles the skeleton count and makes every
    comparison between a mesh's skeleton and the animation target a coin toss, so everything is
    reduced to the package form on the way in.
    """
    if not path:
        return ''
    text = str(path)
    if "'" in text:                       # SkeletonName'/Game/X/SK_Y.SK_Y'
        text = text.split("'")[-2]
    head, _, tail = text.rpartition('.')
    return head if head and '/' not in tail else text


def retargeter_row(package, name):
    """Which two rigs an IK Retargeter bridges.

    `SourceSkeleton`/`TargetSkeleton` are not AssetRegistry tags on an IKRetargeter, so reading them
    that way silently yields null and the whole retarget graph collapses to nothing. The real answer
    is on the asset: each side references an IK Rig, and an IK Rig's preview mesh names the skeleton.
    """
    row = dict(package=package, sourceSkeleton=None, targetSkeleton=None)
    try:
        asset = unreal.load_asset(package + '.' + name)
        if not asset:
            return row
        for field, side in (('sourceSkeleton', 'source'), ('targetSkeleton', 'target')):
            rig = None
            for prop in ('%s_ik_rig' % side, '%s_ik_rig_asset' % side):
                try:
                    rig = asset.get_editor_property(prop)
                except Exception:
                    rig = None
                if rig:
                    break
            if not rig:
                continue
            mesh = None
            for prop in ('preview_mesh', 'preview_skeletal_mesh'):
                try:
                    mesh = rig.get_editor_property(prop)
                except Exception:
                    mesh = None
                if mesh:
                    break
            if not mesh:
                continue
            skeleton = mesh.get_editor_property('skeleton')
            if skeleton:
                row[field] = package_of(skeleton.get_path_name())
    except Exception:
        pass
    return row


def skeleton_bone_names(package, probe_mesh=None):
    """Bone names of a Skeleton asset, for grouping rig-identical skeletons.

    Motion packs that ship one FBX per clip produce one Skeleton asset per clip -- dozens of
    separate assets describing the *same* rig. Grouping them by bone set turns "109 incompatible
    skeletons" into "one rig, imported 109 times", which is the difference between needing 109 IK
    Retargeters and needing one.
    """
    # A mesh bound to this skeleton is the one route that is known to work (see `bone_names`), so
    # try it first and only fall back to poking at the Skeleton asset itself.
    if probe_mesh:
        try:
            mesh = unreal.load_asset(probe_mesh)
            if mesh:
                names = bone_names(mesh)
                if names:
                    return names
        except Exception:
            pass
    for candidate in (package, package + '.' + package.rsplit('/', 1)[-1]):
        try:
            skeleton = unreal.load_asset(candidate)
            if not skeleton:
                continue
            if hasattr(unreal.Skeleton, 'get_reference_pose_bone_names'):
                names = {str(n) for n in unreal.Skeleton.get_reference_pose_bone_names(skeleton)}
                if names:
                    return names
            # Every skeleton has at least one mesh-free route to its bones: its own preview mesh
            # when it has one, else the bone tree property.
            preview = skeleton.get_editor_property('preview_mesh') if hasattr(skeleton, 'get_editor_property') else None
            if preview:
                names = bone_names(preview)
                if names:
                    return names
            tree = skeleton.get_editor_property('bone_tree')
            if tree:
                names = {str(node.get_editor_property('name')) for node in tree}
                if names:
                    return names
        except Exception:
            continue
    return set()


def rig_signature(names):
    """Stable id for a bone set, so identical rigs collapse to one group regardless of asset name."""
    if not names:
        return None
    digest = hashlib.sha1('\n'.join(sorted(names)).encode('utf-8')).hexdigest()[:12]
    return 'rig_' + digest


def humanoid_bones(names):
    """Which rig vocabulary this bone set speaks, or None when it is not a person."""
    for convention, groups in HUMANOID_SIGNATURES:
        if all(any(bone in names for bone in group) for group in groups):
            return convention
    return None


def classify_slot(haystack):
    # Verified vendor conventions; full sets and modular fragments must not be conflated.
    if '/Polytope_Studio/Modular_Armors/' in haystack:
        name = haystack.rsplit('/', 1)[-1].lower()
        if '/Sets/' in haystack:
            return 'body'
        if name.endswith('_body'):
            return 'body' if '_naked_' in name else 'upperGarment' if '_cloth_' in name else 'armor'
    if haystack.rsplit('/', 1)[-1] == 'SKM_QuantumCharacter_NoHead':
        return 'body'
    if haystack.rsplit('/', 1)[-1] == 'SKM_Arms':
        return 'accessory'
    # Underscores are separators, not word characters in vendor asset names.
    name = haystack.rsplit('/', 1)[-1].replace('_', ' ')
    for slot, pattern in SLOT_PATTERNS:
        if slot != 'body' and re.search(pattern, name, re.I):
            return slot
    if re.search(SLOT_PATTERNS[-1][1], haystack.rsplit('/', 1)[-1], re.I):
        return 'body'
    return None


def human_face_bones(names):
    # MetaHuman head meshes omit the legs. Require the observed facial rig, not just 'head'.
    return {'head', 'neck_01', 'FACIAL_C_FacialRoot', 'FACIAL_C_Jaw',
            'FACIAL_L_Eye', 'FACIAL_R_Eye'}.issubset(names)


def geometry_metadata(package, slot):
    """Inspected pack geometry conventions. Unknown content keeps the conservative default."""
    name = package.rsplit('/', 1)[-1]
    if '/TornVeil/Characters/Ashford/' in package:
        # Project-owned cultural clothing, generated by art/tools/ashford_garments/ and skinned to
        # the City Sample clothing rig. One mesh per bind pose per build, named
        # `SKM_TV_<Piece>_<sex>_<build>`, exactly the convention the vendor garments follow --
        # because the six builds share `SK_Base` but not a reference pose, so a garment cut for
        # one of them does not fit another.
        parts = name.rsplit('_', 2)
        if len(parts) == 3 and parts[1] in ('female', 'male') and parts[2] in ('nrw', 'ovw', 'unw'):
            return {'fits': ['city:%s:%s' % (parts[1], parts[2])]}
        return {}
    if '/Polytope_Studio/Modular_Armors/' in package:
        sex = 'female' if 'Female' in name else 'male'
        family = 'polytope:' + sex
        if '/Sets/' in package:
            if '_naked_' in name.lower():
                return {'assemblyOnly': True}
            covered = ['head', 'upperGarment', 'lowerGarment', 'footwear']
            if '_cloth_' not in name.lower():
                covered.append('armor')
            return {'fitFamily': family, 'covers': covered}
        return {'fits': [family], 'assemblyOnly': slot == 'body'}
    if '/QuantumCharacter/' in package:
        if name in ('SKM_QuantumCharacter', 'SKM_QuantumCharacter_NoHead'):
            covered = ['upperGarment', 'lowerGarment', 'footwear', 'armor', 'accessory']
            if name == 'SKM_QuantumCharacter':
                covered.append('head')
            return {'fitFamily': 'quantum:male', 'covers': covered}
        return {'fits': ['quantum:male'], 'assemblyOnly': name == 'SKM_Arms'}
    if '/CitySampleCrowd/Character/' in package:
        sex = 'female' if '/Female/' in package else 'male'
        builds = ['nrw', 'unw', 'ovw']
        fits = ['city:' + sex + ':' + build for build in builds]
        if slot == 'head' or slot in ('hair', 'facialHair'):
            # A card LOD is not an independent hairstyle. The GroomAsset owns those LOD meshes.
            return {'fits': fits, 'assemblyOnly': '_LOD' in name or 'CardsMesh' in name}
        build = next((b for b in builds if '_' + b + '_' in name), None)
        if build:
            family = 'city:' + sex + ':' + build
            if slot == 'body':
                # This mesh is hands only; the vendor's tops, bottoms and shoes contain the rest
                # of the visible body. Completeness requires all of that geometry, plus a face.
                return {'fitFamily': family, 'requires': ['head', 'upperGarment', 'lowerGarment', 'footwear']}
            return {'fits': [family]}
    return {}


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
    rejected_humanoid, rig_convention = [], {}
    skeleton_bones, skeleton_probe_mesh = {}, {}
    groom_bindings = []

    for asset in assets:
        package = str(asset.package_name)
        name = str(asset.asset_name)
        kind = str(asset.asset_class_path.asset_name)
        haystack = package + '/' + name

        if kind == 'Skeleton':
            skeleton_names[package] = name
            continue
        if kind == 'GroomBindingAsset':
            binding = asset.get_asset()
            if binding.groom and binding.target_skeletal_mesh:
                groom_bindings.append(dict(package=package,
                    groom=package_of(binding.groom.get_path_name()),
                    targetMesh=package_of(binding.target_skeletal_mesh.get_path_name())))
            binding = None
            unreal.SystemLibrary.collect_garbage()
            continue
        if kind in ('IKRetargeter',):
            retargeters.append(retargeter_row(package, name))
            continue
        if kind in ('AnimSequence', 'AnimMontage', 'BlendSpace', 'BlendSpace1D', 'AnimBlueprint'):
            skeleton = package_of(asset.get_tag_value('Skeleton'))
            if skeleton:
                skeleton_anims[skeleton] += 1
            if kind != 'AnimBlueprint':
                family = classify_activity(haystack)
                animations.append(dict(package=package, name=name, assetClass=kind,
                                       skeleton=skeleton or None, proposedFamily=family))
            continue
        if kind not in CANDIDATE_CLASSES:
            continue
        # Remember one mesh per skeleton before anything is filtered out. A Skeleton asset has no
        # reliable Python route to its own bones, but a mesh bound to it does, and motion-pack
        # skeletons only ever have their excluded rig mesh -- so this has to be recorded here,
        # before the exclusion, or the rig graph loses exactly the skeletons it exists to explain.
        if kind in SKELETAL_CLASSES:
            bound = package_of(asset.get_tag_value('Skeleton'))
            if bound and bound not in skeleton_probe_mesh:
                skeleton_probe_mesh[bound] = package + '.' + name
        if EXCLUDE_PATH.search(package):
            skipped['excluded-pack'] += 1
            continue

        slot = classify_slot(haystack)
        if not slot:
            skipped['unclassified'] += 1
            continue

        skeleton = package_of(asset.get_tag_value('Skeleton'))
        if kind in SKELETAL_CLASSES and skeleton:
            skeleton_meshes[skeleton] += 1

        tag_text = haystack.replace('/Modular_Armors/', '/').replace('_Armor_cloth_', '_cloth_').replace('_Armor_naked_', '_naked_')
        tags = classify_tags(tag_text)
        if '/CitySampleCrowd/Character/' in package or '/Polytope_Studio/Modular_Armors/' in package:
            tags.append('adult')
        if '/CitySampleCrowd/Character/' in package:
            if '/UnderWeight/' in package:
                tags.append('slim')
            elif '/OverWeight/' in package:
                tags.append('heavy')
            elif '/NormalWeight/' in package:
                tags.append('average')
            # City Sample dresses a contemporary city: suits, blazers, slacks, oxfords. That is a
            # true descriptive fact about the asset, not a statement about the pack, and it is the
            # one the manifest needs -- a pre-industrial culture's silhouettes forbid it, so these
            # stop tying with cultural clothing on a coin flip. Bodies, faces and hair are not
            # tagged: a face is not modern or otherwise.
            if slot in ('upperGarment', 'lowerGarment', 'footwear', 'robe', 'armor'):
                tags.append('modern')
            if name.startswith('Hair_S_'):
                tags.append('short')
            elif name.startswith('Hair_M_'):
                tags.append('medium')
            elif name.startswith('Hair_L_'):
                tags.append('long')
        if '/QuantumCharacter/' in package:
            tags.extend(['male', 'adult', 'modern'])
        tags = sorted(set(tags))

        # A body or a head has to be a person. The naming convention only proposed it; the bone
        # hierarchy decides, and an unreadable hierarchy is treated as "not a person" so that a
        # prop can never reach the resolver as a candidate human body.
        convention, bones = None, set()
        if slot in HUMANOID_SLOTS or kind in SKELETAL_CLASSES:
            if kind not in SKELETAL_CLASSES:
                skipped['non-skeletal-' + slot] += 1
                continue
            mesh = unreal.load_asset(package + '.' + name)
            bones = bone_names(mesh) if mesh else set()
            convention = humanoid_bones(bones)
            if not convention and slot == 'head' and human_face_bones(bones):
                convention = 'metahuman-face'
            if not convention:
                skipped['not-humanoid'] += 1
                rejected_humanoid.append(dict(package=package, bones=len(bones)))
                continue
            rig_convention[skeleton or package] = convention
            for pattern, known in KNOWN_BODY_TAGS:
                if re.search(pattern, package, re.I):
                    tags = sorted(set(tags) | set(known))
                    break
            # A monolithic character carries its own head, so the Foundry must not keep asking for
            # a separate one it will never find.
            # A modular torso also has head bones. Geometry coverage cannot be inferred from
            # the skeleton: only explicitly inspected complete meshes satisfy the head slot.
            whole_body = any(re.search(pattern, package, re.I) for pattern, _ in KNOWN_BODY_TAGS)
            whole_body = whole_body or '/Polytope_Studio/Modular_Armors/Meshes/Sets/' in package
            whole_body = whole_body or package == '/Game/QuantumCharacter/Mesh/SKM_QuantumCharacter'
            if slot == 'body' and whole_body:
                tags = sorted(set(tags) | {'wholeBody'})

        row = dict(package=package, name=name, assetClass=kind, slot=slot, tags=tags)
        row.update(geometry_metadata(package, slot))
        if kind in STATIC_CLASSES:
            row['assemblyOnly'] = True  # render via the owning groom, never as a loose LOD card
        if slot == 'head' and '/CitySampleCrowd/' in package:
            material = package.split('/Face/')[0] + '/Materials/M_BodySynthesized'
            if unreal.EditorAssetLibrary.does_asset_exist(material):
                row['bodyMaterial'] = material
        if skeleton:
            row['skeleton'] = skeleton
        if convention:
            row['rigConvention'] = convention
        if kind in SKELETAL_CLASSES:
            mesh = asset.get_asset()
            row['materialSlots'] = [str(m.material_slot_name) for m in mesh.materials]
            row['materials'] = [m.material_interface.get_path_name() if m.material_interface else None for m in mesh.materials]
            row['morphTargets'] = [str(n) for n in mesh.get_all_morph_target_names()]
            for tag, field in [('Triangles', 'triangles'), ('Vertices', 'vertices'), ('LODs', 'lods')]:
                value = asset.get_tag_value(tag)
                if value and str(value).isdigit():
                    row[field] = int(value)
        entries.append(row)
        # Loading a face also loads its skin textures. Retaining every vendor mesh until the end
        # exhausted this machine's commit limit. Keep the inventory as plain data, release the
        # current mesh and finish texture jobs before collecting otherwise unused assets.
        if kind in SKELETAL_CLASSES:
            mesh = None
            unreal.SystemLibrary.execute_console_command(None, 'Editor.AsyncTextureCompilationFinishAll')
            unreal.SystemLibrary.collect_garbage()

    # The animation target is the skeleton this project's motion is actually bound to: most
    # animations, with retargeters pointing at it. Everything else is a source to retarget FROM.
    target = None
    if skeleton_anims:
        target = max(skeleton_anims.items(), key=lambda kv: (kv[1], skeleton_meshes[kv[0]]))[0]

    # An IK asset sitting on disk does not mean the visible component has an executable adapter.
    # Inventory the runtime palette separately and only enable compiled ABPs on the right rig.
    runtime_skeletons = []
    palette_dir = os.path.join(unreal.Paths.project_content_dir(), 'TornVeil/Presentation')
    palette_path = os.path.join(palette_dir, 'CharacterPalette.local.json')
    if not os.path.isfile(palette_path):
        palette_path = os.path.join(palette_dir, 'CharacterPalette.json')
    if os.path.isfile(palette_path):
        with open(palette_path, encoding='utf-8') as handle:
            palette = json.load(handle)
        for skeleton, class_path in palette.get('retargets', {}).items():
            blueprint = unreal.load_asset(class_path[:-2]) if class_path.endswith('_C') else None
            if not isinstance(blueprint, unreal.AnimBlueprint):
                continue
            if blueprint.get_editor_property('status') != unreal.BlueprintStatus.BS_UP_TO_DATE:
                continue
            bound = blueprint.get_editor_property('target_skeleton')
            if bound and package_of(bound.get_path_name()) == package_of(skeleton):
                runtime_skeletons.append(package_of(skeleton))

    skeletons = []
    for pkg in sorted(set(list(skeleton_names) + list(skeleton_meshes) + list(skeleton_anims))):
        label = skeleton_names.get(pkg, pkg.rsplit('/', 1)[-1])
        bones = skeleton_bone_names(pkg, skeleton_probe_mesh.get(pkg))
        skeleton_bones[pkg] = bones
        row = dict(package=pkg, name=label,
                   family=re.sub(r'(_Skeleton|SK_|SKM_)', '', label).lower(),
                   meshCount=skeleton_meshes.get(pkg, 0), animCount=skeleton_anims.get(pkg, 0))
        signature = rig_signature(bones)
        if signature:
            row['rigGroup'] = signature
            row['boneCount'] = len(bones)
            convention = humanoid_bones(bones)
            if convention:
                row['rigConvention'] = convention
        skeletons.append(row)

    # One rig imported many times is the common shape of a motion pack, and it is the single most
    # useful starting point for inspecting this machine's animation graph. A bone set does NOT
    # establish equal parents or reference transforms; probe_character_families.py checks those.
    rig_groups = collections.defaultdict(list)
    for row in skeletons:
        if row.get('rigGroup'):
            rig_groups[row['rigGroup']].append(row)
    rigs = sorted(
        (dict(rigGroup=group,
              boneCount=members[0].get('boneCount', 0),
              rigConvention=members[0].get('rigConvention'),
              skeletons=len(members),
              meshes=sum(m['meshCount'] for m in members),
              animations=sum(m['animCount'] for m in members),
              representative=members[0]['package'],
              isAnimationTarget=any(m['package'] == target for m in members))
         for group, members in rig_groups.items()),
        key=lambda r: (-r['animations'], r['representative']))

    catalogue = dict(
        schema=1,
        generatedAt=datetime.datetime.utcnow().isoformat() + 'Z',
        machine=socket.gethostname(),
        animationTarget=target,
        runtimeSkeletons=sorted(set(runtime_skeletons)),
        skeletons=skeletons,
        rigs=rigs,
        retargeters=retargeters,
        entries=entries,
        groomBindings=groom_bindings,
        animations=animations,
        # How the humanoid gate was answered, and what it turned away. Without this a reader cannot
        # tell "this machine has no character packs" from "the bone probe silently failed", and
        # those two need completely different responses.
        audit=dict(boneProbe=bone_probe_method,
                   rejectedNonHumanoid=rejected_humanoid,
                   skipped=dict(skipped)))

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
    print('  bone probe:', bone_probe_method)
    for rig in rigs:
        print('  rig %s %s bones=%d skeletons=%d meshes=%d anims=%d%s' % (
            rig['rigGroup'], rig['rigConvention'] or 'non-humanoid', rig['boneCount'],
            rig['skeletons'], rig['meshes'], rig['animations'],
            ' TARGET' if rig['isAnimationTarget'] else ''))
    if bone_probe_method == 'none' and any(r['slot'] in HUMANOID_SLOTS for r in entries) is False:
        print('  WARNING: no bone probe worked, so every candidate body/head was rejected as '
              'unverifiable. This is a tooling failure, NOT a statement that the machine has no '
              'character content -- fix bone_names() before trusting the slot counts above.')
    if not entries:
        print('  NOTE: no character assets classified. Install human/clothing/hair packs, or widen '
              'SLOT_PATTERNS above if this machine names them differently.')


if __name__ == '__main__':
    main()
