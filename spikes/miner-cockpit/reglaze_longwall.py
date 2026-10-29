"""Longwall B with the V2 bridge glazing (#1143), a proposed exterior change for review.
Blender --background spikes/longwall-miner/longwall-miner.blend --python spikes/miner-cockpit/reglaze_longwall.py
Reads the approved study and writes longwall-miner-v2.blend/.glb here; the approved files are untouched.
The bridge is re-authored: each glazed facet carries glass at 90% of the facet in a slim frame, the
windscreen keeps a slim centre bar, and the front cap below the windscreen is glazed (the chin window).
"""
import bpy, bmesh, math, random
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
PANE = .90
CHIN = .82
MATS = {m.name: m for m in bpy.data.materials}

def in_bridge(v):
    return abs(v.x) < 2.45 and 3.55 < v.y < 6.85 and 16.0 < v.z < 24.45
removed = 0
for o in list(bpy.data.objects):
    if o.type != 'MESH' or not o.name.startswith('hull::'): continue
    bm = bmesh.new(); bm.from_mesh(o.data)
    doomed = [f for f in bm.faces if all(in_bridge(o.matrix_world @ v.co) for v in f.verts)]
    removed += len(doomed)
    bmesh.ops.delete(bm, geom=doomed, context='FACES'); bm.to_mesh(o.data); bm.free()

BATCH = {}
def poly(pts, mat):
    pts = [Vector(p) for p in pts]
    vs, fs, uvs = BATCH.setdefault(mat, [[], [], []]); i = len(vs)
    vs.extend(tuple(p) for p in pts); fs.append(tuple(range(i, i + len(pts))))
    n = (pts[1] - pts[0]).cross(pts[2] - pts[0]); axis = max(range(3), key=lambda k: abs(n[k])); ij = [k for k in range(3) if k != axis]
    uvs.append([(p[ij[0]] / 5.0, p[ij[1]] / 5.0) for p in pts])
def prism(pts, n, depth, mat):
    pts = [Vector(p) for p in pts]; top = [p + n * depth for p in pts]
    poly(top, mat); poly(list(reversed(pts)), mat)
    for a in range(len(pts)):
        b = (a + 1) % len(pts); poly([pts[a], pts[b], top[b], top[a]], mat)
def tube(a, b, r, mat, sides=8):
    a, b = Vector(a), Vector(b); z = (b - a).normalized(); up = Vector((0, 1, 0)) if abs(z.y) < .85 else Vector((1, 0, 0))
    u = z.cross(up).normalized(); v = z.cross(u)
    ring = [[p + r * (u * math.cos(k * math.tau / sides) + v * math.sin(k * math.tau / sides)) for k in range(sides)] for p in (a, b)]
    for k in range(sides):
        j = (k + 1) % sides; poly([ring[0][k], ring[0][j], ring[1][j], ring[1][k]], mat)

random.seed(803)
def plate(points, mat, n, depth=.09):
    """The approved study's plate (longwall-miner/build_model.py): seam bolts, edge chips and abrasion trails."""
    pts = [Vector(p) for p in points]; n = Vector(n).normalized(); c = sum(pts, Vector()) / len(pts)
    pts = [c + (p - c) * .982 for p in pts]; prism(pts, n, depth, mat)
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]; length = (q - p).length; count = max(1, int(length / 1.65))
        for j in range(count + 1):
            a = p.lerp(q, j / count) * .975 + c * .025 + n * (depth + .025)
            tube(a - n * .005, a + n * .025, .115, 'dark-structure', 8)
            tube(a + n * .025, a + n * .083, .075, 'machined-alloy', 6)
        for t in [.08, .19, .36, .49, .67, .83, .92]:
            a = p.lerp(q, t) + n * (depth + .004); b = p.lerp(q, min(.97, t + random.uniform(.03, .13))) + n * (depth + .004)
            mid = (a + b) / 2; poly([a, b, mid * .975 + c * .025 + n * .012], 'dark-structure' if t < .7 else 'machined-alloy')
        for t in [.27, .73]:
            a = p.lerp(q, t) + n * (depth + .006); inward = (c - a).normalized(); along = (q - p).normalized()
            length = random.uniform(.16, .55); width = random.uniform(.025, .07)
            poly([a - along * width, a + along * width, a + inward * length + along * width * .3], 'dark-structure')

rows = [(16.2, 2.2, 6.5), (19.2, 2.2, 6.5), (22, 2.0, 6.2), (24.2, 1.8, 4.8)]
R = [[Vector((x, y, z)) for x, y in [(-w * .85, t), (-w, t - .35), (-w, 3.9), (-w * .85, 3.65), (w * .85, 3.65), (w, 3.9), (w, t - .35), (w * .85, t)]] for z, w, t in rows]
axis_c = lambda z: Vector((0, 5.0, z))
def glazed_panel(q, n, inset, bar=False):
    c = sum(q, Vector()) / len(q)
    g = [c + (p - c) * inset for p in q]
    poly(g, 'canopy-glass')
    for a in range(len(q)):
        b = (a + 1) % len(q)
        prism([q[a], q[b], g[b], g[a]], n, .07, 'service-ochre')
        tube(g[a] + n * .075, g[b] + n * .075, .03, 'machined-alloy', 6)
    if bar:
        m0 = g[0].lerp(g[1], .5); m1 = g[3].lerp(g[2], .5)
        tube(m0 + n * .05, m1 + n * .05, .055, 'dark-structure', 10)
for seg in range(3):
    for j in range(8):
        k = (j + 1) % 8
        q = [R[seg][j], R[seg][k], R[seg + 1][k], R[seg + 1][j]]
        n = (q[1] - q[0]).cross(q[3] - q[0]).normalized(); c = sum(q, Vector()) / 4
        if n.dot(c - axis_c(c.z)) < 0: n = -n
        if (j in [1, 5]) or (j == 7 and seg == 2):
            glazed_panel(q, n, PANE, bar=(j == 7))
        else:
            poly(q, 'dark-structure')
            pl = [c + (p - c) * .982 for p in q]
            plate(q, 'service-ochre' if j in [0, 6, 7] else 'pale-steel-0', n, .12)
back = R[0]
poly(list(reversed(back)), 'dark-structure')
plate(list(reversed(back)), 'pale-steel-0', Vector((0, 0, -1)), .10)
glazed_panel(R[-1], Vector((0, 0, 1)), CHIN)
prism([Vector((x, y, z)) for x, y, z in [(-1.7, 6.58, 17.0), (1.7, 6.58, 17.0), (1.7, 6.58, 18.6), (-1.7, 6.58, 18.6)]], Vector((0, 1, 0)), .18, 'service-ochre')

# The approved study's two seats and lit consoles, which the face removal above also took out:
# they are what made the approved panes glow cyan from outside.
def box(c, size, mat):
    c = Vector(c); w, h, d = (s / 2 for s in size)
    p = [c + Vector((x * w, y * h, z * d)) for x, y, z in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]]
    for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (3, 7, 6, 2), (0, 4, 7, 3), (1, 2, 6, 5)]: poly([p[i] for i in f], mat)
for x in [-.68, .68]:
    box((x, 4.14, 19.4), (.62, .18, .7), 'recess-black'); box((x, 4.65, 19.05), (.62, .9, .17), 'recess-black')
    tube((x, 3.8, 19.4), (x, 4.08, 19.4), .12, 'machined-alloy')
    box((x, 4.22, 22), (.95, .8, .6), 'dark-structure'); box((x, 4.64, 22), (.72, .035, .37), 'cyan-display')
    box((x, 4.62, 23.3), (.9, .3, .5), 'dark-structure'); box((x, 4.79, 23.2), (.7, .02, .3), 'cyan-display')
poly([(-2.0, 3.7, 16.4), (2.0, 3.7, 16.4), (2.0, 6.3, 16.4), (-2.0, 6.3, 16.4)], 'recess-black')
box((0, 5.0, 16.5), (2.6, .5, .04), 'cyan-display')
for x in [-.68, .68]: box((x, 3.95, 23.6), (.8, .25, .04), 'cyan-display')
box((0, 6.2, 19.5), (1.6, .05, .5), 'amber-lamp')

parent = bpy.data.objects.get('hull')
for mat, (vs, fs, uvs) in BATCH.items():
    name = 'hull::bridge-glazing' if mat == 'canopy-glass' else f'hull::bridge-v2-{mat}'
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old)
    mesh = bpy.data.meshes.new(name); mesh.from_pydata(vs, [], fs); mesh.materials.append(MATS[mat])
    uv = mesh.uv_layers.new(name='surface-metres')
    for f, coords in zip(mesh.polygons, uvs):
        for li, co in zip(f.loop_indices, coords): uv.data[li].uv = co
    bm = bmesh.new(); bm.from_mesh(mesh); bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
    ob = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(ob)
    if parent: ob.parent = parent
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'longwall-miner-v2.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT / 'longwall-miner-v2.glb'), export_format='GLB', export_yup=False, export_apply=True, export_materials='EXPORT')
print('reglazed: removed', removed, 'faces; new batches', list(BATCH))
