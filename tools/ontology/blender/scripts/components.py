"""Small reusable authoring operations. Deliberately no organic mesh generation."""
import bpy

def apply_static_transforms(obj):
    if obj.type=='ARMATURE' or any(m.type=='ARMATURE' for m in obj.modifiers):
        raise ValueError('Never bake skinned transforms without rebinding and animation validation')
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)

def assign_pbr(objects,name,base_color,roughness,metallic=0.0):
    """Explicit style input required; existing source materials remain the default."""
    if not 0<=roughness<=1 or not 0<=metallic<=1:raise ValueError('Invalid PBR range')
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    shader=mat.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=base_color
    shader.inputs['Roughness'].default_value=roughness;shader.inputs['Metallic'].default_value=metallic
    for obj in objects:
        if obj.type=='MESH':obj.data.materials.clear();obj.data.materials.append(mat)
    return mat

def attach_static_to_bone(part,armature,bone,offset):
    """Rigid equipment only. Clothing needs matched skin weights and bind pose."""
    if armature.type!='ARMATURE' or bone not in armature.data.bones:raise ValueError('Missing socket bone')
    if any(m.type=='ARMATURE' for m in part.modifiers):raise ValueError('Skinned component requires explicit retargeting')
    part.parent=armature;part.parent_type='BONE';part.parent_bone=bone;part.location=offset

def retarget_clothing(*args,**kwargs):
    raise NotImplementedError('Supply reviewed bone mapping, bind-pose correction, body masks and deformation fixtures first')

def validate_rig(armature):
    if armature.type!='ARMATURE':raise ValueError('Expected armature')
    bones=armature.data.bones
    return {'boneCount':len(bones),'roots':[b.name for b in bones if not b.parent],'zeroLengthBones':[b.name for b in bones if b.length<1e-6],'retargetCompatibility':'UNVERIFIED'}
