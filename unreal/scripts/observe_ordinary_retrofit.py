"""Bounded read-only comparison on the user's ordinary running PIE/save, not a fixture."""
import unreal, json, time, os, urllib.request
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
worlds=unreal.EditorLevelLibrary.get_pie_worlds(False)
assert len(worlds)==1
world=worlds[0]
bridge=next(b for b in unreal.ObjectIterator(unreal.TVBridgeSubsystem) if b.get_outer()==world)
samples=[]
started=time.monotonic()
last=0
def tick(dt):
    global last
    now=time.monotonic()-started
    if now-last<2: return
    last=now
    with urllib.request.urlopen('http://127.0.0.1:8787/debug/snapshot',timeout=2) as r: canonical=json.load(r)
    samples.append({'seconds':now,'bridge':json.loads(bridge.realtime_diagnostics()),
        'canonicalTick':canonical['tick'], 'canonicalPeople':[{'bodyId':b['bodyId'],'pos':b['pos'],'activity':b['activity'],'pose':b['pose']} for b in canonical['bodies']],
        'projectedPeople':[json.loads(c.presentation_diagnostics()) for c in unreal.GameplayStatics.get_all_actors_of_class(world,unreal.TVCharacter)]})
    if now>=12:
        unreal.unregister_slate_post_tick_callback(handle)
        out=os.path.join(root,'docs/evidence/foundational-gameplay/retrofit/ordinary-npc-before.json')
        with open(out,'w') as f:json.dump({'source':'ordinary preserved playable save','samples':samples},f,indent=2)
        print('ORDINARY_OBSERVATION_COMPLETE',out)
handle=unreal.register_slate_post_tick_callback(tick)
