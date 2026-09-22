"""Export the vendor meshes that carry *skin*, so the Ashford garments know where the seams are.

`export_garment_fit_reference.py` established the shapes to build against. This establishes the
other half of the contract, which is not documented anywhere in the vendor pack and was wrong in
our own notes: **which mesh supplies which patch of bare skin.**

Measured on this machine, City Sample's modular body is not "a nude body plus clothes". It is:

  body          both hands, and nothing else
  head/FaceMesh head, neck and upper chest
  lowerGarment  the trousers *and* the bare feet below them
  upperGarment  torso and arms only, no skin
  footwear      a shoe shell over the feet the lowerGarment already drew

So a garment that replaces the trousers has to bring the feet with it, and a garment with an open
collar is relying on the face mesh to reach far enough down. Both are dimensions this export
exists to measure rather than guess.
"""
import os
import unreal

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, '.debug', 'ashford-garments', 'seams')

# The MetaHuman FaceMesh is deliberately absent. It carries fifteen LOD-specific material slots
# and the FBX skeletal exporter indexes past the end of its section array on this engine version
# (`Array.h:1339`), taking the commandlet with it. It is also not needed: the vendor's own
# *open-necked* tops carry no skin section at all, so the lowest point of a scoopneck's neckline
# IS the measurement -- it is how far down the vendor was willing to trust the face mesh to reach.
PACKAGES = {
    # An open neckline: the shape that has to meet the face mesh without a gap.
    'scoopneck_f': '/Game/CitySampleCrowd/Character/Female/NormalWeight/Meshes/f_tal_nrw_scoopneck',
    # A skirt: the closest vendor analogue to a hakama's hem, and it carries feet skin.
    'skirt_f': '/Game/CitySampleCrowd/Character/Female/NormalWeight/Meshes/f_tal_nrw_skirt',
    # A short sleeve, for where a work kosode's sleeve can end without needing forearm skin.
    'crewneck_m': '/Game/CitySampleCrowd/Character/Male/NormalWeight/Meshes/m_tal_nrw_crewneck',
}


def main():
    os.makedirs(OUT, exist_ok=True)
    missing = []
    for label, package in PACKAGES.items():
        asset = unreal.load_asset(package)
        if asset is None:
            missing.append(package)
            unreal.log_warning('TV_SEAM missing %s' % package)
            continue
        task = unreal.AssetExportTask()
        task.object = asset
        task.filename = os.path.join(OUT, '%s.fbx' % label)
        task.automated = True
        task.prompt = False
        task.replace_identical = True
        options = unreal.FbxExportOption()
        options.vertex_color = True
        options.collision = False
        options.level_of_detail = False
        options.export_morph_targets = False
        options.export_preview_mesh = False   # see export_garment_fit_reference.py
        task.options = options
        ok = unreal.Exporter.run_asset_export_task(task)
        unreal.log('TV_SEAM %s %s -> %s' % ('ok' if ok else 'FAILED', label, task.filename))
        if not ok:
            missing.append(package)
    unreal.log('TV_SEAM_SUMMARY exported=%d missing=%d' % (len(PACKAGES) - len(missing), len(missing)))
    if missing:
        raise RuntimeError('seam export incomplete: %s' % missing)


main()
