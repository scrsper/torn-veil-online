"""Rebuild `M_TV_AshfordCloth` and its four region instances, without re-importing 66 meshes.

    unreal/scripts/Run-EditorPython.ps1 -Script unreal/scripts/rebuild_ashford_materials.py

The meshes reference the instances by path, so a shader change needs no re-import. There is
exactly one definition of this material and it lives in `import_ashford_garments.py`; this is a
way to run that definition on its own, not a second copy of it.
"""
import os
import sys

import unreal

# `Invoke-EditorPython.ps1` runs scripts through `exec(open(...).read(), {...})`, which defines no
# `__file__`, so the scripts directory is derived from the project instead.
sys.path.insert(0, os.path.abspath(os.path.join(unreal.Paths.project_dir(), '..', 'scripts')))

import import_ashford_garments as importer          # noqa: E402

parent = importer.build_material()
instances = importer.build_region_instances(parent)
unreal.log('TV_ASHFORD_MATERIALS rebuilt parent + %d region instances' % len(instances))
