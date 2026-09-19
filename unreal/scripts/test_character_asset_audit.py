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

    def test_human_requires_head_spine_and_bilateral_limbs(self):
        human = {'pelvis', 'spine_01', 'head', 'upperarm_l', 'upperarm_r', 'thigh_l', 'thigh_r'}
        self.assertEqual(audit.humanoid_bones(human), 'ue')
        self.assertIsNone(audit.humanoid_bones({'root', 'head', 'spine_01', 'tail'}))
        self.assertIsNone(audit.humanoid_bones(human - {'upperarm_r'}))

    def test_demo_mannequins_do_not_inflate_new_people(self):
        self.assertTrue(audit.EXCLUDE_PATH.search('/Game/Polytope_Studio/Demo/Characters/Mannequins/Meshes/SKM_Manny'))


if __name__ == '__main__':
    unittest.main()
