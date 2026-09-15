"""Run in the licensed GameAnimationSample project. Read-only source; official AssetTools
migration to the ignored local dependency folder of the explicitly selected Torn Veil project.
No source package is saved and no sample gameplay framework is migrated."""
import unreal, os, json, hashlib
dest=os.environ['TV_PRESENTATION_PROJECT']
assert os.path.isfile(os.path.join(dest,'TornVeilOnline.uproject'))
base='/Game/Characters/UEFN_Mannequin/'
paths=[]
for gait in ['Walk','Run']:
    paths += ['Animations/'+gait+'/M_Neutral_'+gait+'_Loop_'+d for d in ['F','FR','RR','BR','B','BL','LL','FL']]
    paths += ['Animations/'+gait+'/M_Relaxed_'+gait+'_'+phase+'_'+d+'_Lfoot' for phase in ['Start','Stop'] for d in ['F','B','LL','RL']]
paths += ['Animations/Sprint/M_Neutral_Sprint_Loop_'+d for d in ['F','FL','FR']]
paths += ['Animations/Walk/M_Relaxed_Walk_Turn_180_'+d+'_Lfoot' for d in ['L','R']]
paths += ['Meshes/SKM_UEFN_Mannequin','Meshes/SK_UEFN_Mannequin']
reg=unreal.AssetRegistryHelpers.get_asset_registry()
selected=[]
for p in paths:
    package=base+p
    assert unreal.EditorAssetLibrary.does_asset_exist(package),package
    selected.append(package)
options=unreal.MigrationOptions();options.prompt=False;options.ignore_dependencies=True;options.asset_conflict=unreal.AssetMigrationConflict.SKIP
unreal.SystemLibrary.execute_console_command(None,'AssetTools.UseNewPackageMigration 0')
unreal.AssetToolsHelpers.get_asset_tools().migrate_packages(selected,os.path.join(dest,'Content'),options)
report={'sourceProject':os.path.abspath(unreal.Paths.project_dir()),'method':'Unreal AssetTools.migrate_packages, named animation/mesh/skeleton only',
        'license':'Epic sample content; local Unreal project use. Raw sample and derivatives excluded from public source.', 'packages':selected}
with open(os.path.join(dest,'../../.debug/locomotion-migration.json'),'w')as f:json.dump(report,f,indent=2)
print('LOCOMOTION_REFERENCE_MIGRATED',len(selected))
