"""Bounded renderer/transform recording of ordinary PIE. Does not supply gameplay input.
Frames are intentionally low-rate; encode with wall-clock intervals, never claim 60fps.
"""
import unreal, os, json, time
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
label=globals().get('TV_CAPTURE_LABEL','ordinary-motion')
worlds=unreal.EditorLevelLibrary.get_pie_worlds(False)
assert len(worlds)==1 and worlds[0].get_name().endswith('TornVeilWorld')
w=worlds[0];p=unreal.GameplayStatics.get_player_character(w,0)
bridge=next(b for b in unreal.ObjectIterator(unreal.TVBridgeSubsystem) if b.get_outer()==w)
folder=os.path.join(root,'.debug',label+'-frames');os.makedirs(folder,exist_ok=True)
started=time.monotonic();frames=[];samples=[];last_frame=-1;last_sample=-1;deltas=[]
def record(dt):
    global last_frame,last_sample
    age=time.monotonic()-started
    if age>=24 or not unreal.EditorLevelLibrary.get_pie_worlds(False):
        unreal.unregister_slate_post_tick_callback(handle)
        out=os.path.join(root,'docs/evidence/foundational-gameplay/retrofit',label+'.json')
        with open(out,'w') as f:json.dump({'checkout':root,'mode':'ordinary Lit PIE; recorder supplies no input; walkthrough may use bounded native key holds and OS input',
            'captureLimit':'4Hz screenshot requests; renderer readback overhead; timestamps preserve real speed',
            'seconds':age,'frameDt':deltas,'frames':frames,'samples':samples},f,indent=2)
        print('ORDINARY_MOTION_RECORDED',out);return
    deltas.append(float(dt))
    if age-last_sample>=.1:
        last_sample=age;v=p.get_actor_location();r=p.get_actor_rotation()
        samples.append({'seconds':age,'positionCm':[v.x,v.y,v.z],'yaw':r.yaw,
            'control':json.loads(bridge.realtime_diagnostics())['control']})
    if age-last_frame>=.25:
        last_frame=age;path=os.path.join(folder,'frame-%04d.png'%len(frames))
        frames.append({'seconds':age,'path':path})
        unreal.SystemLibrary.execute_console_command(w,'Shot showui filename="'+path.replace('\\','/')+'"')
handle=unreal.register_slate_post_tick_callback(record)
