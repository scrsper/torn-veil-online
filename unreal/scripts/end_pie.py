"""End PIE, if it is running. Separate from prepare_capture_camera.py on purpose.

`editor_request_end_play` is asynchronous and Python runs on the game thread, so a script cannot
end PIE and then act on the stopped editor in the same invocation — the shutdown only happens once
the script returns. Ending and preparing therefore have to be two calls.
"""
import unreal
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
if levels.is_in_play_in_editor():
    levels.editor_request_end_play()
    print('TV_PIE end requested')
else:
    print('TV_PIE already stopped')
