"""Small, renderer-owned visual profiles for canonical-place projection.

This is deliberately presentation data, not a second world generator.  A caller supplies a
canonical place footprint, terrain, resource state and seed; a profile decides the silhouette,
material palette and deterministic variation used to make that fact visible.  Adding a desert,
city or another world later means adding a profile and its families, not changing the settlement
projection's canonical traversal.
"""
from dataclasses import dataclass
import hashlib


@dataclass(frozen=True)
class BuildingFamily:
    name: str
    variants: tuple
    roof: str
    props: tuple


@dataclass(frozen=True)
class CultureVisualProfile:
    key: str
    display_name: str
    biome: str
    materials: dict
    families: dict
    occupation_cues: dict
    status_accents: dict


ASHFORD_JAPANESE_MEDIEVAL_FANTASY = CultureVisualProfile(
    key='ashford_japanese_medieval_fantasy',
    display_name='Ashford Japanese / Medieval Fantasy',
    biome='temperate_valley',
    materials={
        'roof': 'tile', 'structure': 'timber', 'wall': 'plaster', 'foundation': 'stone',
        'path': 'path', 'lantern': 'paper', 'banner': 'banner', 'accent': 'indigo',
    },
    # A/B/C are intentional silhouette choices drawn from the supplied dwelling/workshop/temple
    # sheets.  The seed chooses one; no place name chooses one.
    families={
        'dwelling': BuildingFamily('dwelling', ('low_gable', 'raised_sidewing', 'two_storey'), 'gable', ('woodpile', 'jar')),
        'workshop': BuildingFamily('workshop', ('forge_front', 'open_shed', 'storage_lean_to'), 'gable', ('anvil', 'timber_stack')),
        'shop': BuildingFamily('shop', ('open_front', 'deep_noren', 'two_storey_shop'), 'gable', ('counter', 'basket', 'banner')),
        'temple': BuildingFamily('temple', ('small_shrine', 'ceremonial_hall', 'layered_hall'), 'layered', ('steps', 'lantern_pillar', 'crest_banner')),
        'stall': BuildingFamily('stall', ('noren_canopy', 'tile_canopy', 'side_canopy'), 'canopy', ('counter', 'basket', 'banner')),
        'civic': BuildingFamily('civic', ('guard_porch', 'meeting_hall', 'tall_gatehouse'), 'gable', ('banner', 'lantern')),
        'industrial': BuildingFamily('industrial', ('mill_house', 'sawpit_shed', 'storage_frame'), 'gable', ('timber_stack', 'crate')),
    },
    occupation_cues={
        'baker': 'bread_basket', 'smith': 'hammer', 'merchant': 'ledger', 'innkeeper': 'tray',
        'farmer': 'hoe', 'guard': 'spear', 'captain': 'sword', 'priest': 'beads',
        'hunter': 'bow', 'woodcutter': 'axe', 'miller': 'grain_sack', 'healer': 'satchel',
    },
    status_accents={'modest': 'indigo', 'prosperous': 'banner', 'ceremonial': 'gold'},
)

PROFILES = {ASHFORD_JAPANESE_MEDIEVAL_FANTASY.key: ASHFORD_JAPANESE_MEDIEVAL_FANTASY}


def profile_for(key):
    if key not in PROFILES:
        raise ValueError('No visual profile installed for %s' % key)
    return PROFILES[key]


def stable_variant(seed, identity, options):
    """Stable across authoring order and runs; identifiers, not place labels, key variation."""
    digest = hashlib.sha256(('%s:%s' % (seed, identity)).encode('utf-8')).digest()
    return options[int.from_bytes(digest[:4], 'little') % len(options)]


def family_for_place(place_type):
    if place_type in ('house', 'hut', 'farmhouse'):
        return 'dwelling'
    if place_type in ('bakery', 'store', 'tavern'):
        return 'shop'
    if place_type in ('smithy', 'mill', 'sawpit', 'construction'):
        return 'workshop' if place_type == 'smithy' else 'industrial'
    if place_type in ('chapel', 'shrine'):
        return 'temple'
    if place_type == 'stall':
        return 'stall'
    if place_type in ('guardhouse', 'gate'):
        return 'civic'
    return ''
