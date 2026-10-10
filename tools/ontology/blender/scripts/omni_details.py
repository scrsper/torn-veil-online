"""Bounded authored-source refinements. No reference pixels or replacement body primitives."""
import bpy, bmesh, math, random
from mathutils import Vector
from mathutils.kdtree import KDTree

def woven_texture(root):
    random.seed(431);n=512
    image=bpy.data.images.new('TV linen weave',width=n,height=n)
    pixels=[]
    for y in range(n):
        for x in range(n):
            grain=random.uniform(-.008,.008)
            weave=(.018 if x%4==0 else 0)+(.018 if y%4==0 else 0)
            value=.84+grain-weave
            pixels.extend((value,value*.91,value*.76,1))
    image.pixels.foreach_set(pixels)
    path=root/'assets/generated/omni-linen.png';image.filepath_raw=str(path);image.file_format='PNG';image.save()
    return image

def skinned_mesh(name,vertices,faces,rig,mat,bone,uv_segments=None):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat);obj.parent=rig
    if uv_segments:
        uv=mesh.uv_layers.new(name='Authored component UV')
        rows=len(vertices)//uv_segments
        for polygon in mesh.polygons:
            for loop in polygon.loop_indices:
                index=mesh.loops[loop].vertex_index
                uv.data[loop].uv=(index%uv_segments/uv_segments,(index//uv_segments)/(rows-1))
    group=obj.vertex_groups.new(name=bone);group.add(list(range(len(vertices))),1,'REPLACE')
    mod=obj.modifiers.new('Shared game rig','ARMATURE');mod.object=rig
    for p in mesh.polygons:p.use_smooth=True
    return obj

def refine(body,clothes,rig,material,root):
    bpy.context.view_layer.update()
    coords=[clothes.matrix_world@v.co for v in clothes.data.vertices]
    bodycoords=[body.matrix_world@v.co for v in body.data.vertices]
    lo=min(v.z for v in bodycoords);h=max(v.z for v in bodycoords)-lo
    # MPFB helper topology extends beyond the visible body. Derive meter scale from head/foot rig.
    h=(rig.matrix_world@rig.data.bones['head'].tail_local).z*1.10
    z=h*.545
    waist=[v for v in coords if abs(v.z-z)<h*.016 and abs(v.x)<h*.16]
    rx=max(abs(v.x) for v in waist)+h*.007
    cy=(max(v.y for v in waist)+min(v.y for v in waist))*.5
    ry=(max(v.y for v in waist)-min(v.y for v in waist))*.5+h*.007
    leather=material('TV worn brown leather',color=(.105,.047,.022,1),roughness=.72)
    metal=material('TV aged buckle',color=(.22,.16,.085,1),roughness=.42)
    metal.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.7
    # Four ring sections give actual leather thickness and an outward rolled edge.
    vertices=[];segments=80
    rings=[(-.012,1),(-.010,1.025),(.010,1.025),(.012,1)]
    for dz,m in rings:
        for i in range(segments):
            a=i*math.tau/segments;vertices.append((rx*m*math.cos(a),cy+ry*m*math.sin(a),z+h*dz))
    faces=[]
    for row in range(3):
        for i in range(segments):
            j=(i+1)%segments;faces.append((row*segments+i,row*segments+j,(row+1)*segments+j,(row+1)*segments+i))
    skinned_mesh('TV fitted leather belt',vertices,faces,rig,leather,'pelvis')
    # Thin rectangular buckle frame in the model's anterior plane (negative Y).
    vs=[];fs=[]
    for width,height in [(.020,.014),(.014,.009)]:
        vs.extend([(sx*h*width,cy-ry*1.05-h*.002,z+sz*h*height) for sx,sz in [(-1,-1),(1,-1),(1,1),(-1,1)]])
    for i in range(4):fs.append((i,(i+1)%4,(i+1)%4+4,i+4))
    skinned_mesh('TV belt buckle',vs,fs,rig,metal,'pelvis')
    # Preserve the authored boot's foot/toe topology; lengthen only the shaft.
    shoes=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'shoes03' in o.name)
    for v in shoes.data.vertices:
        p=shoes.matrix_world@v.co
        if p.z>h*.065:
            p.z=h*.065+(p.z-h*.065)*2.05
            side='l' if p.x>0 else 'r';b=rig.data.bones['calf_'+side]
            t=max(0,min(1,(b.head_local.z-p.z)/(b.head_local.z-b.tail_local.z)))
            center=rig.matrix_world@b.head_local.lerp(b.tail_local,t)
            p.x=center.x+(p.x-center.x)*1.18;p.y=center.y+(p.y-center.y)*1.18
            v.co=shoes.matrix_world.inverted()@p
    shoes.data.materials.clear();shoes.data.materials.append(leather)
    # New calf shafts are fitted to the trouser envelope; the original toe/sole remains.
    for side in ['l','r']:
        sign=1 if side=='l' else -1;b=rig.data.bones['calf_'+side]
        shaft=[];rings=12;segments=48
        for row in range(rings):
            height=h*(.060+.18*row/(rings-1))
            t=max(0,min(1,(b.head_local.z-height)/(b.head_local.z-b.tail_local.z)))
            center=rig.matrix_world@b.head_local.lerp(b.tail_local,t)
            points=[p for p in coords if sign*p.x>0 and abs(p.z-height)<h*.018]
            profile=math.sin(row/(rings-1)*math.pi)
            rx=h*(.020+.007*profile)
            ry=h*(.023+.009*profile)
            cuff=1.055 if row==rings-1 else 1
            for i in range(segments):
                a=i*math.tau/segments;fold=1+(.040 if row<4 else .008)*math.sin(a*3+row*2.0)
                shaft.append((center.x+rx*math.cos(a)*fold*cuff,center.y+ry*math.sin(a)*fold*cuff,height))
        faces=[(row*segments+i,row*segments+(i+1)%segments,(row+1)*segments+(i+1)%segments,(row+1)*segments+i) for row in range(rings-1) for i in range(segments)]
        skinned_mesh('TV fitted calf boot '+side,shaft,faces,rig,leather,'calf_'+side,segments)
    # Tuck trousers into the taller boots while retaining their existing weights.
    for v in clothes.data.vertices:
        p=clothes.matrix_world@v.co
        if p.z<h*.26:
            side='l' if p.x>0 else 'r';b=rig.data.bones['calf_'+side]
            center=rig.matrix_world@b.head_local.lerp(b.tail_local,max(0,min(1,(b.head_local.z-p.z)/(b.head_local.z-b.tail_local.z))))
            p.x=center.x+(p.x-center.x)*.50;p.y=center.y+(p.y-center.y)*.50
            v.co=clothes.matrix_world.inverted()@p
    # A true wardrobe mask removes invisible trousers below the leather shaft.
    # Keep the narrow tucked section above the mask; do not rely on overlapping meshes.
    bm=bmesh.new();bm.from_mesh(clothes.data)
    localPlane=clothes.matrix_world.inverted()@Vector((0,0,h*.239))
    normal=clothes.matrix_world.to_3x3().inverted()@Vector((0,0,1))
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=1e-6,plane_co=localPlane,plane_no=normal,clear_inner=True,clear_outer=False)
    bm.to_mesh(clothes.data);bm.free();clothes.data.update()
    # Lower the pointed source collar and spread its opening; existing folds remain.
    for v in clothes.data.vertices:
        p=clothes.matrix_world@v.co
        if h*.81<p.z<h*.90 and abs(p.x)<h*.075 and p.y<0:
            weight=max(0,1-abs(p.x)/(h*.075))
            p.z-=h*.025*weight;p.x*=1.12
            v.co=clothes.matrix_world.inverted()@p
    linen=clothes.data.materials[0]
    tex=linen.node_tree.nodes.new('ShaderNodeTexImage');tex.image=woven_texture(root)
    linen.node_tree.links.new(tex.outputs['Color'],linen.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    # Restore licensed source fold normals that the neutral study had discarded.
    normal=linen.node_tree.nodes.new('ShaderNodeTexImage')
    normal.image=bpy.data.images.load(str(root/'assets/imported/makehuman/system/clothes/male_casualsuit01/male_casualsuit01_normal.png'),check_existing=True)
    normal.image.colorspace_settings.name='Non-Color'
    node=linen.node_tree.nodes.new('ShaderNodeNormalMap');node.inputs['Strength'].default_value=.45
    linen.node_tree.links.new(normal.outputs['Color'],node.inputs['Color'])
    linen.node_tree.links.new(node.outputs['Normal'],linen.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
    linen.name='TV woven linen shirt'
    clothes.data.materials[1].name='TV charcoal woven trousers'
    # Rolled cuff bands follow the authored forearm silhouette and rig, not body primitives.
    for side in ['l','r']:
        bone=rig.data.bones['lowerarm_'+side]
        head=rig.matrix_world@bone.head_local;tail=rig.matrix_world@bone.tail_local
        axis=(tail-head).normalized();center=tail-axis*h*.025
        u=axis.cross(Vector((0,0,1))).normalized();w=axis.cross(u).normalized()
        sleeve=[p for p in coords if abs((p-center).dot(axis))<h*.02 and (p-center).length<h*.08]
        radius=max([((p-center)-axis*(p-center).dot(axis)).length for p in sleeve]+[h*.024])+h*.002
        vertices=[];segments=40
        for dz,scale in [(-.008,1),(-.006,1.09),(.006,1.09),(.008,1)]:
            for i in range(segments):
                a=i*math.tau/segments;vertices.append(center+axis*h*dz+(u*math.cos(a)+w*math.sin(a))*radius*scale)
        faces=[(row*segments+i,row*segments+(i+1)%segments,(row+1)*segments+(i+1)%segments,(row+1)*segments+i) for row in range(3) for i in range(segments)]
        skinned_mesh('TV linen rolled cuff '+side,vertices,faces,rig,linen,'lowerarm_'+side,segments)
    # Reduce the harsh source lash silhouette for the male face.
    lashes=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'eyelashes' in o.name)
    lashes.hide_render=True;lashes.hide_viewport=True
    bpy.data.objects.remove(lashes,do_unlink=True)

def transfer_garment_weights(clothes,rig):
    """Transfer actual fitted garment weights to attached wardrobe components.
    A rigid pelvis/forearm binding had disagreed with the source garment's blends.
    """
    tree=KDTree(len(clothes.data.vertices))
    for v in clothes.data.vertices:tree.insert(clothes.matrix_world@v.co,v.index)
    tree.balance();names={g.index:g.name for g in clothes.vertex_groups}
    report=[]
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH' or not any(tag in obj.name for tag in ['fitted leather belt','belt buckle','linen rolled cuff']):continue
        obj.vertex_groups.clear()
        groups={name:obj.vertex_groups.new(name=name) for name in names.values() if name in rig.data.bones}
        count=0
        for v in obj.data.vertices:
            near=tree.find_n(obj.matrix_world@v.co,4);weights={};total=sum(1/max(d,.0002)**2 for _,_,d in near)
            for _,index,d in near:
                blend=(1/max(d,.0002)**2)/total
                for g in clothes.data.vertices[index].groups:
                    name=names.get(g.group)
                    if name in groups:weights[name]=weights.get(name,0)+g.weight*blend
            top=sorted(weights.items(),key=lambda pair:pair[1],reverse=True)[:4];scale=sum(w for _,w in top)
            if not scale:raise RuntimeError('Missing source garment weights for '+obj.name)
            for name,w in top:groups[name].add([v.index],w/scale,'REPLACE')
            count+=1
        report.append({'component':obj.name,'weightedVertices':count,'source':clothes.name})
    return report

def face_variation(body):
    """Small jaw-width delta on the existing face topology, exported as a real morph."""
    body.shape_key_add(name='Basis')
    key=body.shape_key_add(name='TV_JawWidth')
    zs=[v.co.z for v in body.data.vertices];top=max(zs);low=min(zs);h=top-low
    for v,k in zip(body.data.vertices,key.data):
        t=(v.co.z-low)/h
        if .84<t<.925:
            weight=math.sin((t-.84)/.085*math.pi)
            k.co.x+=v.co.x*.10*weight
    key.value=0
