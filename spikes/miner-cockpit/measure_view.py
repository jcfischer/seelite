"""View budget from the pilot eye: which occluder limits the forward view.
Blender --background spikes/miner-cockpit/miner-cockpit.blend --python spikes/miner-cockpit/measure_view.py
"""
import bpy, bmesh, math, json
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.geometry import intersect_ray_tri

ROOT = Path(bpy.data.filepath).resolve().parents[2]
sc = bpy.context.scene
cockpit = [o for o in sc.objects if o.type == 'MESH']

with bpy.data.libraries.load(str(ROOT / 'spikes/longwall-miner/longwall-miner.blend'), link=False) as (src, dst):
    dst.objects = list(src.objects)
rows = [(16.2, 2.2, 6.5), (19.2, 2.2, 6.5), (22, 2.0, 6.2), (24.2, 1.8, 4.8)]
def inside_bridge(v):
    if not (16.35 < v.z < 24.05): return False
    for (z0, w0, t0), (z1, w1, t1) in zip(rows, rows[1:]):
        if z0 <= v.z <= z1:
            f = (v.z - z0) / (z1 - z0); w = w0 + (w1 - w0) * f; t = t0 + (t1 - t0) * f
            return abs(v.x) < w - .12 and 3.78 < v.y < t - .12
    return False
hull = []
for o in dst.objects:
    if o is None: continue
    sc.collection.objects.link(o)
    if o.type != 'MESH': continue
    hull.append(o)
    bm = bmesh.new(); bm.from_mesh(o.data)
    doomed = [f for f in bm.faces if all(inside_bridge(o.matrix_world @ v.co) for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context='FACES'); bm.to_mesh(o.data); bm.free()

def place_hull(eye):
    m = Matrix(((-1, 0, 0, eye.x), (0, 0, 1, -eye.z), (0, 1, 0, -eye.y), (0, 0, 0, 1)))
    for o in dst.objects:
        if o is not None and o.parent is None: o.matrix_world = m
    bpy.context.view_layer.update()

def facets(eye, inset=1.0):
    """Glazed facet quads (exterior), as Blender-frame triangles, optionally inset."""
    def P(x, y, z): return Vector((-x + eye.x, z - eye.z, y - eye.y))
    def row(z, w, top):
        return [P(x, y, z) for x, y in [(-w * .85, top), (-w, top - .35), (-w, 3.9), (-w * .85, 3.65), (w * .85, 3.65), (w, 3.9), (w, top - .35), (w * .85, top)]]
    R = [row(*r) for r in rows]
    out = {}
    for seg in range(3):
        for j in range(8):
            if not ((j in [1, 5]) or (j == 7 and seg == 2)): continue
            k = (j + 1) % 8
            q = [R[seg][j], R[seg][k], R[seg + 1][k], R[seg + 1][j]]
            c = sum(q, Vector()) / 4
            q = [c + (p - c) * inset for p in q]
            name = 'windscreen' if j == 7 else ('right-side' if j == 1 else 'left-side')
            out.setdefault(name, []).append(q)
    cap = R[-1]
    out['chin'] = [[cap[3], cap[4], cap[5], cap[2]]]
    return out

def gl(f): return f["windscreen"] + f["right-side"] + f["left-side"]

def through(quads, d):
    for q in quads:
        for tri in [(q[0], q[1], q[2]), (q[0], q[2], q[3])]:
            if intersect_ray_tri(*tri, d, Vector((0, 0, 0)), True): return True
    return False

def first_hit(d, objs):
    origin = Vector((0, 0, 0)); dg = bpy.context.evaluated_depsgraph_get()
    for _ in range(8):
        hit, loc, n, i, obj, mtx = sc.ray_cast(dg, origin, d)
        if not hit: return None
        if obj.name.endswith('bridge-glazing') or obj.name.endswith('cyan-display') or obj not in objs:
            origin = loc + d * 1e-3; continue
        return obj
    return None

def B(az, el):
    a, e = math.radians(az), math.radians(el)
    return Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))

STEP = 1.0
AZ = [x * STEP for x in range(-60, 61)]
EL = [y * STEP for y in range(-40, 41)]
def grid(is_open):
    cells = {(a, e) for a in AZ for e in EL if is_open(B(a, e))}
    return cells

def extents(cells, frame_only=True):
    inframe = lambda a, e: abs(math.tan(math.radians(a))) <= math.tan(math.radians(40.9)) * 1 and abs(math.tan(math.radians(e))) <= math.tan(math.radians(30)) / max(1e-6, math.cos(math.radians(a)))
    fc = [c for c in cells if inframe(*c)] if frame_only else list(cells)
    def span(fix, axis):
        vals = sorted(c[1 - axis] for c in fc if c[axis] == fix)
        return (vals[0], vals[-1]) if vals else None
    return {'cells_deg2': len(fc) * STEP * STEP,
            'horizontal_at_el+5': span(5.0, 1), 'horizontal_at_el+10': span(10.0, 1),
            'vertical_at_az-10': span(-10.0, 0), 'vertical_at_az0': span(0.0, 0)}

report = {}
eye_r = Vector((-0.6, 5.21, 20.2))
place_hull(eye_r)
glass = [o for o in hull]
report['current: interior + exterior'] = extents(grid(lambda d: first_hit(d, set(cockpit) | set(hull)) is None and through(gl(facets(eye_r, .74)), d)))
report['exterior only (as approved)'] = extents(grid(lambda d: first_hit(d, set(hull)) is None and through(gl(facets(eye_r, .74)), d)))
for inset in [.74, .88, 1.0]:
    f = facets(eye_r, inset)
    report[f'exterior glass at {inset:.2f} of facet, no frames'] = extents(grid(lambda d, f=f: through(f['windscreen'] + f['right-side'] + f['left-side'], d)))
f = facets(eye_r, 1.0)
report['full facets + glazed chin (front cap)'] = extents(grid(lambda d: through(sum(f.values(), []), d)))
for name in ['windscreen', 'right-side', 'left-side']:
    report[f'right-seat {name} facet at .74'] = extents(grid(lambda d, q=facets(eye_r, .74)[name]: through(q, d)), frame_only=False)
eye_l = Vector((0.6, 5.21, 20.2))
place_hull(eye_l)
report['left seat: exterior only (as approved)'] = extents(grid(lambda d: first_hit(d, set(hull)) is None and through(gl(facets(eye_l, .74)), d)))
print('VIEW', json.dumps(report))

place_hull(eye_r)
ws = lambda inset: facets(eye_r, inset)['windscreen']
def chin_full(eye):
    def P(x, y, z): return Vector((-x + eye.x, z - eye.z, y - eye.y))
    w, top = 1.8, 4.8
    pts = [P(x, y, 24.2) for x, y in [(-w * .85, top), (-w, top - .35), (-w, 3.9), (-w * .85, 3.65), (w * .85, 3.65), (w, 3.9), (w, top - .35), (w * .85, top)]]
    return [[pts[0], pts[1], pts[2], pts[3]], [pts[0], pts[3], pts[4], pts[7]], [pts[7], pts[4], pts[5], pts[6]]]
r2 = {}
r2['windscreen: interior + exterior'] = extents(grid(lambda d: first_hit(d, set(cockpit) | set(hull)) is None and through(ws(.74), d)))
r2['windscreen: exterior only'] = extents(grid(lambda d: first_hit(d, set(hull)) is None and through(ws(.74), d)))
r2['windscreen: pane .74, no frames'] = extents(grid(lambda d: through(ws(.74), d)))
r2['windscreen: pane .90'] = extents(grid(lambda d: through(ws(.90), d)))
r2['windscreen: full facet'] = extents(grid(lambda d: through(ws(1.0), d)))
r2['front cap glazed (chin)'] = extents(grid(lambda d: through(chin_full(eye_r), d)), frame_only=False)
r2['side windows: interior + exterior'] = extents(grid(lambda d: first_hit(d, set(cockpit) | set(hull)) is None and through(facets(eye_r, .74)['right-side'] + facets(eye_r, .74)['left-side'], d)))
r2['side windows: exterior only'] = extents(grid(lambda d: first_hit(d, set(hull)) is None and through(facets(eye_r, .74)['right-side'] + facets(eye_r, .74)['left-side'], d)))
print('VIEW2', json.dumps(r2))
