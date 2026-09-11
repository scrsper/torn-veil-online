"""Start PIE from the already open editor through the Level Editor subsystem."""
import unreal
subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
subsystem.editor_request_begin_play()
print('HUMANOID_PIE_REQUESTED')
