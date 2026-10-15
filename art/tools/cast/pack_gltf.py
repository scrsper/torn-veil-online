"""Pack a .gltf (+ .bin + images) or re-pack a .glb into one self-contained GLB for the provisional cast.

    python3 -I art/tools/cast/pack_gltf.py <in.gltf|in.glb> <out.glb> [--max-texture 2048]

Geometry, skin, node names and materials are copied unchanged; only images larger than --max-texture are
downscaled (Lanczos, PNG/JPEG kept). Used for web/public/arena/cast/ (see CAST.md there).
"""
import io, json, os, struct, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
max_tex = int(sys.argv[sys.argv.index('--max-texture') + 1]) if '--max-texture' in sys.argv else 2048
base = os.path.dirname(os.path.abspath(src))

def read_glb(path):
    data = open(path, 'rb').read()
    magic, _, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, 'not a GLB'
    off, gltf, binc = 12, None, b''
    while off < length:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A: gltf = json.loads(chunk)
        elif ctype == 0x004E4942: binc = chunk
        off += 8 + clen
    return gltf, binc

if src.lower().endswith('.glb'):
    gltf, glb_bin = read_glb(src)
    buffers = [glb_bin]
else:
    gltf = json.load(open(src))
    buffers = [open(os.path.join(base, b['uri']), 'rb').read() for b in gltf['buffers']]

# Every bufferView keeps its bytes; images become new bufferViews appended to one buffer.
out = bytearray(); views = []
def push(data):
    while len(out) % 4: out.append(0)
    start = len(out); out.extend(data); return start

def view_bytes(v): return buffers[v.get('buffer', 0)][v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
image_views = {img['bufferView'] for img in gltf.get('images', []) if 'bufferView' in img}
remap = {}
for i, v in enumerate(gltf.get('bufferViews', [])):
    if i in image_views: continue  # embedded image bytes are re-emitted (possibly downscaled) below
    v2 = dict(v); v2['buffer'] = 0; v2['byteOffset'] = push(view_bytes(v)); remap[i] = len(views); views.append(v2)
for acc in gltf.get('accessors', []):
    if 'bufferView' in acc: acc['bufferView'] = remap[acc['bufferView']]
    sp = acc.get('sparse')
    if sp:
        sp['indices']['bufferView'] = remap[sp['indices']['bufferView']]; sp['values']['bufferView'] = remap[sp['values']['bufferView']]

def shrink(raw, mime):
    im = Image.open(io.BytesIO(raw))
    if max(im.size) <= max_tex: return raw, mime, im.size, im.size
    s = max_tex / max(im.size); new = (max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s)))
    small = im.resize(new, Image.LANCZOS); b = io.BytesIO()
    fmt = 'JPEG' if mime == 'image/jpeg' else 'PNG'
    small.save(b, fmt, **({'quality': 92} if fmt == 'JPEG' else {'optimize': True}))
    return b.getvalue(), mime, im.size, new

report = []
for img in gltf.get('images', []):
    if 'uri' in img:
        raw = open(os.path.join(base, img['uri']), 'rb').read()
        mime = img.get('mimeType') or ('image/jpeg' if img['uri'].lower().endswith(('.jpg', '.jpeg')) else 'image/png')
        name = img.get('name') or os.path.splitext(img['uri'])[0]
    else:
        raw = view_bytes(gltf['bufferViews'][img['bufferView']]); mime = img['mimeType']
        name = img.get('name', '')
    data, mime, before, after = shrink(raw, mime)
    views.append({'buffer': 0, 'byteOffset': push(data), 'byteLength': len(data)})
    img.clear(); img.update({'name': name, 'mimeType': mime, 'bufferView': len(views) - 1})
    report.append(f'{name}: {before[0]}x{before[1]} -> {after[0]}x{after[1]}')

while len(out) % 4: out.append(0)
gltf['bufferViews'] = views
gltf['buffers'] = [{'byteLength': len(out)}]
js = json.dumps(gltf, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
total = 12 + 8 + len(js) + 8 + len(out)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(out)
print(dst, total, 'bytes;', '; '.join(report))
