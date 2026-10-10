"""Import original generated delivery artifacts. No Library transfer or art editing.
Usage: python scripts/items/import-collection.py /path/to/torn-veil-360-v2
Only run against a completed, corrected delivery; no Blender masters are copied.
"""
import json,pathlib,sys,shutil,hashlib
r=pathlib.Path(__file__).resolve().parents[2]; s=pathlib.Path(sys.argv[1]).resolve()
c=json.loads((s/'catalog.json').read_text())
receipt_bytes=(s/'shoulder-fix-receipt.json').read_bytes()
receipt=json.loads(receipt_bytes)
expected={'status':'complete','revision':'v2.1 shoulder clearance','collection_count':360,'static_glb_count':360,'fitted_glb_count':160,'corrected_paired_shoulder_variants':32,'contact_test_count':288,'contact_test_pass':True,'pose_range_unchanged':True,'all_changed_shoulders_reimported':True}
assert all(receipt.get(k)==v for k,v in expected.items()), 'Corrected shoulder delivery is not certified complete'
assert len(receipt['files'])==520
origin_files={f['file']:f for f in receipt['files']}
assert len(origin_files)==520
assert [i['id'] for i in c['items']] == [f'TV-{n:03d}' for n in range(1,361)], 'Expected stable exact360'
assert len(list((s/'glb').glob('*.glb'))) == 360
assert len(list((s/'rigged').glob('*.glb'))) == 160
m={'Swords':'sword','Daggers':'dagger','Axes':'axe','Hammers':'hammer','Books':'book','Lanterns':'lantern','Keys':'key','Picks':'pickaxe'}
data=[]; assets=[]
for i in c['items']:
 assert i['asset']=='glb/'+i['id']+'.glb'
 for sex,path in i.get('fitting_variants',{}).items(): assert sex in ('male','female') and path=='rigged/'+i['id']+'-'+sex+'.glb'
 d={k:v for k,v in i.items() if k not in ('asset','thumbnail','fitting_variants','fitting_revision','fitting_clearance')}
 d['mechanicalType']=m.get(i['family']); d['mechanicsStatus']='existing-type-only' if d['mechanicalType'] else 'design-only'; data.append(d)
 assets.append({'id':i['id'],'staticPath':'items/v1.1/'+i['asset'],**({'fittingPaths':{k:'items/v1.1/'+v for k,v in i['fitting_variants'].items()}} if 'fitting_variants' in i else {})})
(r/'src/sim/content/itemCollectionData.json').write_text(json.dumps({'collection':c['collection'],'rarityNote':c['rarity_note'],'items':data,'sets':c['sets']},indent=2)+'\n')
(r/'src/web/items/itemAssetData.json').write_text(json.dumps(assets,indent=2)+'\n')

out=r/'web/public/items/v1.1'; out.mkdir(parents=True,exist_ok=True)
files=[]
for folder in ('glb','rigged'):
 (out/folder).mkdir(exist_ok=True)
 for f in sorted((s/folder).glob('*.glb')):
  b=f.read_bytes(); assert b[:4]==b'glTF' and int.from_bytes(b[4:8],'little')==2 and int.from_bytes(b[8:12],'little')==len(b), f
  origin=origin_files[folder+'/'+f.name]
  assert origin['bytes']==len(b) and origin['sha256']==hashlib.sha256(b).hexdigest(), 'Delivery receipt mismatch: '+str(f)
  shutil.copyfile(f,out/folder/f.name)
  files.append({'path':folder+'/'+f.name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
(out/'manifest.json').write_text(json.dumps({'collectionVersion':'v1.1','sourceCollection':c['collection'],'origin':'Original cloud-generated Torn Veil 360 v2 delivery, copied without geometry modification','staticCount':360,'fittedPrototypeCount':160,'files':files},indent=2)+'\n')
# Standalone review catalogue has no dangling thumbnail links; all geometry paths stay local.
public={**c,'items':[{k:v for k,v in i.items() if k!='thumbnail'} for i in c['items']]}
(out/'catalog.json').write_text(json.dumps(public,indent=2)+'\n')
for name in ('README.txt','geometry-validation.json','rig-validation.json','export-validation.json','shoulder-clearance-validation.json','shoulder-clearance-report.json'):
 if (s/name).exists(): shutil.copyfile(s/name,out/name)
print(f'Imported {len(data)} definitions, {len(files)} GLBs; {sum(bool(i["mechanicalType"]) for i in data)} supported existing-type designs')
# Publish a technical provenance receipt without local machine paths or private Library IDs.
public_receipt={k:v for k,v in receipt.items() if k not in ('local_root','history_archive','updated_library_files','files','validation_files')}
public_receipt['origin_receipt_sha256']=hashlib.sha256(receipt_bytes).hexdigest()
public_receipt['validation_files']=[pathlib.Path(f).name for f in receipt['validation_files']]
public_receipt['files']=[{k:v for k,v in f.items() if k!='local_path'} for f in receipt['files']]
(out/'shoulder-fix-receipt.json').write_text(json.dumps(public_receipt,indent=2)+'\n')
