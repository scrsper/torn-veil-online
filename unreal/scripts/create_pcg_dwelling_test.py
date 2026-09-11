"""Compile and save five native PCG dwelling graphs and their isolated test level."""
import os, sys, unreal, importlib
folder=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../../unreal/scripts'))
if folder not in sys.path: sys.path.insert(0,folder)
import pcg_dwelling
importlib.reload(pcg_dwelling)
PCG_DWELLING_SPECS=pcg_dwelling.build_and_save()
