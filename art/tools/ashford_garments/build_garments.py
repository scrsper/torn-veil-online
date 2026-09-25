"""Build the Ashford cultural garment set and export it for Unreal import.

    blender --background --python art/tools/ashford_garments/build_garments.py -- [--fit female_nrw]

One Blender session per fit family. For each, it imports that build's vendor garments (which is
where the correct bind pose and the correct skin weights both come from), generates the Ashford
pieces around them, transfers weights, and exports one FBX per piece to
`.debug/ashford-garments/out/`.

The vendor meshes are read and never written. Nothing derived from their geometry is exported --
weights are numbers, not shapes, and the shapes here are all generated from
`art/tools/ashford_garments/garments.py`. See `art/ASHFORD_GARMENTS.md` for the provenance
statement.
"""
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ashford_lib as lib          # noqa: E402
import garments as g               # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
IN = os.path.join(REPO, '.debug', 'ashford-garments')
OUT = os.path.join(IN, 'out')

FITS = ['female_nrw', 'female_ovw', 'female_unw', 'male_nrw', 'male_ovw', 'male_unw']

# What to build per fit family, and which vendor meshes are a sane weight source for each. A
# sleeve has to take its weights from something with sleeves; a hakama from something with legs.
PIECES = [
    ('Kosode_Work',  lambda fit: g.kosode(fit, wide_sleeve=False), ['turtleneck']),
    ('Kosode_Wide',  lambda fit: g.kosode(fit, wide_sleeve=True),  ['turtleneck']),
    ('Haori',        lambda fit: g.haori(fit),                     ['turtleneck']),
    ('Hakama',       lambda fit: g.hakama(fit),                    ['slacks']),
    ('Hakama_Short', lambda fit: g.hakama(fit, short=True),        ['slacks']),
    ('MoSkirt',      lambda fit: g.wrapped_skirt(fit),             ['slacks']),
    ('Obi',          lambda fit: g.obi(fit),                       ['turtleneck', 'slacks']),
    ('Maekake',      lambda fit: g.maekake(fit),                   ['slacks']),
    ('Geta',         lambda fit: g.geta(fit),                      ['oxfords', 'slacks']),
    ('Waraji',       lambda fit: g.waraji(fit),                    ['oxfords', 'slacks']),
    ('TabiBoot',     lambda fit: g.tabi_boot(fit),                 ['oxfords', 'slacks']),
]

REGIONS = ['turtleneck', 'slacks', 'oxfords']

# Focused repairs can regenerate an existing subset without rewriting the whole wardrobe.
selected_pieces = set(filter(None, os.environ.get('TV_GARMENT_PIECES', '').split(',')))
if selected_pieces:
    unknown = selected_pieces - {piece[0] for piece in PIECES}
    if unknown:
        raise RuntimeError('Unknown garment pieces: ' + ', '.join(sorted(unknown)))
    PIECES = [piece for piece in PIECES if piece[0] in selected_pieces]


def build_fit(name):
    lib.reset()
    sex = name.split('_')[0]

    vendor = {}
    armature = None
    for region in REGIONS:
        meshes, arm = lib.import_reference(os.path.join(IN, 'fit', '%s_%s.fbx' % (name, region)))
        vendor[region] = meshes
        # Every region's FBX brings its own copy of the rig; keep the first and hide the rest,
        # because all six are the same bind pose for this build and extra armatures would export.
        if armature is None:
            armature = arm
        else:
            for mesh in meshes:
                mesh.parent = armature
            bpy.data.objects.remove(arm, do_unlink=True)

    surface = lib.FitSurface([m for ms in vendor.values() for m in ms])
    fit = g.Fit(armature, surface, sex)

    report = {}
    for piece, make, sources in PIECES:
        build = make(fit)
        obj = lib.to_object(build, 'SKM_TV_%s_%s' % (piece, name))
        proxy = lib.bind_pose_object(build, '%s_proxy' % piece)
        lib.transfer_weights(obj, proxy, [m for r in sources for m in vendor[r]])
        stripped = lib.normalise_weights(obj)
        lib.smooth_and_finish(obj)
        lib.attach(obj, armature)

        path = os.path.join(OUT, name, 'SKM_TV_%s_%s.fbx' % (piece, name))
        lib.export_fbx([obj], armature, path)
        report[piece] = {**lib.stats(obj), 'strippedInfluences': stripped, 'fbx': path}
        print('TV_GARMENT built %s/%s verts=%d tris=%d groups=%d'
              % (name, piece, report[piece]['verts'], report[piece]['tris'],
                 report[piece]['groups']))
        obj.hide_set(True)

    return report


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = argv[argv.index('--fit') + 1] if '--fit' in argv else None
    fits = [only] if only else FITS

    report = {}
    for name in fits:
        report[name] = build_fit(name)

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'build-report.json' if not only else 'build-report-%s.json' % only)
    with open(path, 'w') as f:
        json.dump(report, f, indent=1)
    total = sum(p['tris'] for fit in report.values() for p in fit.values())
    print('TV_GARMENT_SUMMARY fits=%d pieces=%d tris=%d -> %s'
          % (len(report), sum(len(v) for v in report.values()), total, path))


main()
