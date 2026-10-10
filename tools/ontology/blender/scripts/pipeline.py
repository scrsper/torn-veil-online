"""Asset preparation, never simulation authority. Run only on trusted source assets."""
import argparse, json, math, sys, os
from pathlib import Path
import bpy
from mathutils import Vector

def import_asset(path):
    ext=Path(path).suffix.lower()
    if ext in ('.glb','.gltf'): bpy.ops.import_scene.gltf(filepath=str(Path(path).resolve()))
    elif ext=='.fbx': bpy.ops.import_scene.fbx(filepath=str(Path(path).resolve()))
    elif ext=='.obj': bpy.ops.wm.obj_import(filepath=str(Path(path).resolve()))
    else: raise ValueError('Supported imports: glTF, GLB, FBX, OBJ. Blend files require a reviewed append policy.')

def bounds(objects):
    bpy.context.view_layer.update()
    points=[o.matrix_world@Vector(c) for o in objects if o.type=='MESH' for c in o.bound_box]
    if not points: raise ValueError('No meshes imported')
    return Vector(tuple(min(p[i] for p in points) for i in range(3))),Vector(tuple(max(p[i] for p in points) for i in range(3)))

def asset_objects():
    # Blender's glTF importer creates armature custom-shape helpers in a hidden,
    # non-exported collection. Including them corrupts scale and ground placement.
    return [o for o in bpy.context.scene.objects if not any(c.name=='glTF_not_exported' for c in o.users_collection)]

def normalize(objects,height):
    if not math.isfinite(height) or height<=0:raise ValueError('Height must be finite and positive')
    lo,hi=bounds(objects)
    if hi.z-lo.z<=0: raise ValueError('Degenerate bounds')
    # A parent transform keeps bind matrices, mesh weights and animation channels intact.
    root=bpy.data.objects.new('Ontology_Meters_ZUp',None);bpy.context.scene.collection.objects.link(root)
    for obj in objects:
        if obj.parent is None: obj.parent=root
    scale=height/(hi.z-lo.z)
    root.scale=(scale,scale,scale)
    root.location=(-0.5*(lo.x+hi.x)*scale,-0.5*(lo.y+hi.y)*scale,-lo.z*scale)
    bpy.context.view_layer.update()
    return root

def inspect(objects):
    lo,hi=bounds(objects);meshes=[o for o in objects if o.type=='MESH'];arms=[o for o in objects if o.type=='ARMATURE']
    missing=[i.filepath for i in bpy.data.images if i.source=='FILE' and not i.packed_file and not Path(bpy.path.abspath(i.filepath)).exists()]
    degenerate=sum(1 for o in meshes for p in o.data.polygons if p.area<1e-12)
    errors=[]
    if missing: errors.append('Missing texture files')
    if any(not math.isfinite(v) for o in meshes for vertex in o.data.vertices for v in vertex.co): errors.append('Nonfinite geometry')
    return {'technicalPass':not errors,'errors':errors,'warnings':['Visual review required; no automatic approval']+(['Degenerate polygons detected'] if degenerate else []),'dimensionsM':list(hi-lo),'meshCount':len(meshes),'vertices':sum(len(o.data.vertices) for o in meshes),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes),'degeneratePolygons':degenerate,'skeletons':[{'name':o.name,'bones':len(o.data.bones),'roots':[b.name for b in o.data.bones if not b.parent]} for o in arms],'materials':[m.name for m in bpy.data.materials],'missingTextures':missing,'actions':[a.name for a in bpy.data.actions],'visualQuality':'UNREVIEWED','qualityStatus':'PROTOTYPE'}

def point_at(obj,target): obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()

def preview(objects,out,turntable=False):
    lo,hi=bounds(objects);height=max(hi.z-lo.z,1);size=max(hi-lo)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.render.resolution_x=640;scene.render.resolution_y=640;scene.render.resolution_percentage=100
    scene.world.color=(0.16,0.16,0.16)
    for name,loc,energy,size_l in [('Key',(3,-4,5),550,4),('Fill',(-3,-2,3),350,5),('Rim',(1,4,4),700,3)]:
        light=bpy.data.lights.new(name,'AREA');light.energy=energy;light.shape='DISK';light.size=size_l
        obj=bpy.data.objects.new(name,light);scene.collection.objects.link(obj);obj.location=Vector(loc)*max(height/2,1);point_at(obj,(0,0,height/2))
    bpy.ops.mesh.primitive_plane_add(size=max(200,size*8),location=(0,0,-0.015));floor=bpy.context.object;floor.name='PreviewFloor'
    mat=bpy.data.materials.new('Preview neutral');mat.diffuse_color=(0.12,0.15,0.18,1);floor.data.materials.append(mat)
    cam_data=bpy.data.cameras.new('ReviewCamera');cam=bpy.data.objects.new('ReviewCamera',cam_data);scene.collection.objects.link(cam);scene.camera=cam;cam_data.type='ORTHO';cam_data.ortho_scale=size*1.4
    views={'front':(0,-1,0),'side':(1,0,0),'back':(0,1,0),'three-quarter':(1,-1,0.35),'game-camera':(1,-1,1.15)}
    if turntable: views={f'frame-{i:03}':(math.sin(i*math.tau/24),-math.cos(i*math.tau/24),0.2) for i in range(24)}
    Path(out).mkdir(parents=True,exist_ok=True)
    for name,v in views.items():
        cam_data.type='ORTHO';cam_data.ortho_scale=size*1.4
        cam.location=Vector(v)*size*3+Vector((0,0,height/2));point_at(cam,(0,0,height/2))
        if name=='game-camera':
            profile=json.loads(Path('ontology/game-camera.json').read_text())
            distance=profile['distanceM'];pitch=profile['pitchRadians'];yaw=profile['referenceYawRadians'];pivot=profile['targetHeightM']
            cam_data.type='PERSP';cam_data.sensor_fit='VERTICAL';cam_data.angle=math.radians(profile['verticalFovDegrees'])
            cam.location=(-math.sin(yaw)*distance*math.cos(pitch),-math.cos(yaw)*distance*math.cos(pitch),pivot+distance*math.sin(pitch))
            point_at(cam,(0,0,pivot+profile['lookTargetOffsetM']))
        scene.render.filepath=str(Path(out,name+'.png').resolve());bpy.ops.render.render(write_still=True)

def probe():
    import addon_utils
    candidates=[]
    for root in bpy.utils.script_paths():
        candidates.extend(Path(root).glob('addons*/mpfb'))
    ext=Path(os.environ.get('APPDATA',''))/'Blender Foundation'/'Blender'/f'{bpy.app.version[0]}.{bpy.app.version[1]}'/'extensions'/'blender_org'/'mpfb'
    result={'blender':bpy.app.version_string,'python':sys.version,'mpfbInstalled':ext.exists()}
    if ext.exists():
        # Enable within this ephemeral background process; do not alter user preferences.
        module=addon_utils.enable('bl_ext.blender_org.mpfb',default_set=True,persistent=False)
        result['mpfbEnabled']=module is not None
        result['mpfbManifest']=(ext/'blender_manifest.toml').read_text()
        if module is not None:
            from bl_ext.blender_org.mpfb.services.humanservice import HumanService
            human=HumanService.create_human()
            result['mpfbHumanVertices']=len(human.data.vertices)
    Path('generated/validation').mkdir(parents=True,exist_ok=True)
    Path('generated/validation/environment-probe.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))

def main():
    p=argparse.ArgumentParser();p.add_argument('operation',choices=['probe','build','validate','render','turntable']);p.add_argument('--input');p.add_argument('--output');p.add_argument('--report',default='generated/validation/report.json');p.add_argument('--height',type=float,default=1.75)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    if args.operation=='probe':probe();return
    if not args.input:raise ValueError('--input required')
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    import_asset(args.input);objects=asset_objects();normalize(objects,args.height)
    report=inspect(objects);report['source']=args.input;report['blender']=bpy.app.version_string
    Path(args.report).parent.mkdir(parents=True,exist_ok=True);Path(args.report).write_text(json.dumps(report,indent=2))
    if not report['technicalPass']: raise ValueError(report['errors'])
    if args.operation=='build':
        if not args.output:raise ValueError('--output required')
        Path(args.output).parent.mkdir(parents=True,exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(Path(args.output).resolve()),export_format='GLB',export_yup=True,export_animations=True)
    if args.operation in ('render','turntable'):preview(objects,args.output or 'generated/previews',args.operation=='turntable')
    print('ONTOLOGY_REPORT '+json.dumps(report))
if __name__=='__main__':main()

