"""Open glass from each bridge seat in the game frame (#1143): the share of the frame where a ray
from the eye leaves through the V3 glazing without meeting the cockpit or the hull.
Blender --background spikes/miner-cockpit/miner-cockpit-2seat.blend --python spikes/miner-cockpit/measure_seats.py -- <vfov deg> [label] [pitch rad, default the game's 0.12]
"""
import bpy, bmesh, math, sys, json
from pathlib import Path
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:]
VFOV = float(args[0]); LABEL = args[1] if len(args) > 1 else ''
PITCH = float(args[2]) if len(args) > 2 else 0.12
ROOT = Path(bpy.data.filepath).resolve().parents[2]
sc = bpy.context.scene
cockpit = {o for o in sc.objects if o.type == 'MESH' and not o.name.startswith(('screen-', 'label-'))}
with bpy.data.libraries.load(str(ROOT / 'spikes/miner-cockpit/longwall-miner-v3.blend'), link=False) as (src, dst):
    dst.objects = list(src.objects)
rows = [(16.2, 2.2, 6.5), (19.2, 2.2, 6.5), (22, 2.0, 6.2), (24.2, 1.8, 4.8)]
def inside_bridge(v):
    if not (16.35 < v.z < 24.05): return False
    for (z0, w0, t0), (z1, w1, t1) in zip(rows, rows[1:]):
        if z0 <= v.z <= z1:
            f = (v.z - z0) / (z1 - z0); w = w0 + (w1 - w0) * f; t = t0 + (t1 - t0) * f
            return abs(v.x) < w - .12 and 3.78 < v.y < t - .12
    return False
hull = set()
for o in dst.objects:
    if o is None: continue
    sc.collection.objects.link(o)
    if o.type != 'MESH': continue
    hull.add(o)
    bm = bmesh.new(); bm.from_mesh(o.data)
    doomed = [f for f in bm.faces if all(inside_bridge(o.matrix_world @ v.co) for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context='FACES'); bm.to_mesh(o.data); bm.free()
M = Matrix(((-1, 0, 0, .6), (0, 0, 1, -20.2), (0, 1, 0, -5.21), (0, 0, 0, 1)))
for o in dst.objects:
    if o is not None and o.parent is None: o.matrix_world = M @ o.matrix_world
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()

BLOCK = {}
GLASS_SEEN = [0]
def ray(eye, d):
    origin = eye.copy(); glass = False; first = None
    for _ in range(10):
        hit, loc, n, i, obj, m = sc.ray_cast(dg, origin, d, distance=300)
        if not hit: return glass and first is None
        if obj.name.endswith('bridge-glazing'):
            if not glass and first is None: GLASS_SEEN[0] += 1
            glass = True; origin = loc + d * 1e-3; continue
        if obj in cockpit:
            first = first or obj.name; origin = loc + d * 1e-3; continue
        if obj in hull:
            if glass and first is None: return False
            break
        origin = loc + d * 1e-3
    if glass and first: BLOCK[first] = BLOCK.get(first, 0) + 1
    return False

def B(x, y, z):
    c, s_ = math.cos(-PITCH), math.sin(-PITCH)
    y, z = y * c - z * s_, y * s_ + z * c
    return Vector((x, -z, y))
def survey(eye):
    t = math.tan(math.radians(VFOV / 2)); aspect = 1.5
    nx, ny = 96, 64; open_ = 0; top_rows = 0; centre_col_open = []
    for j in range(ny):
        v = (1 - 2 * (j + .5) / ny) * t
        for i in range(nx):
            u = (2 * (i + .5) / nx - 1) * t * aspect
            if ray(eye, B(u, v, -1).normalized()): open_ += 1
    return round(open_ / (nx * ny), 3)

out = {'vfov': VFOV, 'label': LABEL, 'pitch': PITCH,
       'pilot open glass share of frame': survey(B(0, 0, 0)),
       'miner open glass share of frame': survey(B(1.2, 0, 0))}
out['glass seen from the seats, share of both frames'] = round(GLASS_SEEN[0] / (2 * 96 * 64), 3)
out['glass hidden by cockpit, rays by object (pilot+miner)'] = dict(sorted(BLOCK.items(), key=lambda kv: -kv[1])[:8])
print('SEATS', json.dumps(out))
