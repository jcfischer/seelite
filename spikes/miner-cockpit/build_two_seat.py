"""Longwall B two-seat bridge study (#1143, concept 2). Blender --background --python spikes/miner-cockpit/build_two_seat.py
Pilot-local metres: +X right, +Y up, -Z forward, the pilot eye (left seat) at the origin."""
import bpy, math, random
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'spikes/miner-cockpit'
random.seed(1143)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
BATCH = {}
MATS = {}
SCREENS = []

EYE_STUDY = Vector((0.6, 5.21, 20.2))
def P(xs, ys, zs):
    """Longwall study metres to pilot-local metres."""
    return Vector((-xs + EYE_STUDY.x, ys - EYE_STUDY.y, -(zs - EYE_STUDY.z)))

def material(name, color, metal=.6, rough=.48, emit=0, textured=True):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal; p.inputs['Roughness'].default_value = rough
    if emit:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emit
    elif textured:
        t = m.node_tree.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(str(ROOT / 'spikes/courier-cockpit/steel-wear.png'), check_existing=True)
        mix = m.node_tree.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1; mix.inputs[2].default_value = (*color, 1)
        m.node_tree.links.new(t.outputs['Color'], mix.inputs[1])
        m.node_tree.links.new(mix.outputs[0], p.inputs['Base Color'])
        ramp = m.node_tree.nodes.new('ShaderNodeMapRange')
        ramp.inputs[3].default_value = rough + .22; ramp.inputs[4].default_value = rough - .18
        m.node_tree.links.new(t.outputs['Color'], ramp.inputs[0]); m.node_tree.links.new(ramp.outputs[0], p.inputs['Roughness'])
    MATS[name] = m; BATCH[name] = [[], [], []]
    return name

steel = material('weathered-blue-steel', (.25, .38, .49), .75, .36)
dark = material('graphite-housings', (.15, .21, .27), .6, .43)
alloy = material('exposed-machined-edges', (.32, .34, .33), .82, .32)
black = material('rubber-and-recess', (.012, .018, .02), .12, .72, textured=False)
ochre = material('service-ochre', (.68, .32, .045), .35, .52)
red = material('guarded-red', (.4, .032, .02), .3, .45)
warm = material('amber-work-lights', (1, .38, .05), .15, .28, 3.0)
cyan = material('cyan-indicators', (.04, .6, .8), .1, .35, 2)
lining = material('cabin-lining', (.40, .46, .50), .45, .5)
hose = material('hose-rubber', (.01, .011, .012), 0, .9, textured=False)
MATS[hose].node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = .15

def poly(points, mat, uv=None):
    vs, fs, uvs = BATCH[mat]; i = len(vs)
    vs.extend([tuple(p) for p in points]); fs.append(tuple(range(i, i + len(points))))
    if uv is None:
        n = (Vector(points[1]) - Vector(points[0])).cross(Vector(points[2]) - Vector(points[0]))
        axis = max(range(3), key=lambda i: abs(n[i])); ij = [i for i in range(3) if i != axis]
        uv = [(p[ij[0]] * 1.5, p[ij[1]] * 1.5) for p in points]
    uvs.append(uv)

def basis(a=0):
    return Vector((1, 0, 0)), Vector((0, math.cos(a), math.sin(a))), Vector((0, -math.sin(a), math.cos(a)))

def box(c, size, mat, a=0, frame=None):
    c = Vector(c); u, v, n = frame or basis(a); w, h, d = size
    pts = [c + u * x * w / 2 + v * y * h / 2 + n * z * d / 2 for x, y, z in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]]
    for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (3, 7, 6, 2), (0, 4, 7, 3), (1, 2, 6, 5)]: poly([pts[i] for i in f], mat)

def tube(a, b, r, mat, sides=10):
    a, b = Vector(a), Vector(b); n = (b - a).normalized(); up = Vector((0, 1, 0))
    if abs(n.dot(up)) > .9: up = Vector((1, 0, 0))
    u = n.cross(up).normalized(); v = n.cross(u).normalized()
    rings = [[p + r * (u * math.cos(i * math.tau / sides) + v * math.sin(i * math.tau / sides)) for i in range(sides)] for p in (a, b)]
    for i in range(sides):
        j = (i + 1) % sides; poly([rings[0][i], rings[0][j], rings[1][j], rings[1][i]], mat)
    poly(list(reversed(rings[0])), mat); poly(rings[1], mat)

def path(points, r, mat):
    for a, b in zip(points, points[1:]): tube(a, b, r, mat)

def curve_path(points, r, mat, sides=12, steps=8):
    p = [Vector(points[0])] + [Vector(v) for v in points] + [Vector(points[-1])]
    samples = []
    for i in range(1, len(p) - 2):
        a, b, c, d = p[i - 1:i + 3]
        for j in range(steps):
            t = j / steps
            samples.append(.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t))
    samples.append(Vector(points[-1]))
    rings = []
    for i, c in enumerate(samples):
        n = (samples[min(i + 1, len(samples) - 1)] - samples[max(0, i - 1)]).normalized()
        ref = Vector((0, 0, 1)) if abs(n.z) < .9 else Vector((0, 1, 0))
        u = n.cross(ref).normalized(); v = n.cross(u).normalized()
        rings.append([c + r * (u * math.cos(k * math.tau / sides) + v * math.sin(k * math.tau / sides)) for k in range(sides)])
    for a, b in zip(rings, rings[1:]):
        for i in range(sides):
            j = (i + 1) % sides; poly([a[i], a[j], b[j], b[i]], mat)
    poly(list(reversed(rings[0])), mat); poly(rings[-1], mat)
    return samples

def band(c, d, r, w, mat, sides=16):
    up = Vector((0, 1, 0)) if abs(d.y) < .9 else Vector((1, 0, 0))
    u = d.cross(up).normalized(); v = d.cross(u).normalized()
    ring = lambda o, rr: [c + d * o + rr * (u * math.cos(i * math.tau / sides) + v * math.sin(i * math.tau / sides)) for i in range(sides)]
    a, m, b = ring(-w, r), ring(0, r * 1.06), ring(w, r)
    for i in range(sides):
        j = (i + 1) % sides
        poly([a[i], a[j], m[j], m[i]], mat); poly([m[i], m[j], b[j], b[i]], mat)

def ribbed_hose(points, r, mat=hose, pitch=.024, sides=18):
    """A corrugated hose: one swept surface whose radius ripples along its length."""
    p = [Vector(points[0])] + [Vector(v) for v in points] + [Vector(points[-1])]
    dense = []
    for i in range(1, len(p) - 2):
        a, b, c, d = p[i - 1:i + 3]
        for j in range(40):
            t = j / 40
            dense.append(.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t))
    dense.append(Vector(points[-1]))
    step = pitch / 6; samples = [dense[0]]; acc = 0
    for a, b in zip(dense, dense[1:]):
        acc += (b - a).length
        if acc >= step: samples.append(b); acc = 0
    t0 = (samples[1] - samples[0]).normalized()
    u = t0.cross(Vector((0, 1, 0)) if abs(t0.y) < .9 else Vector((1, 0, 0))).normalized()
    rings = []; s_len = 0
    for i, c in enumerate(samples):
        t = (samples[min(i + 1, len(samples) - 1)] - samples[max(0, i - 1)]).normalized()
        u = (u - t * u.dot(t)).normalized(); v = t.cross(u)
        if i: s_len += (c - samples[i - 1]).length
        rr = r * (1 + .075 * math.cos(math.tau * s_len / pitch))
        rings.append([c + rr * (u * math.cos(k * math.tau / sides) + v * math.sin(k * math.tau / sides)) for k in range(sides)])
    for a, b in zip(rings, rings[1:]):
        for i in range(sides):
            j = (i + 1) % sides; poly([a[i], a[j], b[j], b[i]], mat)
    poly(list(reversed(rings[0])), mat); poly(rings[-1], mat)

def bezel(c, w, h, thickness, mat, a=0, frame=None):
    c = Vector(c); u, v, n = frame or basis(a)
    def ring(w, h):
        cut = .055
        return [c + u * x + v * y for x, y in [(-w / 2 + cut, -h / 2), (w / 2 - cut, -h / 2), (w / 2, -h / 2 + cut), (w / 2, h / 2 - cut), (w / 2 - cut, h / 2), (-w / 2 + cut, h / 2), (-w / 2, h / 2 - cut), (-w / 2, -h / 2 + cut)]]
    outer = ring(w, h); inner = ring(w - 2 * thickness, h - 2 * thickness)
    for i in range(8):
        j = (i + 1) % 8
        poly([outer[i], outer[j], inner[j], inner[i]], mat)
        poly([outer[i] - n * .035, outer[j] - n * .035, outer[j], outer[i]], mat)
        poly([inner[i], inner[j], inner[j] - n * .035, inner[i] - n * .035], mat)

def plane(name, c, w, h, a=0, frame=None):
    u, v, n = frame or basis(a); c = Vector(c)
    SCREENS.append((name, [c - u * w / 2 - v * h / 2, c + u * w / 2 - v * h / 2, c + u * w / 2 + v * h / 2, c - u * w / 2 + v * h / 2]))

def transform_since(mark, fn):
    """Apply fn to every vertex and screen corner authored after `mark`."""
    for name, (vs, fs, uvs) in BATCH.items():
        start = mark['verts'].get(name, 0)
        vs[start:] = [tuple(fn(Vector(p))) for p in vs[start:]]
    for k in range(mark['screens'], len(SCREENS)):
        name, pts = SCREENS[k]; SCREENS[k] = (name, [fn(p) for p in pts])

def mark():
    return {'verts': {n: len(b[0]) for n, b in BATCH.items()}, 'screens': len(SCREENS)}


# ---------------------------------------------------------------- two-seat bridge (#1143, concept 2)
# Pilot-local metres with the PILOT eye (left seat) at the origin. The miner's eye is +1.2 m in X.
MINER_EYE = Vector((1.2, 0, 0))
CENTRE_X = .6
PANE, CHIN = .90, .82
FLOOR_Y = 4.0 - EYE_STUDY.y
seatcloth = material('seat-cloth', (.34, .45, .54), .15, .55)
bolster = material('seat-bolster', (.62, .42, .12), .2, .6)

def facing(c, eye):
    n = (eye - c).normalized(); u = Vector((0, 1, 0)).cross(n).normalized(); v = n.cross(u).normalized()
    return (u, v, n)

# Bridge lining inside the V2 glazing: the panes are 90% of each glazed facet, the chin 82% of the cap.
rows_study = [(16.2, 2.2, 6.5), (19.2, 2.2, 6.5), (22, 2.0, 6.2), (24.2, 1.8, 4.8)]
LINE = .11
def row(z, w, top, inset=0):
    w2 = w - inset; t2 = top - inset; f = 3.65 + inset
    return [P(x, y, z) for x, y in [(-w2 * .85, t2), (-w2, t2 - .35), (-w2, 3.9 + inset * .5), (-w2 * .85, f), (w2 * .85, f), (w2, 3.9 + inset * .5), (w2, t2 - .35), (w2 * .85, t2)]]
outer = [row(*r) for r in rows_study]
inner = [row(*r, inset=LINE) for r in rows_study]
centre_axis = lambda p: Vector((CENTRE_X, .3, p.z))
def opening(q_out, q_in, inset, bar=False, n_hint=None):
    c = sum(q_out, Vector()) / len(q_out)
    glass = [c + (p - c) * inset for p in q_out]
    n = (q_out[1] - q_out[0]).cross(q_out[len(q_out) - 1] - q_out[0]).normalized()
    if n_hint is not None:
        if n.dot(n_hint) < 0: n = -n
    elif n.dot(c - centre_axis(c)) < 0: n = -n
    depth = (sum(q_out, Vector()) / len(q_out) - sum(q_in, Vector()) / len(q_in)).dot(n)
    reveal = [g - n * depth for g in glass]
    cq = sum(q_in, Vector()) / len(q_in)
    for a in range(len(q_in)):
        b = (a + 1) % len(q_in)
        poly([q_in[b], q_in[a], reveal[a], reveal[b]], lining)
        poly([reveal[b], reveal[a], glass[a], glass[b]], steel)
        tube(reveal[a] - n * .012, reveal[b] - n * .012, .016, alloy, 6)
    if bar:
        m0 = reveal[0].lerp(reveal[1], .5); m1 = reveal[3].lerp(reveal[2], .5)
        tube(m0 + n * depth * .5, m1 + n * depth * .5, .045, steel, 10)
    return glass, n
for seg in range(3):
    for j in range(8):
        k = (j + 1) % 8
        o = [outer[seg][j], outer[seg][k], outer[seg + 1][k], outer[seg + 1][j]]
        q = [inner[seg][j], inner[seg][k], inner[seg + 1][k], inner[seg + 1][j]]
        if (j in [1, 5]) or (j == 7 and seg == 2):
            opening(o, q, PANE, bar=(j == 7))
            continue
        poly(list(reversed(q)), lining if j not in [2, 3, 4] else dark)
        if j != 3:
            cq = sum(q, Vector()) / 4; nq = (q[1] - q[0]).cross(q[3] - q[0]).normalized()
            if nq.dot(cq - centre_axis(cq)) > 0: nq = -nq
            pl = [cq + (p - cq) * .86 + nq * .02 for p in q]
            poly(list(reversed(pl)), steel)
            for p in pl: tube(cq + (p - cq) * .93, cq + (p - cq) * .93 + nq * .02, .016, alloy, 8)
poly(list(inner[0]), lining)
opening(list(reversed(outer[-1])), list(reversed(inner[-1])), CHIN, n_hint=Vector((0, 0, -1)))

# Floor plates, an aisle tread down the centre, footwells under both pods.
for x in [-1.0, -.3, 1.5, 2.2]:
    for z in [-3.3, -2.5, -1.7, -.9, -.1, .7, 1.5]:
        box((x, FLOOR_Y + .015, z), (.66, .03, .76), steel)
for z in [-2.4, -1.6, -.8, 0, .8, 1.6]:
    box((CENTRE_X, FLOOR_Y + .02, z), (.5, .03, .76), steel)
    for dx in [-.21, .21]:
        for dz in [-.33, 0, .33]: tube((CENTRE_X + dx, FLOOR_Y + .035, z + dz), (CENTRE_X + dx, FLOOR_Y + .045, z + dz), .012, alloy, 6)

def pod(xc, eye, width, screens, name):
    """A free-standing instrument pod on a plinth: a tilted face toward its eye under a hood."""
    zc = -1.15
    face_c = Vector((xc, -.42, zc))
    u, v, n = facing(face_c, eye)
    frame = (u, v, n)
    def at(a, b, d=0): return face_c + u * a + v * b + n * d
    h = .56
    box(at(0, 0, -.16), (width, h, .3), dark, frame=frame)
    box(at(0, 0, -.005), (width - .04, h - .04, .02), steel, frame=frame)
    box(at(0, h / 2 + .03, -.12), (width + .06, .07, .4), steel, frame=frame)
    for s in [-1, 1]:
        box(at(s * (width / 2 + .03), 0, -.12), (.06, h + .1, .4), steel, frame=frame)
    base_top = face_c.y - h / 2 * v.y
    box(Vector((xc, (FLOOR_Y + base_top) / 2, zc - .18)), (width - .1, base_top - FLOOR_Y, .55), dark)
    for s in [-1, 1]:
        for k in range(6):
            box(Vector((xc + s * (width / 2 - .08), FLOOR_Y + .2 + k * .07, zc + .07)), (.03, .03, .22), black)
    for sname, a, b, w, hh in screens:
        box(at(a, b, .012), (w + .03, hh + .03, .02), black, frame=frame)
        plane(sname, at(a, b, .024), w, hh, frame=frame)
        bezel(at(a, b, .036), w + .04, hh + .04, .022, black, frame=frame)
    return at, frame

pilot_at, pilot_frame = pod(-.14, Vector((0, 0, 0)), 1.06, [
    ('screen-radar', -.09, .05, .44, .27),
    ('screen-flight', .32, .16, .28, .14),
    ('screen-target', .32, -.06, .28, .14),
    ('screen-status', -.09, -.2, .44, .06),
    ('screen-systems', -.42, -.2, .1, .08),
], 'pilot')
for b in [.12, 0, -.1]:
    c = pilot_at(-.42, b, .02); tube(c, c + pilot_frame[2] * .045, .03, alloy, 14); tube(c + pilot_frame[2] * .045, c + pilot_frame[2] * .07, .022, black, 12)
plane('label-radar', pilot_at(-.09, -.12, .026), .3, .025, frame=pilot_frame)
plane('label-flight', pilot_at(.32, .25, .026), .22, .022, frame=pilot_frame)
plane('label-target', pilot_at(.32, -.15, .026), .22, .022, frame=pilot_frame)
miner_at, miner_frame = pod(1.34, MINER_EYE, 1.06, [
    ('screen-survey', -.36, .19, .21, .14),
    ('screen-ore', -.12, .19, .21, .14),
    ('screen-drill', .12, .19, .21, .14),
    ('screen-anchor', .36, .19, .21, .14),
    ('screen-stance', -.36, -.08, .2, .27),
    ('screen-drillcam', -.04, -.08, .36, .27),
    ('screen-lasers', .33, -.08, .21, .27),
], 'miner')

# Two seats behind the eyes: painted shells with tan cushions, wings, headrests, and a ribbed hose
# down each outer edge. The pilot's flight stick and the miner's feed lever sit on the aisle armrests.
shell = material('seat-shell', (.34, .45, .54), .5, .45)
cushion = material('seat-cushion', (.55, .40, .24), .05, .72, textured=False)
for xs, aisle in [(0.0, 1), (1.2, -1)]:
    box((xs, -1.0, .42), (.62, .1, .62), shell)
    box((xs, -.92, .4), (.52, .08, .54), cushion)
    tube((xs, FLOOR_Y, .42), (xs, -1.05, .42), .07, alloy, 12)
    back = Vector((xs, -.45, .8)); tilt = basis(.18)
    box(back, (.62, 1.0, .12), shell, frame=tilt)
    box(back - tilt[2] * .08, (.48, .86, .06), cushion, frame=tilt)
    for s in [-1, 1]:
        wing = (Matrix.Rotation(-s * .35, 3, 'Y') @ tilt[0], tilt[1], Matrix.Rotation(-s * .35, 3, 'Y') @ tilt[2])
        box(back + Vector((s * .3, 0, -.05)), (.1, .95, .22), shell, frame=wing)
    box(Vector((xs, .14, .86)), (.36, .26, .14), shell)
    box(Vector((xs, .14, .78)), (.3, .2, .04), cushion)
    for s in [-1, 1]:
        ribbed_hose([(xs + s * .38, .0, .9), (xs + s * .44, -.4, .95), (xs + s * .42, -.9, .85), (xs + s * .34, FLOOR_Y + .1, .7)], .04)
    arm = Vector((xs + aisle * .38, -.72, .1))
    box(arm, (.14, .1, .62), shell)
    box(arm + Vector((0, .06, 0)), (.12, .03, .56), cushion)
    box(Vector((arm.x, (FLOOR_Y - .72) / 2, .25)), (.12, -.72 - FLOOR_Y, .3), dark)
    grip = arm + Vector((0, .07, -.22))
    if aisle > 0:
        tube(grip, grip + Vector((0, .14, .02)), .02, alloy, 12)
        box(grip + Vector((0, .24, .02)), (.06, .16, .07), black)
        box(grip + Vector((0, .33, .0)), (.05, .02, .04), red)
    else:
        for dx in [-.025, .025]: tube(grip + Vector((dx, 0, 0)), grip + Vector((dx, .14, -.04)), .013, alloy, 8)
        box(grip + Vector((0, .16, -.05)), (.09, .035, .035), red)

# Discrete amber lamps on the window pillars and the header (#839).
for p in [(-1.05, .45, -1.95), (2.25, .45, -1.95), (-.9, -.3, -2.6), (2.1, -.3, -2.6)]:
    c = Vector(p); f = facing(c, Vector((CENTRE_X, 0, 0)))
    box(c, (.09, .15, .05), black, frame=f); box(c + f[2] * .03, (.06, .11, .012), warm, frame=f)

for name, (vs, fs, uvs) in BATCH.items():
    BATCH[name][0] = [(x, max(y, FLOOR_Y), z) for x, y, z in vs]

for name, pts in SCREENS:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(p.x, -p.z, p.y) for p in pts], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new()
    for li, co in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]): uv.data[li].uv = co
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)
    obj.data.materials.append(MATS[black])

for name, (verts, faces, uvs) in BATCH.items():
    if not faces: continue
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(x, -z, y) for x, y, z in verts], [], faces); mesh.update()
    uv = mesh.uv_layers.new(name='surface-metres')
    for f, coords in zip(mesh.polygons, uvs):
        for li, co in zip(f.loop_indices, coords): uv.data[li].uv = co
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)
    obj.data.materials.append(MATS[name])
    if name == hose:
        for f in mesh.polygons: f.use_smooth = True
    if name not in [warm, cyan, black, hose]:
        mod = obj.modifiers.new('Machined edge bevels', 'BEVEL'); mod.width = .012; mod.segments = 3
        mod.affect = 'EDGES'; mod.harden_normals = True; mod.limit_method = 'ANGLE'
        for f in mesh.polygons: f.use_smooth = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        weighted = obj.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL'); weighted.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=weighted.name)

for image in bpy.data.images:
    if image.source == 'FILE': image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'miner-cockpit-2seat.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT / 'miner-cockpit-2seat.glb'), export_format='GLB', export_yup=True, export_apply=True)
print('Cockpit exported', len(bpy.data.objects), 'objects', 'screens', [s[0] for s in SCREENS])
