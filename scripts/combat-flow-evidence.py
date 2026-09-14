"""Summarize narrowly captured combat pose handoffs; encode at recorded wall time.

Usage: python scripts/combat-flow-evidence.py BEFORE_DIR AFTER_DIR OUTPUT_DIR
Raw captures remain local. This emits curated measurements and continuous videos.
"""
import json, math, pathlib, subprocess, sys
before, after, out = map(pathlib.Path, sys.argv[1:4]);out.mkdir(parents=True,exist_ok=True)
bones=['pelvis','root','head','spine_01','spine_03','upperarm_l','upperarm_r','lowerarm_l','lowerarm_r','thigh_l','thigh_r','calf_l','calf_r','foot_l','foot_r']
def angle(a,b):
    dot=sum(x*y for x,y in zip(a[3:7],b[3:7]))
    return math.degrees(2*math.acos(min(1,abs(dot))))
def distance(a,b):return math.dist(a[:3],b[:3])
def jump(a,b):return math.sqrt(sum(angle(a['bones'][n],b['bones'][n])**2 for n in bones)/len(bones))
def frames(path):return [f for f in json.loads((path/'probe.json').read_text())['samples'] if f['event']=='frame']
def summary(path):
    f=frames(path);runs=[]
    for i,x in enumerate(f):
        p=x['player'];key=(x['stage'],p['liveCommandId'])
        if not key[1] or i and key==(f[i-1]['stage'],f[i-1]['player']['liveCommandId']):continue
        end=next((k for k in range(i+1,len(f)) if (f[k]['stage'],f[k]['player']['liveCommandId'])!=key),len(f))
        run=f[i:end];runs.append({'stage':x['stage'],'move':p['primitive'],'start':round(x['at'],4),'frames':run,'index':i})
    transitions=[]
    for old,new in zip(runs,runs[1:]):
        if old['stage']!=new['stage'] or new['start']-old['frames'][-1]['at']>.12:continue
        i=new['index'];window=[x for x in f[max(0,i-1):] if new['start']-.07<=x['at']<=new['start']+.20 and x['stage']==new['stage']]
        pairs=list(zip(window,window[1:]));sample=new['frames'][min(3,len(new['frames'])-1)]['player']
        # These are sampled source bookends, not a claim that bone poses can be classified as idle from timing alone.
        bookend=0
        for x in new['frames']:
            p=x['player'];asset=p['poseAsset'];limit=.14 if 'JabRefined' in asset else .12 if '/Repair/Animations/A_TV_Cross' in asset else .10 if '/Refinement/Animations/A_TV_RoundKick' in asset else 0
            bookend+=int(p['poseTime']<limit and p['poseWeight']>.8)
        row={'stage':new['stage'],'transition':old['move']+' → '+new['move'],'at':new['start'],
             'firstObservedAngularDegrees':round(jump(f[max(0,i-1)],f[min(i+1,len(f)-1)]),3),
             'maxFrameAngularDegreesFirst200ms':round(max((jump(a,b) for a,b in pairs),default=0),3),
             'maxSupportFootFrameCmFirst200ms':round(max((distance(a['bones']['foot_l'],b['bones']['foot_l']) for a,b in pairs),default=0),3),
             'maxPelvisFrameCmFirst200ms':round(max((distance(a['bones']['pelvis'],b['bones']['pelvis']) for a,b in pairs),default=0),3),
             'maxPelvisFrameAngularDegreesFirst200ms':round(max((angle(a['bones']['pelvis'],b['bones']['pelvis']) for a,b in pairs),default=0),3),
             'maxRootFrameAngularDegreesFirst200ms':round(max((angle(a['bones']['root'],b['bones']['root']) for a,b in pairs),default=0),3),
             'rootTranslationJumpCm':round(max((distance(a['bones']['root'],b['bones']['root']) for a,b in pairs),default=0),4),
             'maxFrameIntervalMs':round(max((b['at']-a['at'] for a,b in pairs),default=0)*1000,2),
             'locomotionFramesBetweenActions':sum(x['player']['usingLocomotion'] for x in f[old['index']+len(old['frames']):i]),
             'weightedNeutralLeadInSamples':bookend}
        for k in ['flowDuration','rawHandoffAngularDegrees','effectiveHandoffAngularDegrees','handoffPelvisJumpCm','handoffRootJumpCm','handoffSupportFootJumpCm']:
            if k in sample:row[k]=round(sample[k],4)
        transitions.append(row)
    cam=[x['player'] for x in f if x['stage']==6]
    def yawdiff(a,b):return abs((a-b+180)%360-180)
    return {'frames':len(f),'screenshots':sum('screenshot' in x for x in f),'sequences':[{'stage':r['stage'],'move':r['move'],'at':r['start']} for r in runs],
            'transitions':transitions,'maxCanonicalRootPresentationDriftCm':max(x['player']['maxChoreographyActorDriftCm']for x in f),
            'camera':{'maxCameraBodyYawDifferenceDegrees':max((yawdiff(p['cameraYaw'],p['facingDegrees'])for p in cam),default=0),'maxDesiredBodyYawDifferenceDegrees':max((yawdiff(p.get('desiredYaw',p['cameraYaw']),p['facingDegrees'])for p in cam),default=0)}}
result={'method':'Component-space skeleton samples on viewport ticks; comparable first-200-ms windows include real motion and frame stalls. FirstObserved spans one render evaluation boundary. Native handoff metrics compare exact local evaluated poses before/after residual and IK; available only AFTER. Source-bookend counts use inspected lead-in ranges and poseWeight > .8. No inference about contacts or human approval.',
        'before':summary(before),'after':summary(after)}
(out/'transition-diagnostics.json').write_text(json.dumps(result,indent=2)+'\n')
if '--measure-only' in sys.argv:
    print('Saved transition-diagnostics.json');sys.exit(0)
def encode(path,name):
    shots=[x for x in frames(path) if 'screenshot'in x];lines=[]
    for a,b in zip(shots,shots[1:]):
        lines+=['file '+"'"+(path/a['screenshot']).resolve().as_posix()+"'",'duration '+str(b['at']-a['at'])]
    lines+=['file '+"'"+(path/shots[-1]['screenshot']).resolve().as_posix()+"'"]
    manifest=path/'flow-video.ffconcat';manifest.write_text('\n'.join(lines)+'\n')
    subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(manifest),'-vf','fps=30','-c:v','libx264','-preset','fast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(out/name)],check=True)
encode(before,'before-continuous.mp4');encode(after,'after-continuous.mp4')
for stage,name in [(0,'jab-cross'),(2,'front-round')]:
    start=stage*4
    # Both sides retain normal wall speed. Their legal gate timings intentionally differ.
    b=next(t for t in result['before']['transitions']if t['stage']==stage)
    a=next(t for t in result['after']['transitions']if t['stage']==stage)
    labels=[f"BEFORE | {b['weightedNeutralLeadInSamples']} bookend samples | max frame {b['maxFrameAngularDegreesFirst200ms']} deg",
            f"AFTER | {a['weightedNeutralLeadInSamples']} bookend samples | max frame {a['maxFrameAngularDegreesFirst200ms']} deg"]
    filters=[]
    for i,label in enumerate(labels):
        filters.append(f"[{i}:v]trim=start={start}:duration=4,setpts=PTS-STARTPTS,scale=768:432,pad=768:480:0:48:color=0x182330,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='{label}':fontcolor=white:fontsize=16:x=12:y=16[v{i}]")
    filters.append('[v0][v1]hstack=inputs=2[v]')
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(out/'before-continuous.mp4'),'-i',str(out/'after-continuous.mp4'),'-filter_complex',';'.join(filters),'-map','[v]','-c:v','libx264','-crf','20','-pix_fmt','yuv420p',str(out/(name+'-comparison.mp4'))],check=True)
print(json.dumps({'before':result['before']['transitions'],'after':result['after']['transitions'],'camera':result['after']['camera']},indent=2))
