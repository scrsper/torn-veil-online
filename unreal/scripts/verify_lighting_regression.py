"""Read the captured regression pair and negative-test the real PIE lighting validator.

Run after Verify-PlayablePIE.ps1 -CaptureLabel lighting-fixed-predawn.
Only disposable presentation settings are touched, and they are restored in finally.
"""
import json, os, unreal
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
evidence=os.path.join(root,'docs','evidence','foundational-gameplay')
world=unreal.EditorLevelLibrary.get_pie_worlds(False)[0]
assert not unreal.TVPlayableLighting.validate_daylight(world,True)
checks={}
for label,expected in [('saved-time-dark',False),('lighting-fixed-predawn',True)]:
    metrics=json.loads(unreal.TVPlayableLighting.rendered_frame_diagnostics(os.path.join(evidence,label+'.png')))
    assert metrics['passed']==expected, (label,metrics)
    checks[label]=metrics
sun=unreal.GameplayStatics.get_all_actors_of_class(world,unreal.DirectionalLight)[0]
try:
    sun.light_component.set_intensity(100.)
    error=unreal.TVPlayableLighting.validate_daylight(world,True)
    assert error
    checks['runtime100LuxRejected']=error
finally:
    error=unreal.TVPlayableLighting.ensure_daylight(world)
    assert not error,error
try:
    unreal.SystemLibrary.execute_console_command(world,'viewmode unlit')
    error=unreal.TVPlayableLighting.validate_daylight(world,True)
    assert error
    checks['unlitRejected']=error
finally:
    unreal.SystemLibrary.execute_console_command(world,'viewmode lit')
assert not unreal.TVPlayableLighting.validate_daylight(world,True)
with open(os.path.join(evidence,'lighting-regression.json'),'w') as f:
    json.dump({'passed':True,'checks':checks,'restoredViewMode':'Lit'},f,indent=2)
print('LIGHTING_REGRESSION_VERIFIED')
