"""Classification regression checks without loading Unreal or licensed meshes."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest

sys.modules.setdefault('unreal', types.ModuleType('unreal'))
spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit_character_assets.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AssetClassificationTests(unittest.TestCase):
    def test_parts_in_armor_folder_keep_their_actual_slots(self):
        root = '/Game/Polytope_Studio/Modular_Armors/Meshes/Separate_Parts/'
        for name, slot in [('SK_Female_Head_01', 'head'), ('SK_Female_Hair_01', 'hair'),
                           ('SK_Male_Beard_01', 'facialHair'), ('SK_Female_Armor_cloth_00_Body', 'upperGarment'),
                           ('SK_Female_Armor_01_A_Boots', 'footwear')]:
            self.assertEqual(audit.classify_slot(root + name), slot, name)

    def test_headless_body_is_not_a_head_and_arms_are_not_a_body(self):
        self.assertEqual(audit.classify_slot('/Game/QuantumCharacter/Mesh/SKM_QuantumCharacter_NoHead'), 'body')
        self.assertEqual(audit.classify_slot('/Game/QuantumCharacter/Mesh/Modules/SKM_Arms'), 'accessory')

    def test_city_clothing_is_not_counted_as_bodies(self):
        for name, slot in [('f_tal_nrw_scoopneck', 'upperGarment'), ('m_tal_unw_crewneck', 'upperGarment'),
                           ('f_tal_nrw_slacks_belt', 'lowerGarment'), ('f_tal_nrw_dressFlats', 'footwear'),
                           ('f_001_nrw_FaceMesh', 'head')]:
            self.assertEqual(audit.classify_slot('/Game/CitySampleCrowd/' + name), slot, name)

    def test_ashford_garments_land_in_the_slot_their_name_claims(self):
        root = '/Game/TornVeil/Characters/Ashford/'
        for name, slot in [('SKM_TV_Kosode_Work_female_nrw', 'upperGarment'),
                           ('SKM_TV_Kosode_Wide_male_ovw', 'upperGarment'),
                           ('SKM_TV_Haori_female_unw', 'accessory'),
                           ('SKM_TV_Hakama_male_nrw', 'lowerGarment'),
                           ('SKM_TV_MoSkirt_female_nrw', 'lowerGarment'),
                           ('SKM_TV_Obi_female_nrw', 'accessory'),
                           ('SKM_TV_Maekake_male_nrw', 'accessory'),
                           ('SKM_TV_Geta_female_nrw', 'footwear'),
                           ('SKM_TV_Waraji_male_unw', 'footwear'),
                           ('SKM_TV_TabiBoot_male_nrw', 'footwear')]:
            self.assertEqual(audit.classify_slot(root + name), slot, name)

    def test_ashford_garments_carry_the_tags_the_manifest_asks_for_by_name(self):
        """The manifest already requests `kimono`, `hakama`, `sandals` and the rest. This is the
        join between what the simulation asks for and what the audit is able to say about a mesh,
        and it is the whole reason the wardrobe dresses anybody."""
        root = '/Game/TornVeil/Characters/Ashford/'
        for name, expected in [
            # A kosode answers a kimono request and a plain `tunic` one, which is what stops an
            # ordinary resident falling through to City Sample business wear.
            # 'coat' too: this culture's travelling wear is a kosode with a haori over it,
            # not a coat worn against the skin.
            ('SKM_TV_Kosode_Work_female_nrw', {'kimono', 'tunic', 'coat', 'female', 'peasant', 'work'}),
            # The wide-sleeved cut is also this culture's formal and ceremonial upper layer.
            ('SKM_TV_Kosode_Wide_male_nrw', {'kimono', 'tunic', 'robe', 'wrap', 'formal', 'male'}),
            ('SKM_TV_Hakama_male_nrw', {'hakama', 'trousers', 'male'}),
            ('SKM_TV_MoSkirt_female_nrw', {'skirt', 'robe', 'female'}),
            ('SKM_TV_Obi_female_nrw', {'obi', 'belt', 'female'}),
            ('SKM_TV_Maekake_male_nrw', {'apron', 'male'}),
            # Sandals answer `shoes` too: Ashford has no closed shoe.
            ('SKM_TV_Geta_female_nrw', {'sandals', 'shoes', 'female'}),
            ('SKM_TV_Waraji_male_unw', {'sandals', 'shoes', 'male'}),
            ('SKM_TV_TabiBoot_male_nrw', {'boots', 'male'}),
            # A haori answers only 'haori'. It is an open-fronted over-layer, and City
            # Sample bodies are hands only, so one resolving as somebody's *only* upper
            # garment is a hole in the chest -- caught in the Ashford 33 on a miller, a
            # woodcutter and a bandit.
            ('SKM_TV_Haori_female_unw', {'haori', 'female'}),
        ]:
            tags = set(audit.classify_tags(root + name))
            self.assertTrue(expected.issubset(tags), '%s got %s, missing %s'
                            % (name, sorted(tags), sorted(expected - tags)))

    def test_the_projects_own_name_does_not_dress_everyone_in_tatters(self):
        """`torn` used to match `TornVeil`, so every asset the project itself owns was tagged
        `rags` -- and `rags` is one of only two disqualifying tags in the manifest. The first
        character content this project ever shipped would have been refused for every resident
        above `poor`, with no error anywhere. Caught by the Ashford tag test above."""
        for name in ('SKM_TV_Kosode_Work_female_nrw', 'SKM_TV_Obi_male_nrw', 'SKM_TV_Geta_female_unw'):
            tags = audit.classify_tags('/Game/TornVeil/Characters/Ashford/' + name)
            self.assertNotIn('rags', tags, name)
        # Content that really is ragged still says so.
        self.assertIn('rags', audit.classify_tags('/Game/SomePack/SK_Torn_Cloak'))
        self.assertIn('rags', audit.classify_tags('/Game/SomePack/SK_Tattered_Robe'))

    def test_ashford_garments_declare_the_build_they_were_cut_for(self):
        root = '/Game/TornVeil/Characters/Ashford/'
        self.assertEqual(audit.geometry_metadata(root + 'SKM_TV_Hakama_male_ovw', 'lowerGarment'),
                         {'fits': ['city:male:ovw']})
        self.assertEqual(audit.geometry_metadata(root + 'SKM_TV_Obi_female_unw', 'accessory'),
                         {'fits': ['city:female:unw']})
        # A name that does not follow the convention gets no fit claim rather than a wrong one.
        self.assertEqual(audit.geometry_metadata(root + 'SKM_TV_Something', 'accessory'), {})

    def test_human_requires_head_spine_and_bilateral_limbs(self):
        human = {'pelvis', 'spine_01', 'head', 'upperarm_l', 'upperarm_r', 'thigh_l', 'thigh_r'}
        self.assertEqual(audit.humanoid_bones(human), 'ue')
        self.assertIsNone(audit.humanoid_bones({'root', 'head', 'spine_01', 'tail'}))
        self.assertIsNone(audit.humanoid_bones(human - {'upperarm_r'}))

    def test_demo_mannequins_do_not_inflate_new_people(self):
        self.assertTrue(audit.EXCLUDE_PATH.search('/Game/Polytope_Studio/Demo/Characters/Mannequins/Meshes/SKM_Manny'))


if __name__ == '__main__':
    unittest.main()
