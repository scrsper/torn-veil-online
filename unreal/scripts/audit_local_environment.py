"""Read-only registry catalog. No asset loads, saves, moves, or external account access."""
import collections
import json
import os
import unreal

registry = unreal.AssetRegistryHelpers.get_asset_registry()
registry.scan_paths_synchronous(['/Game'], False)
assets = registry.get_assets_by_path('/Game', True, True)
root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
folder = os.path.join(root, '.debug/playable-world-slice2/local-assets')
os.makedirs(folder, exist_ok=True)
dependency_options = unreal.AssetRegistryDependencyOptions(
    include_hard_package_references=True, include_soft_package_references=True,
    include_searchable_names=False, include_hard_management_references=False,
    include_soft_management_references=False)
known_packages = {str(a.package_name) for a in assets}
dependency_cache = {}
rows, missing = [], []
for asset in assets:
    package = str(asset.package_name)
    kind = str(asset.asset_class_path.asset_name)
    parts = package.split('/')
    pack = '/'.join(parts[:4] if parts[2] in ('Fab', 'ThirdParty') else parts[:3])
    row = dict(package=package, name=str(asset.asset_name), assetClass=kind, pack=pack)
    # Registry tags do not instantiate meshes, skeletons, textures, or Blueprint classes.
    tags = {}
    for key in ('Skeleton', 'Parent', 'ParentClass', 'GeneratedClass', 'NumLODs',
                'Triangles', 'Vertices', 'Materials', 'Dimensions', 'HasVirtualizedData'):
        value = asset.get_tag_value(key)
        if value:
            tags[key] = str(value)
    if tags:
        row['tags'] = tags
    if kind not in ('Texture2D', 'TextureCube', 'Texture2DArray'):
        dependencies = [str(d) for d in registry.get_dependencies(asset.package_name, dependency_options)]
        row['dependencies'] = dependencies
        for dependency in dependencies:
            if dependency.startswith('/Script/') or dependency in known_packages:
                continue
            if dependency not in dependency_cache:
                dependency_cache[dependency] = bool(registry.get_assets_by_package_name(dependency, True))
            if not dependency_cache[dependency]:
                missing.append(dict(asset=package, dependency=dependency))
    rows.append(row)
counts = collections.defaultdict(collections.Counter)
for row in rows:
    counts[row['pack']][row['assetClass']] += 1
report = dict(assetCount=len(rows), packs=dict(counts), missingDependencyCandidates=missing,
              redirectors=[r['package'] for r in rows if r['assetClass'] == 'ObjectRedirector'], assets=rows)
with open(os.path.join(folder, 'registry.json'), 'w', encoding='utf-8') as stream:
    json.dump(report, stream, indent=2)
print('TV_LOCAL_ASSET_AUDIT', len(rows), 'assets', len(counts), 'packs',
      len(missing), 'unresolved dependency candidates', len(report['redirectors']), 'redirectors')
