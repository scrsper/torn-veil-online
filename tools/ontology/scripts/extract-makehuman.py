"""Extract the verified MakeHuman source archive, preserving all existing differing files."""
import sys, zipfile, hashlib
from pathlib import Path
root=Path('assets/imported/makehuman/system').resolve()
with zipfile.ZipFile(sys.argv[1]) as archive:
    for item in archive.infolist():
        target=(root/item.filename).resolve()
        if not target.is_relative_to(root):raise ValueError('Unsafe archive path')
        if item.external_attr >> 16 & 0o170000 == 0o120000:raise ValueError('Archive symlinks are not accepted')
        if target.is_file() and hashlib.sha256(target.read_bytes()).digest()!=hashlib.sha256(archive.read(item)).digest():
            raise ValueError(f'Existing source differs; refusing overwrite: {target}')
    broken=archive.testzip()
    if broken:raise ValueError(f'CRC failure: {broken}')
    archive.extractall(root)
    print(f'{len(archive.infolist())} entries; source hashes and archive CRC verified')
