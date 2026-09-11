"""Capture each generated seed from its entrance side, then a furnished interior."""
import unreal, os, time
_dc_ed=unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
_dc_dir=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../../docs/evidence/dwelling'))
# Cameras face the side containing the recipe's single entrance.
_dc_views=[]
for _seed in range(1,6):
    _x=(_seed-3)*1100
    _dx,_dy={0:(-850,-1100),1:(1000,-850),2:(850,1100),3:(-1000,850)}[_seed%4]
    _dc_views.append(('seed%d-exterior'%_seed,(_x+_dx,_dy,780),(_x,0,220)))
_dc_views.append(('seed3-interior',(-170,180,170),(180,-180,140)))
_dc_index=0;_dc_phase=0;_dc_next=0;_dc_busy=False;_dc_tasks=[]
def _dc_tick(delta):
    global _dc_index,_dc_phase,_dc_next,_dc_busy
    if _dc_busy or time.monotonic()<_dc_next:return
    _dc_busy=True
    try:
        if _dc_index==len(_dc_views):
            unreal.unregister_slate_post_tick_callback(_dc_handle)
            print('PCG_DWELLING_CAPTURES_DONE');return
        name,loc,target=_dc_views[_dc_index]
        if _dc_phase==0:
            v=unreal.Vector(*loc)
            _dc_ed.set_level_viewport_camera_info(v,unreal.MathLibrary.find_look_at_rotation(v,unreal.Vector(*target)))
            _dc_phase=1;_dc_next=time.monotonic()+2
        else:
            _dc_tasks.append(unreal.AutomationLibrary.take_high_res_screenshot(1440,1080,os.path.join(_dc_dir,name+'.png')))
            _dc_index+=1;_dc_phase=0;_dc_next=time.monotonic()+3
    finally:_dc_busy=False
_dc_handle=unreal.register_slate_post_tick_callback(_dc_tick)
print('PCG_DWELLING_CAPTURES_RUNNING')
