"""Export the measured fit targets the Ashford garment set has to be built against.

The Character Foundry validation (docs/evidence/foundry-real-people/REAL_ASSET_VALIDATION.md)
established that City Sample garments bind to `SK_Base` while City Sample bodies bind to
`metahuman_base_skel`, and that the two rigs' reference poses differ by at most 1.3 cm. So a new
garment has to be *shaped* against the body meshes and *skinned* to `SK_Base`.

This script writes both halves out as FBX so Blender can see them:

  bodies/    the six nude builds (3 weights x 2 sexes) -- what the garment has to clear
  fit/       one vendor garment per body region per build, already skinned to `SK_Base` --
             the skeleton to bind to, and the weight source to transfer from

Read-only with respect to the project: it exports, it never modifies or saves an asset. The output
lands in `.debug/` because it is derived from licensed vendor content and must not be committed.
"""
import os
import unreal

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, '.debug', 'ashford-garments')

BUILDS = [
    ('female', 'nrw', 'Female/NormalWeight', 'f_tal_nrw'),
    ('female', 'ovw', 'Female/OverWeight', 'f_tal_ovw'),
    ('female', 'unw', 'Female/UnderWeight', 'f_tal_unw'),
    ('male', 'nrw', 'Male/NormalWeight', 'm_tal_nrw'),
    ('male', 'ovw', 'Male/OverWeight', 'm_tal_ovw'),
    ('male', 'unw', 'Male/UnderWeight', 'm_tal_unw'),
]

# One vendor garment per body region. Chosen for coverage, not for looks: the turtleneck is the
# only top that reaches the wrist and the neck (so it carries arm and collar weights), the slacks
# cover the whole leg, and the oxfords carry the foot.
REGIONS = ['turtleneck', 'slacks', 'oxfords']


def export(package, path):
    asset = unreal.load_asset(package)
    if asset is None:
        unreal.log_warning('TV_GARMENT_FIT missing %s' % package)
        return False
    task = unreal.AssetExportTask()
    task.object = asset
    task.filename = path
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    options = unreal.FbxExportOption()
    options.vertex_color = True
    options.collision = False
    options.level_of_detail = False       # LOD0 only; the authoring shape, not the whole chain
    options.export_morph_targets = True
    # Preview-mesh export routes through MeshMergeUtilities, which asserts on a null render
    # MeshObject in a headless commandlet (`SkinnedMeshComponent.cpp:4987`). The asset itself is
    # what we want anyway.
    options.export_preview_mesh = False
    task.options = options
    ok = unreal.Exporter.run_asset_export_task(task)
    unreal.log('TV_GARMENT_FIT %s %s -> %s' % ('ok' if ok else 'FAILED', package, path))
    return ok


def main():
    for sub in ('bodies', 'fit'):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)
    written = {'bodies': [], 'fit': []}
    for sex, weight, folder, prefix in BUILDS:
        body = '/Game/CitySampleCrowd/Character/%s/Meshes/%s_body' % (folder, prefix)
        dest = os.path.join(OUT, 'bodies', '%s_%s_body.fbx' % (sex, weight))
        if export(body, dest):
            written['bodies'].append(dest)
        for region in REGIONS:
            package = '/Game/CitySampleCrowd/Character/%s/Meshes/%s_%s' % (folder, prefix, region)
            dest = os.path.join(OUT, 'fit', '%s_%s_%s.fbx' % (sex, weight, region))
            if export(package, dest):
                written['fit'].append(dest)
    unreal.log('TV_GARMENT_FIT_SUMMARY bodies=%d fit=%d out=%s'
               % (len(written['bodies']), len(written['fit']), OUT))
    if len(written['bodies']) != len(BUILDS):
        raise RuntimeError('expected %d body exports, got %d' % (len(BUILDS), len(written['bodies'])))
    if len(written['fit']) != len(BUILDS) * len(REGIONS):
        raise RuntimeError('expected %d fit exports, got %d'
                           % (len(BUILDS) * len(REGIONS), len(written['fit'])))


main()
