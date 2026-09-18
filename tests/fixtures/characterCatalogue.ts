import type { CatalogueEntry, CharacterCatalogue, FoundrySlot } from '../../src/foundry/catalogue';

/**
 * Stand-in catalogues for Foundry tests.
 *
 * The real catalogue is machine-local and describes licensed content that is not in this
 * repository, so the resolver is tested against synthesised ones instead. That is not a
 * compromise: the resolver's contract is "match tags, relax when you must, report what you could
 * not do", and a fixture exercises that contract exactly as a real pack would. What a fixture
 * cannot tell us is whether a real pack's assets are *classified* well — that is the audit
 * script's job and it needs the Windows machine.
 */

const MANNY = '/Game/Characters/Mannequins/Meshes/SK_Mannequin';
const OTHER = '/Game/SomePack/SK_ForeignRig';
/** A motion pack's own rig: clips but no meshes, reachable only through a retargeter. */
const MOTION_RIG = '/Game/Fab/MotionPack/clip_Skeleton';

let counter = 0;
function entry(slot: FoundrySlot, name: string, tags: string[], options: Partial<CatalogueEntry> = {}): CatalogueEntry {
  counter++;
  return {
    package: `/Game/Fixture/${slot}/${name}`,
    name,
    assetClass: options.assetClass ?? 'SkeletalMesh',
    slot,
    skeleton: options.skeleton ?? MANNY,
    tags,
    ...(options.materialSlots ? { materialSlots: options.materialSlots } : {}),
    ...(options.morphTargets ? { morphTargets: options.morphTargets } : {}),
  };
}

/** A well-stocked modular pack: every slot covered, both cuts, three ages, several builds. */
export function richCatalogue(): CharacterCatalogue {
  counter = 0;
  const morphs = ['heavy', 'muscular', 'tall', 'aged', 'feminine'];
  const entries: CatalogueEntry[] = [
    entry('body', 'SKM_Body_M_Adult', ['male', 'adult', 'average'], { morphTargets: morphs, materialSlots: ['Skin'] }),
    entry('body', 'SKM_Body_M_Adult_Heavy', ['male', 'adult', 'heavy'], { morphTargets: morphs, materialSlots: ['Skin'] }),
    entry('body', 'SKM_Body_M_Adult_Muscular', ['male', 'adult', 'muscular'], { morphTargets: morphs, materialSlots: ['Skin'] }),
    entry('body', 'SKM_Body_F_Adult', ['female', 'adult', 'average'], { morphTargets: morphs, materialSlots: ['Skin'] }),
    entry('body', 'SKM_Body_F_Adult_Slim', ['female', 'adult', 'slim'], { morphTargets: morphs, materialSlots: ['Skin'] }),
    entry('body', 'SKM_Body_U_Child', ['unisex', 'child', 'slim'], { morphTargets: morphs, materialSlots: ['Skin'] }),
    entry('body', 'SKM_Body_M_Elder', ['male', 'elder', 'slim'], { morphTargets: morphs, materialSlots: ['Skin'] }),
    entry('body', 'SKM_Body_F_Elder', ['female', 'elder', 'slim'], { morphTargets: morphs, materialSlots: ['Skin'] }),

    entry('head', 'SKM_Head_M_Adult_Square', ['male', 'adult', 'square'], { materialSlots: ['Skin'] }),
    entry('head', 'SKM_Head_M_Adult_Angular', ['male', 'adult', 'angular'], { materialSlots: ['Skin'] }),
    entry('head', 'SKM_Head_M_Adult_Oval', ['male', 'adult', 'oval'], { materialSlots: ['Skin'] }),
    entry('head', 'SKM_Head_F_Adult_Heart', ['female', 'adult', 'heart'], { materialSlots: ['Skin'] }),
    entry('head', 'SKM_Head_F_Adult_Oval', ['female', 'adult', 'oval'], { materialSlots: ['Skin'] }),
    entry('head', 'SKM_Head_F_Adult_Round', ['female', 'adult', 'round'], { materialSlots: ['Skin'] }),
    entry('head', 'SKM_Head_U_Child', ['unisex', 'child', 'round'], { materialSlots: ['Skin'] }),
    entry('head', 'SKM_Head_M_Elder', ['male', 'elder', 'long'], { materialSlots: ['Skin'] }),
    entry('head', 'SKM_Head_F_Elder', ['female', 'elder', 'long'], { materialSlots: ['Skin'] }),

    entry('hair', 'GRM_Hair_Short_M', ['short', 'male'], { assetClass: 'GroomAsset', skeleton: undefined }),
    entry('hair', 'GRM_Hair_Short_Bob', ['short', 'loose', 'female'], { assetClass: 'GroomAsset', skeleton: undefined }),
    entry('hair', 'GRM_Hair_Long_Loose', ['long', 'loose', 'female'], { assetClass: 'GroomAsset', skeleton: undefined }),
    entry('hair', 'GRM_Hair_Long_Wavy', ['long', 'loose', 'wavy', 'female'], { assetClass: 'GroomAsset', skeleton: undefined }),
    entry('hair', 'GRM_Hair_Topknot', ['bound', 'topknot', 'male'], { assetClass: 'GroomAsset', skeleton: undefined }),
    entry('hair', 'GRM_Hair_Bun', ['bound', 'bun'], { assetClass: 'GroomAsset', skeleton: undefined }),
    entry('hair', 'GRM_Hair_Braid', ['bound', 'braid', 'female'], { assetClass: 'GroomAsset', skeleton: undefined }),
    entry('hair', 'GRM_Hair_Ponytail', ['bound', 'ponytail'], { assetClass: 'GroomAsset', skeleton: undefined }),
    entry('hair', 'GRM_Hair_Updo', ['bound', 'updo', 'female'], { assetClass: 'GroomAsset', skeleton: undefined }),
    entry('hair', 'GRM_Hair_Medium_Tied', ['bound', 'medium'], { assetClass: 'GroomAsset', skeleton: undefined }),
    entry('facialHair', 'GRM_Beard_Full', ['beard'], { assetClass: 'GroomAsset', skeleton: undefined }),

    entry('upperGarment', 'SKM_Kimono_Work', ['kimono', 'work', 'peasant', 'unisex']),
    entry('upperGarment', 'SKM_Kimono_Layered', ['kimono', 'layered', 'common']),
    entry('upperGarment', 'SKM_Kimono_Formal_F', ['kimono', 'formal', 'noble', 'female', 'silk']),
    entry('upperGarment', 'SKM_Kimono_Formal_M', ['kimono', 'formal', 'noble', 'male', 'silk']),
    entry('upperGarment', 'SKM_Tunic_Common', ['tunic', 'common', 'unisex']),
    entry('upperGarment', 'SKM_Tunic_Rags', ['tunic', 'rags', 'worn', 'unisex']),
    entry('upperGarment', 'SKM_Coat_Travel', ['coat', 'leather', 'worn']),
    entry('upperGarment', 'SKM_Coat_Fur', ['coat', 'fur', 'noble']),
    entry('upperGarment', 'SKM_Wrap_Dancer', ['wrap', 'light', 'female']),
    entry('upperGarment', 'SKM_Robe_Upper', ['robe', 'unisex']),

    entry('lowerGarment', 'SKM_Hakama_Work', ['hakama', 'work', 'peasant']),
    entry('lowerGarment', 'SKM_Hakama_Formal', ['hakama', 'formal', 'noble', 'silk']),
    entry('lowerGarment', 'SKM_Trousers_Common', ['trousers', 'common', 'unisex']),
    entry('lowerGarment', 'SKM_Trousers_Rags', ['trousers', 'rags', 'worn']),
    entry('lowerGarment', 'SKM_Skirt_Light', ['skirt', 'light', 'female']),
    entry('lowerGarment', 'SKM_Robe_Lower', ['robe', 'unisex']),

    entry('robe', 'SKM_Robe_Ceremonial', ['robe', 'ceremonial', 'formal', 'noble']),
    entry('robe', 'SKM_Robe_Ascetic', ['robe', 'ascetic', 'worn', 'peasant']),
    entry('robe', 'SKM_Robe_Formal', ['robe', 'formal', 'silk']),

    entry('armor', 'SKM_Armor_Lamellar', ['armor', 'lamellar', 'leather']),
    entry('armor', 'SKM_Armor_Lamellar_Fine', ['armor', 'lamellar', 'noble', 'ornate']),

    entry('footwear', 'SKM_Sandals', ['sandals', 'peasant']),
    entry('footwear', 'SKM_Sandals_Fine', ['sandals', 'noble']),
    entry('footwear', 'SKM_Boots_Leather', ['boots', 'leather', 'worn']),
    entry('footwear', 'SKM_Shoes_Common', ['shoes', 'common']),
  ];

  const accessories: [string, string[]][] = [
    ['SM_Beads', ['beads']], ['SM_Staff', ['staff']], ['SM_Sword', ['sword']], ['SM_Fan', ['fan']],
    ['SM_Pack', ['pack']], ['SM_Jewelry', ['jewelry', 'noble']], ['SM_Hairpin', ['hairpin']],
    ['SM_Stole_Fur', ['stole', 'fur']], ['SM_Scarf', ['scarf']], ['SM_Belt', ['belt']],
    ['SM_Hood', ['hood']], ['SM_Helm', ['helm']], ['SM_Hat_Straw', ['hat', 'peasant']],
    ['SM_Hammer', ['hammer']], ['SM_Hoe', ['hoe']], ['SM_Spear', ['spear']], ['SM_Bow', ['bow']],
    ['SM_Axe', ['axe']], ['SM_Satchel', ['satchel']], ['SM_Book', ['book']], ['SM_Tray', ['tray']],
    ['SM_Basket', ['basket']], ['SM_Sack', ['sack']], ['SM_Apron', ['apron']],
  ];
  for (const [name, tags] of accessories) entries.push(entry('accessory', name, tags, { assetClass: 'StaticMesh', skeleton: undefined }));

  return {
    schema: 1, generatedAt: new Date(0).toISOString(), machine: 'fixture',
    animationTarget: MANNY,
    skeletons: [
      { package: MANNY, name: 'SK_Mannequin', family: 'manny', meshCount: 40, animCount: 500 },
      { package: OTHER, name: 'SK_ForeignRig', family: 'foreign', meshCount: 2, animCount: 0 },
    ],
    retargeters: [],
    entries,
  };
}

/** A thin pack: one unisex adult body and head, one tunic, nothing else. Exercises relaxation. */
export function sparseCatalogue(): CharacterCatalogue {
  counter = 0;
  return {
    schema: 1, generatedAt: new Date(0).toISOString(), machine: 'fixture-sparse',
    animationTarget: MANNY,
    skeletons: [{ package: MANNY, name: 'SK_Mannequin', family: 'manny', meshCount: 3, animCount: 500 }],
    retargeters: [],
    entries: [
      entry('body', 'SKM_Body_Generic', ['unisex']),
      entry('head', 'SKM_Head_Generic', ['unisex']),
      entry('upperGarment', 'SKM_Tunic_Generic', ['tunic']),
    ],
  };
}

/** A pack whose meshes are all on a rig this project cannot animate. Exercises the skeleton gate. */
export function foreignSkeletonCatalogue(): CharacterCatalogue {
  counter = 0;
  return {
    schema: 1, generatedAt: new Date(0).toISOString(), machine: 'fixture-foreign',
    animationTarget: MANNY,
    skeletons: [{ package: OTHER, name: 'SK_ForeignRig', family: 'foreign', meshCount: 4, animCount: 0 }],
    retargeters: [],
    entries: [
      entry('body', 'SKM_Body_Foreign', ['male', 'adult', 'average'], { skeleton: OTHER }),
      entry('head', 'SKM_Head_Foreign', ['male', 'adult', 'oval'], { skeleton: OTHER }),
    ],
  };
}

/**
 * What a machine with the engine mannequins and motion packs but no character packs actually has.
 *
 * This is not a hypothetical thin pack like `sparseCatalogue` — it is the shape of the real audited
 * catalogue on the development machine: two monolithic whole-body characters, no separate heads, no
 * hair, no garments, and a motion pack whose clips live on their own rig behind a retargeter. It
 * exists so the honest floor of this project's presentation is a tested state rather than something
 * only ever observed by eye in a PIE session.
 */
export function mannequinOnlyCatalogue(): CharacterCatalogue {
  counter = 0;
  return {
    schema: 1, generatedAt: new Date(0).toISOString(), machine: 'fixture-mannequin-only',
    animationTarget: MANNY,
    skeletons: [
      { package: MANNY, name: 'SK_Mannequin', family: 'manny', meshCount: 2, animCount: 150 },
      { package: MOTION_RIG, name: 'clip_Skeleton', family: 'motion', meshCount: 0, animCount: 109 },
    ],
    retargeters: [{ package: '/Game/TornVeil/Combat/Repair/RTG_TV_CombatRepair', sourceSkeleton: MOTION_RIG, targetSkeleton: MANNY }],
    entries: [
      entry('body', 'SKM_Manny_Simple', ['male', 'adult', 'average', 'wholeBody'], { materialSlots: ['M_Mannequin'] }),
      entry('body', 'SKM_Quinn_Simple', ['female', 'adult', 'slim', 'wholeBody'], { materialSlots: ['M_Mannequin'] }),
    ],
  };
}

export const FIXTURE_ANIMATION_TARGET = MANNY;
export const FIXTURE_FOREIGN_SKELETON = OTHER;
export const FIXTURE_MOTION_RIG = MOTION_RIG;
