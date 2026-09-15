"""Read-only evidence from ordinary PIE; no camera, body, inventory or world mutations.
Invoke through Invoke-EditorPython.ps1 -CaptureLabel <step>. Screenshots include CommonUI.
"""
import unreal, json, os, time, hashlib
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
label=globals().get('TV_CAPTURE_LABEL','ordinary-repair')
worlds=unreal.EditorLevelLibrary.get_pie_worlds(False)
assert len(worlds)==1 and worlds[0].get_name().endswith('TornVeilWorld'), 'Ordinary TornVeilWorld PIE required'
w=worlds[0]
bridge=next(b for b in unreal.ObjectIterator(unreal.TVBridgeSubsystem) if b.get_outer()==w)
# No subprocesses/network on Unreal's game thread. Bridge state is sampled separately
# by the calling verifier; this records native render/input state without those stalls.
gitfile=open(os.path.join(root,'.git')).read().strip()
gitdir=os.path.abspath(os.path.join(root,gitfile.split(':',1)[1].strip()))
head=open(os.path.join(gitdir,'HEAD')).read().strip()
if head.startswith('ref: '):
    common=os.path.normpath(os.path.join(gitdir,open(os.path.join(gitdir,'commondir')).read().strip()))
    head=open(os.path.join(common,head[5:])).read().strip()
actors=unreal.GameplayStatics.get_all_actors_of_class(w,unreal.TVCharacter)
wildlife=unreal.GameplayStatics.get_all_actors_of_class(w,unreal.TVWildlifePresentation)
report={'label':label,'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'checkout':root,
    'head':head,'verification':'working-tree build; use DLL hash, not HEAD alone',
    'buildDllSha256':hashlib.file_digest(open(os.path.join(unreal.Paths.project_dir(),'Binaries/Win64/UnrealEditor-TornVeilOnline.dll'),'rb'),'sha256').hexdigest(),
    'world':w.get_path_name(),'lightingValidation':unreal.TVPlayableLighting.validate_daylight(w,True),
    'native':json.loads(bridge.realtime_diagnostics()),
    'characters':[json.loads(a.presentation_diagnostics()) for a in actors],
    'wildlife':[json.loads(a.presentation_diagnostics()) for a in wildlife]}
out=os.path.join(root,'docs/evidence/foundational-gameplay/retrofit',label)
with open(out+'.json','w') as f:json.dump(report,f,indent=2)
unreal.SystemLibrary.execute_console_command(w,'Shot showui filename="'+out.replace('\\','/')+'.png"')
print('REPAIR_OBSERVATION',out)
