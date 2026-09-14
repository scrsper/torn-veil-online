"""Exercise the ordinary bound Interact input for an evidence capture. No canonical state is
mutated here: the character sends the same semantic command as E/A and TypeScript revalidates it."""
import unreal

worlds=unreal.EditorLevelLibrary.get_pie_worlds(False)
if not worlds: raise RuntimeError('PIE must be running')
player=unreal.GameplayStatics.get_player_character(worlds[0],0)
if not player: raise RuntimeError('No controlled player manifestation')
player.interact()
print('FOUNDATIONAL_CAPTURE_INTERACT_SENT')
