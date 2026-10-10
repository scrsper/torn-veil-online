"""Reference-guided Human prototype from authored MPFB assets; no primitive body geometry.
Run through scripts/humanoid.mjs. Source files and reference originals are read-only.
"""
import bpy, addon_utils, sys, json, math
from pathlib import Path
from mathutils import Vector

ROOT=Path.cwd(); SOURCE=ROOT/'assets/imported/makehuman/system'
OUT=ROOT/'generated/validation/omni-v2'; OUT.mkdir(parents=True,exist_ok=True)
addon_utils.enable('bl_ext.blender_org.mpfb',default_set=True,persistent=False)
from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService

def material(name,texture=None,color=(1,1,1,1),roughness=.65,alpha=False,normal=None):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=color
    bs.inputs['Roughness'].default_value=roughness;bs.inputs['Metallic'].default_value=0
    if texture:
        tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(texture),check_existing=True)
        mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
        if alpha:
            cut=mat.node_tree.nodes.new('ShaderNodeMath');cut.operation='GREATER_THAN';cut.inputs[1].default_value=.35
            mat.node_tree.links.new(tex.outputs['Alpha'],cut.inputs[0]);mat.node_tree.links.new(cut.outputs[0],bs.inputs['Alpha'])
            mat.surface_render_method='DITHERED';mat.use_backface_culling=False
    if normal:
        tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(normal),check_existing=True);tex.image.colorspace_settings.name='Non-Color'
        node=mat.node_tree.nodes.new('ShaderNodeNormalMap');mat.node_tree.links.new(tex.outputs['Color'],node.inputs['Color']);mat.node_tree.links.new(node.outputs['Normal'],bs.inputs['Normal'])
    return mat

def mhmaterial(obj,path,roughness=.65):
    values={}
    for line in path.read_text().splitlines():
        parts=line.strip().split(maxsplit=1)
        if len(parts)==2 and not parts[0].startswith('#'):values[parts[0]]=parts[1]
    texture=path.parent/values['diffuseTexture'] if 'diffuseTexture' in values else None
    normal=path.parent/values['normalmapTexture'] if 'normalmapTexture' in values else None
    mat=material(obj.name,texture,roughness=roughness,alpha=values.get('transparent')=='True',normal=normal if normal and normal.exists() else None)
    obj.data.materials.clear();obj.data.materials.append(mat)
    return mat

def add(body,category,name):
    p=SOURCE/category/name/(name+'.mhclo')
    obj=HumanService.add_mhclo_asset(str(p),body,asset_type={'hair':'Hair','eyes':'Eyes','eyebrows':'Eyebrows','eyelashes':'Eyelashes'}.get(category,'Clothes'),subdiv_levels=0,material_type='GAMEENGINE')
    matline=next(line.split(maxsplit=1)[1] for line in p.read_text().splitlines() if line.startswith('material '))
    matfile=(p.parent/matline).resolve();mhmaterial(obj,matfile,.72 if category=='hair' else .65)
    return obj

def build(sex):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    macro=TargetService.get_default_macro_info_dict();macro.update(gender=1.0 if sex=='male' else 0.0,age=.56 if sex=='male' else .42,muscle=.76,weight=.48,proportions=.6)
    body=HumanService.create_human(macro_detail_dict=macro);body.name='TV_Human_'+sex
    if sex=='male':
        for target,amount in [('chin-width-incr',.38),('chin-prominent-incr',.25),('head-age-incr',.30)]:
            TargetService.load_target(body,TargetService.target_full_path(target),weight=amount)
    rig=HumanService.add_builtin_rig(body,'game_engine',import_weights=True)
    skin='middleage_caucasian_male' if sex=='male' else 'young_caucasian_female2';mhmaterial(body,SOURCE/'skins'/skin/(skin+'.mhmat'),.58)
    add(body,'eyes','high-poly');add(body,'eyebrows','eyebrow001');add(body,'eyelashes','eyelashes01')
    add(body,'hair','short02' if sex=='male' else 'braid01')
    clothes=add(body,'clothes','male_casualsuit01')
    add(body,'clothes','shoes03')
    # Separate authored shirt/trouser islands by their existing material-space geometry.
    # Keep source topology, skinning and normal map. Neutral material study is explicit.
    shirt=material('Plain linen study',color=(.64,.56,.41,1),roughness=.88)
    pants=material('Dark cloth study',color=(.035,.025,.018,1),roughness=.9)
    source_mat=clothes.data.materials[0]
    normal_node=next((n for n in source_mat.node_tree.nodes if n.type=='NORMAL_MAP'),None)
    if normal_node:
        normal_img=next((l.from_node.image for l in source_mat.node_tree.links if l.to_node==normal_node and l.from_node.type=='TEX_IMAGE'),None)
        for mat in [shirt,pants]:
            if normal_img:
                tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=normal_img
                norm=mat.node_tree.nodes.new('ShaderNodeNormalMap');mat.node_tree.links.new(tex.outputs['Color'],norm.inputs['Color']);mat.node_tree.links.new(norm.outputs['Normal'],mat.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
    clothes.data.materials.clear();clothes.data.materials.append(shirt);clothes.data.materials.append(pants)
    # The source suit is one connected mesh. Its authored atlas has shirt islands
    # in the left/right columns and trousers in the center. Classify UV islands,
    # not world height, so sleeves and the actual waist seam remain consistent.
    uv=clothes.data.uv_layers.active.data
    for polygon in clothes.data.polygons:
        center=sum((uv[i].uv for i in polygon.loop_indices),Vector((0,0)))/len(polygon.loop_indices)
        polygon.material_index=0 if (center.x<.35 and center.y<.69) or (center.x>.72 and center.y<.81) else 1
    for obj in bpy.context.scene.objects:
        if obj.type=='MESH':
            for poly in obj.data.polygons:poly.use_smooth=True
    # Export evaluated authored meshes, removing helper/masking geometry while preserving armatures.
    for obj in list(bpy.context.scene.objects):
        if obj.type!='MESH':continue
        arm=[m for m in obj.modifiers if m.type=='ARMATURE']
        for m in arm:m.show_viewport=False
        bpy.context.view_layer.update()
        mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()),preserve_all_data_layers=True,depsgraph=bpy.context.evaluated_depsgraph_get())
        obj.modifiers.clear();obj.data=mesh
        if arm:
            modifier=obj.modifiers.new('Shared game rig','ARMATURE');modifier.object=rig
    if sex=='male':
        from omni_details import refine,face_variation,transfer_garment_weights
        refine(body,clothes,rig,material,ROOT)
        binding_report=transfer_garment_weights(clothes,rig)
        face_variation(body)
    from pipeline import normalize,asset_objects,inspect
    height=1.80 if sex=='male' else 1.73
    normalize(asset_objects(),height)
    bpy.context.view_layer.update()
    report=inspect(asset_objects());report.update(bindingReport=binding_report if sex=='male' else [],sex=sex,referenceIds=['omni'] if sex=='male' else ['kestrel','kestrel-character-sheet'],artReview='Pending; ordinary clothing material/fit study, not reference-match completion')
    output=ROOT/f'public/assets/entities/tv-human-{sex}-v2.glb';output.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',export_yup=True,export_animations=False,export_morph=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'assets/generated/tv-human-{sex}-v2.blend'))
    (OUT/f'{sex}-report.json').write_text(json.dumps(report,indent=2))
    print('HUMAN_FAMILY_REPORT '+json.dumps(report))

if __name__=='__main__':
    sys.path.insert(0,str(ROOT/'blender/scripts'))
    (ROOT/'assets/generated').mkdir(parents=True,exist_ok=True)
    args=sys.argv[sys.argv.index('--')+1:]
    for sex in args or ['male','female']:build(sex)
