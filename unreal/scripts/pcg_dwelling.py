"""One deterministic modular dwelling archetype, compiled into ordinary PCG nodes.

Input dimensions are the canonical construction envelope in metres. The archetype
fits 2m wall/floor bays; it rejects incompatible dimensions rather than inflating them.
The resulting native graph owns all mesh spawning. Vendor assets remain immutable.
"""
import unreal, os, json, math, random, hashlib, itertools, time, traceback

ROOT = '/Game/TornVeil/PCG'
LEVEL = ROOT + '/Tests/Dwelling/L_PCG_Dwelling_6x8'
TAG = 'TV.PCG.Dwelling'
FOOTPRINT = {'buildingId': 'canonical-dwelling-fixture', 'widthMetres': 6, 'depthMetres': 8}
MARGIN_CM = 20
Q = '/Game/ThirdParty/Quaternius/Meshes/'
ASSETS = {'floor_brick': Q+'Floor_Brick', 'floor_wood': Q+'Floor_WoodDark',
    'wall': Q+'Wall_Plaster_Straight', 'door': Q+'Wall_Plaster_Door_Flat',
    'window': Q+'Wall_Plaster_Window_Wide_Flat', 'roof': Q+'Roof_Wooden_2x1',
    'support': Q+'Roof_Support2', 'barrel': '/Game/AdvancedVillagePack/Meshes/SM_Barrel'}
_meshes = {}

def mesh(key):
    if key not in _meshes:
        _meshes[key] = unreal.load_asset(ASSETS[key])
        assert _meshes[key], 'Missing modular asset: '+ASSETS[key]
    return _meshes[key]

def triple(v): return [float(v.x), float(v.y), float(v.z)]

def fit(key, center, size, yaw):
    """Fit measured LOCAL mesh bounds into a world-aligned target box at cardinal yaw.
    Source pivot offsets are rotated after local scale, rather than treated as centers.
    """
    b = mesh(key).get_bounds(); origin = triple(b.origin); extent = triple(b.box_extent)
    local_size = [size[1], size[0], size[2]] if yaw % 180 else list(size)
    scale = [local_size[i] / (2*extent[i]) for i in range(3)]
    a = math.radians(yaw); co, si = round(math.cos(a)), round(math.sin(a))
    ox, oy, oz = [origin[i]*scale[i] for i in range(3)]
    offset = [center[0]-(co*ox-si*oy), center[1]-(si*ox+co*oy), center[2]-oz]
    return {'mesh': ASSETS[key], 'position': offset, 'scale': scale, 'yaw': yaw,
        'targetBounds': [[center[i]-size[i]/2 for i in range(3)], [center[i]+size[i]/2 for i in range(3)]]}

def recipe(seed, footprint=FOOTPRINT):
    w, d = footprint['widthMetres']*100, footprint['depthMetres']*100
    assert w == 600 and d == 800, 'v0.1 archetype currently requires the canonical 6x8m footprint'
    rng = random.Random(seed); parts = []
    def add(role, key, center, size, yaw=0, slot=None):
        p = fit(key, center, size, yaw); p.update(role=role, slot=slot); parts.append(p)
    for x in (-200, 0, 200):
        for y in (-300, -100, 100, 300):
            add('floor', 'floor_wood' if seed % 2 else 'floor_brick', (x,y,3),(200,200,6))
            # A boarded ceiling closes the wedge mesh's bevel gaps above the walls.
            add('ceiling','floor_wood',(x,y,315),(200,200,6))
    slots = []
    for side in range(4):
        for index, along in enumerate((-200,0,200) if side%2==0 else (-300,-100,100,300)):
            center = (along, -390 if side==0 else 390, 162) if side%2==0 else (290 if side==1 else -290, along, 162)
            size = (200,20,312) if side%2==0 else (20,200,312)
            slots.append({'side':side,'index':index,'center':center,'size':size,'yaw':side*90})
    side = seed % 4
    door_candidates = [s for s in slots if s['side']==side and s['index'] in (1,2) and not (side%2==0 and s['index']==2)]
    door = door_candidates[(seed//4) % len(door_candidates)]
    window_candidates = [s for s in slots if s is not door and s['side'] != side]
    rng.shuffle(window_candidates)
    windows = window_candidates[:3 + seed%2]
    for slot in slots:
        role = 'door' if slot is door else 'window' if slot in windows else 'wall'
        add(role,role,slot['center'],slot['size'],slot['yaw'],[slot['side'],slot['index']])
    # Roof_Wooden_2x1 is a pitched wedge: local Y low is the ridge, Y high the eave.
    # Eight measured panels join along the ridge; 20cm X and 10cm Y eaves are explicit.
    for sign in (-1,1):
        for y in (-300,-100,100,300): add('roof','roof',(sign*155,y,413),(330,220,190),90 if sign<0 else 270)
        for y in (-330,330): add('support','support',(sign*278,y,283),(20,60,70),90 if sign<0 else 270)
    # Restrained pantry storage in the interior corners, away from the entrance lane.
    corners = [(x,y) for x in (-225,225) for y in (-325,325)]
    corners.sort(key=lambda p: -(p[0]-door['center'][0])**2-(p[1]-door['center'][1])**2)
    for x,y in corners[:1+seed%2]: add('dressing','barrel',(x,y,48),(60,60,84),90*(seed%4))
    assert len([p for p in parts if p['slot'] is not None]) == 14
    assert len([p for p in parts if p['role']=='door']) == 1
    # Keep the entire threshold-to-room entrance lane free of pantry storage.
    lane = ([door['center'][0]-65,-380],[door['center'][0]+65,380]) if side%2==0 else ([-280,door['center'][1]-65],[280,door['center'][1]+65])
    for p in parts:
        if p['role']=='dressing':
            lo,hi=p['targetBounds']
            assert any(hi[i]<=lane[0][i] or lo[i]>=lane[1][i] for i in (0,1)), 'Dressing blocks entrance lane'
    return {'seed':seed,'canonicalFootprint':footprint,'doorSlot':[door['side'],door['index']],
        'allowedMarginCm':MARGIN_CM,'parts':parts}

def graph_for(spec):
    seed = spec['seed']; folder = ROOT+'/Buildings'; name = 'TV_Dwelling_6x8_S%02d'%seed
    path = folder+'/'+name
    graph = unreal.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else unreal.AssetToolsHelpers.get_asset_tools().create_asset(name,folder,unreal.PCGGraph,unreal.PCGGraphFactory())
    assert graph
    for node in list(graph.nodes): graph.remove_node(node)
    for index,p in enumerate(spec['parts']):
        grid, gs = graph.add_node_of_type(unreal.PCGCreatePointsGridSettings)
        gs.set_editor_property('grid_extents',unreal.Vector(1,1,1)); gs.set_editor_property('cell_size',unreal.Vector(100,100,100))
        gs.set_editor_property('coordinate_space',unreal.PCGCoordinateSpace.LOCAL_COMPONENT)
        gs.set_editor_property('cull_points_outside_volume',False)
        trans, ts = graph.add_node_of_type(unreal.PCGTransformPointsSettings)
        ts.set_editor_property('offset_min',unreal.Vector(*p['position'])); ts.set_editor_property('offset_max',unreal.Vector(*p['position']))
        ts.set_editor_property('rotation_min',unreal.Rotator(0,0,p['yaw'])); ts.set_editor_property('rotation_max',unreal.Rotator(0,0,p['yaw']))
        ts.set_editor_property('absolute_rotation',True); ts.set_editor_property('absolute_scale',True); ts.set_editor_property('uniform_scale',False)
        ts.set_editor_property('scale_min',unreal.Vector(*p['scale'])); ts.set_editor_property('scale_max',unreal.Vector(*p['scale']))
        spawn, ss = graph.add_node_of_type(unreal.PCGStaticMeshSpawnerSettings)
        desc = unreal.PCGSoftISMComponentDescriptor(); desc.set_editor_property('static_mesh',unreal.load_asset(p['mesh']))
        desc.set_editor_property('component_tags',[TAG,'TV.Dwelling.Seed.%d'%seed,'TV.PresentationOnly'])
        desc.set_editor_property('can_ever_affect_navigation',False); desc.set_editor_property('use_default_collision',False)
        body = desc.get_editor_property('body_instance'); body.set_editor_property('collision_enabled',unreal.CollisionEnabled.NO_COLLISION); desc.set_editor_property('body_instance',body)
        entry = unreal.PCGMeshSelectorWeightedEntry(); entry.set_editor_property('descriptor',desc); entry.set_editor_property('weight',1)
        ss.mesh_selector_instance.set_editor_property('mesh_entries',[entry]); ss.set_editor_property('seed',seed*1000+index)
        ss.set_editor_property('description',p['role']+' '+str(p['slot']))
        graph.add_edge(grid,'Out',trans,'In'); graph.add_edge(trans,'Out',spawn,'In'); graph.add_edge(spawn,'Out',graph.output_node,'Out')
    graph.set_editor_property('description','Canonical 6x8m footprint; seed %d; modular PCG geometry; max eave 20cm'%seed)
    assert unreal.EditorAssetLibrary.save_asset(path)
    return graph,path

def evidence_dir():
    p=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../../docs/evidence/dwelling'));os.makedirs(p,exist_ok=True);return p

def write_evidence(name,value):
    with open(os.path.join(evidence_dir(),name),'w') as f:json.dump(value,f,indent=2)

def build():
    levels=unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    assert not levels.is_in_play_in_editor()
    actors=unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    if unreal.EditorAssetLibrary.does_asset_exist(LEVEL):
        assert levels.load_level(LEVEL)
        for a in actors.get_all_level_actors():
            if a.get_class().get_name() not in ('WorldSettings','LevelScriptActor','Brush','DirectionalLight','SkyLight','SkyAtmosphere','ExponentialHeightFog','PostProcessVolume'):
                actors.destroy_actor(a)
    else:
        assert levels.new_level_from_template(LEVEL,'/Game/TornVeil/Maps/TornVeilWorld')
    if not any(isinstance(a,unreal.DirectionalLight) for a in actors.get_all_level_actors()):
        sun=actors.spawn_actor_from_class(unreal.DirectionalLight,unreal.Vector(0,0,1000),unreal.Rotator(-40,0,-35))
        sun.light_component.set_editor_property('intensity',8.0)
        actors.spawn_actor_from_class(unreal.SkyLight,unreal.Vector(0,0,1000))
        actors.spawn_actor_from_class(unreal.SkyAtmosphere,unreal.Vector(0,0,0))
    for a in actors.get_all_level_actors():
        if isinstance(a,unreal.DirectionalLight):
            a.set_actor_rotation(unreal.Rotator(pitch=-40,yaw=-35,roll=0),False)
            a.light_component.set_editor_property('atmosphere_sun_light',True)
    # Neutral presentation stage, excluded from construction measurement and graph output.
    stage=actors.spawn_actor_from_class(unreal.StaticMeshActor,unreal.Vector(0,0,-10))
    stage.set_actor_label('DwellingBenchmark_DisplayStage');stage.tags=['TV.TestStage']
    stage.static_mesh_component.set_static_mesh(unreal.load_asset('/Engine/BasicShapes/Cube'))
    stage.static_mesh_component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    stage.set_actor_scale3d(unreal.Vector(56,12,.2))
    specs=[]
    for seed in range(1,6):
        spec=recipe(seed);graph,path=graph_for(spec);origin=[(seed-3)*1100,0,0]
        volume=actors.spawn_actor_from_class(unreal.PCGVolume,unreal.Vector(*origin))
        volume.set_actor_label('TV_Dwelling_S%02d'%seed);volume.tags=[TAG,'TV.Dwelling.Seed.%d'%seed,'TV.PresentationOnly']
        comp=volume.get_component_by_class(unreal.PCGComponent);comp.set_graph(graph);comp.set_editor_property('seed',seed);comp.generate_local(True)
        spec.update(graph=path,origin=origin);specs.append(spec)
    write_evidence('recipe.json',specs)
    print('PCG_DWELLING_GENERATING',[(s['seed'],len(s['parts'])) for s in specs])
    return specs

def scan(specs):
    actors=unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    result=[]
    for spec in specs:
        rows=[]; all_bounds=[]; seed=spec['seed']; origin=spec['origin']
        for a in actors:
            for c in a.get_components_by_class(unreal.InstancedStaticMeshComponent):
                if 'TV.Dwelling.Seed.%d'%seed not in [str(t) for t in c.component_tags]: continue
                m=c.get_editor_property('static_mesh');b=m.get_bounds()
                for index in range(c.get_instance_count()):
                    t=c.get_instance_transform(index,True); r=t.rotation.rotator()
                    row={'mesh':m.get_path_name().split('.')[0],'position':[round(v-origin[i],4) for i,v in enumerate(triple(t.translation))],
                        'scale':[round(v,6) for v in triple(t.scale3d)],'yaw':round(r.yaw%360,4)}
                    corners=[]
                    for signs in itertools.product((-1,1),repeat=3):
                        corner=unreal.Vector(*[triple(b.origin)[i]+signs[i]*triple(b.box_extent)[i] for i in range(3)])
                        v=unreal.MathLibrary.transform_location(t,corner);corners.append([triple(v)[i]-origin[i] for i in range(3)])
                    bounds=[[min(p[i] for p in corners) for i in range(3)],[max(p[i] for p in corners) for i in range(3)]]
                    row['bounds']=bounds;rows.append(row);all_bounds.append(bounds)
                assert c.get_collision_enabled()==unreal.CollisionEnabled.NO_COLLISION, 'PCG geometry gained local collision authority'
        rows.sort(key=lambda r:json.dumps({k:v for k,v in r.items() if k!='bounds'},sort_keys=True))
        digest=hashlib.sha256(json.dumps([{k:v for k,v in r.items() if k!='bounds'} for r in rows],sort_keys=True).encode()).hexdigest()
        bounds=[[min(b[0][i] for b in all_bounds) for i in range(3)],[max(b[1][i] for b in all_bounds) for i in range(3)]] if all_bounds else None
        result.append({'seed':seed,'instances':len(rows),'signature':digest,'boundsCm':bounds,'instancesDetail':rows})
    return result

def validate(specs,scans):
    for spec,actual in zip(specs,scans):
        assert actual['instances']==len(spec['parts']), 'Missing/duplicated PCG parts for seed %d: %d/%d'%(spec['seed'],actual['instances'],len(spec['parts']))
        remaining=list(actual['instancesDetail'])
        for p in spec['parts']:
            found=next((r for r in remaining if r['mesh']==p['mesh'] and max(abs(r['position'][i]-p['position'][i]) for i in range(3))<.05),None)
            assert found, 'Missing expected role/slot '+p['role']+' '+str(p['slot'])
            assert max(abs(found['bounds'][end][i]-p['targetBounds'][end][i]) for end in range(2) for i in range(3))<.1, 'Incorrect module bounds '+p['role']
            remaining.remove(found)
        lo,hi=actual['boundsCm']
        assert lo[0]>=-320.1 and hi[0]<=320.1 and lo[1]>=-420.1 and hi[1]<=420.1, 'Construction envelope exceeded'
    assert len({r['signature'] for r in scans})==5, 'Seeds did not produce distinct local geometry'

def build_and_save():
    specs=build();deadline=time.monotonic()+45;busy=False
    def tick(delta):
        nonlocal busy
        if busy: return
        busy=True
        try:
            rows=scan(specs)
            if any(r['instances']!=len(s['parts']) for r,s in zip(rows,specs)):
                assert time.monotonic()<deadline, 'Timed out generating dwelling components'
                return
            validate(specs,rows)
            assert unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
            write_evidence('initial-geometry.json',rows)
            unreal.unregister_slate_post_tick_callback(handle)
            print('PCG_DWELLING_SAVED',LEVEL)
        except Exception:
            unreal.unregister_slate_post_tick_callback(handle);print(traceback.format_exc())
        finally: busy=False
    handle=unreal.register_slate_post_tick_callback(tick)
    return specs
