"""Safely extract the four official archives. Existing Python, no extra packages."""
from pathlib import Path
import zipfile
for path in Path('assets/source').glob('*.zip'):
    if path.stem not in ['universal-base-characters','modular-character-outfits-fantasy','universal-animation-library','bestiary-dungeon-monsters-kit']:
        continue
    root=Path('assets/imported/quaternius',path.stem).resolve()
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            if not (root/item.filename).resolve().is_relative_to(root):
                raise ValueError(f'Unsafe archive path: {item.filename}')
            if item.external_attr >> 16 & 0o170000 == 0o120000:
                raise ValueError('Archive symlinks are not accepted')
        broken=archive.testzip()
        if broken:raise ValueError(f'CRC failure: {broken}')
        archive.extractall(root)
        print(path.stem,len(archive.infolist()),'entries, CRC verified')
