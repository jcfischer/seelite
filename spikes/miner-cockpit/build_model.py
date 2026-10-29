"""Longwall B miner cockpit study (#1143). Blender --background --python spikes/miner-cockpit/build_model.py.
Pilot-local metres: +X right, +Y up, -Z forward, the pilot eye at the origin, level (no cabin pitch).
The eye is study (-0.6, 5.21, 20.2) m in longwall-miner.blend, game ship frame (0.6, 6.8, -25.0) m.
The flight dash is the courier cabin's (#792) equipment, carried over at the frame the game shows it in.
"""
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

EYE_STUDY = Vector((-0.6, 5.21, 20.2))
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
warm = material('amber-work-lights', (1, .38, .05), .15, .28, 1.1)
cyan = material('cyan-indicators', (.04, .6, .8), .1, .35, 2)
lining = material('cabin-lining', (.20, .30, .39), .55, .46)
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

# ---------------------------------------------------------------- flight dash
# Authored in the courier cabin's frame, then carried to the frame the game shows
# it in (eye (0, .3, 1.15), cabin pitch .242 rad) and scaled about the eye, so the
# dash keeps its on-screen place while fitting a bridge 1.56 m above the floor.
COURIER_EYE = Vector((0, .3, 1.15)); COURIER_PITCH = .242; DASH_SCALE = .48
dash_mark = mark()
A = -.82
def panel(name, c, w, h, frame_mat=dark):
    c = Vector(c); u, v, n = basis(A)
    def p(x, y, z=0): return c + u * x + v * y + n * z
    box(c, (w, h, .22), frame_mat, A)
    box(p(0, 0, .12), (w - .045, h - .045, .035), dark, A)
    box(p(0, 0, .146), (w - .085, h - .085, .03), steel, A)
    sw, sh = w - .26, h - .24
    box(p(0, 0, .167), (sw + .045, sh + .045, .035), black, A)
    plane('screen-' + name, p(0, 0, .19), sw, sh, A)
    if name != 'systems': plane('label-' + name, p(0, -h / 2 + .065, .182), min(w - .4, .9), .047, A)
    bezel(p(0, 0, .205), sw + .085, sh + .085, .034, black, A)
    for x in [-w / 2 + .035, w / 2 - .035]:
        box(p(x, 0, .185), (.026, h - .18, .036), alloy, A)
        for y in [-h / 2 + .10, h / 2 - .10]:
            box(p(x, y, .206), (.09, .13, .055), dark, A)
    for x in [-w / 2 + .06, w / 2 - .06]:
        for y in [-h / 2 + .06, h / 2 - .06, 0]:
            tube(p(x, y, .15), p(x, y, .182), .024, alloy, 8)
    return p

radar = panel('radar', (0, -.87, -2.35), 1.80, 1.20)
flight = panel('flight', (-1.53, -.81, -2.42), 1.32, .72)
systems = panel('systems', (-1.53, -1.37, -2.15), 1.32, .47)
target = panel('target', (1.53, -.91, -2.4), 1.35, .96)
# The status strip the game writes MODE / THR / ASSIST / CHARGE on, above the scope.
box(radar(0, .70, .12), (1.5, .16, .2), dark, A)
box(radar(0, .70, .2), (1.42, .11, .03), black, A)
plane('screen-status', radar(0, .70, .236), 1.38, .088, A)
box((0, -1.47, -2.50), (4.7, .30, 1.05), dark)
for x in [-2.4, -.91, .91, 2.4]:
    path([(x, -1.7, -1.25), (x, -1.18, -2.25), (x, -.94, -3.2)], .065, alloy)
    path([(x + .08, -1.7, -1.25), (x + .08, -1.19, -2.25), (x + .08, -.95, -3.2)], .04, black)
for x in [-1.8, -.62, .62, 1.8]:
    box((x, -.50, -3.07), (.75, .06, .26), steel)
    for k in range(8): box((x - .27 + k * .078, -.46, -3.06), (.034, .012, .19), black)
kp = Vector((1.55, -1.46, -1.98)); u, v, n = basis(A)
box(kp, (1.32, .48, .19), dark, A)
for row in range(3):
    for col in range(5):
        c = kp + u * (-.43 + col * .18) + v * (-.13 + row * .13) + n * .11
        box(c, (.135, .088, .045), alloy if col == 4 else black, A)
        if row == 2 and col in [0, 4]: box(c + n * .026, (.085, .04, .007), warm, A)
for x in [-.91, .91, -2.32, 2.32]:
    for i in range(5):
        c = Vector((x, -.68 - i * .145, -2.45 + i * .10))
        box(c, (.11, .1, .07), black, A)
        box(c + Vector((0, .015, .04)), (.06, .04, .014), warm if i % 3 != 2 else alloy, A)
for x in [-2.02, -1.79, -1.56, -1.33, -1.1]:
    c = Vector((x, -1.7, -1.69))
    box(c, (.16, .22, .10), dark, A)
    tube(c + Vector((0, .03, .05)), c + Vector((0, .10, .14)), .018, alloy)
box((-.7, -1.5, -1.55), (.14, .23, .07), red, A)
transform_since(dash_mark, lambda p: Vector((p.x * 1.12, p.y - 1.16, p.z + .20)))

box((0, -2.18, -2.63), (5.15, 1.6, .16), dark, A)
box((0, -2.1, -3.18), (5.2, .25, .42), steel)
for s in [-1, 1]:
    for z in [-2.7, -2, -1.3, -.6]:
        box((s * 2.57, -1.30, z), (.5, .045, .45), steel)
        for k in range(6): box((s * (2.38 + k * .065), -1.27, z), (.025, .018, .25), black)
    box((s * 2.7, -1.68, -.5), (.7, .55, 4.2), dark)
    for z in [-2, -1.35, -.7, 0, .7]:
        box((s * 2.67, -1.37, z), (.64, .075, .5), steel)
    box((s * 2.5, -1.39, -3.24), (.31, .11, .15), black)
    box((s * 2.5, -1.35, -3.14), (.22, .047, .013), warm)
    for z in [-2.8, -2.4, -2.0, -1.6]:
        box((s * 2.98, -1.86, z), (.13, .09, .19), dark)
        box((s * 2.98, -1.8, z), (.075, .018, .1), warm if z == -2.4 else black)
    for j in range(5):
        z = -2.9 + j * .55
        box((s * 2.67, -1.28, z), (.38, .035, .43), dark)
        box((s * 2.67, -1.253, z), (.33, .018, .38), steel)
        box((s * 2.67, -1.237, z), (.20, .014, .10), black)
sections = [(-2.35, -1.56, -2.98), (-1.75, -1.50, -3.18), (-.9, -1.45, -3.29), (0, -1.43, -3.32), (.9, -1.45, -3.29), (1.75, -1.50, -3.18), (2.35, -1.56, -2.98)]
for a, b in zip(sections, sections[1:]):
    poly([a, b, (b[0], b[1] - .24, b[2] + .36), (a[0], a[1] - .24, a[2] + .36)], dark)
    poly([(a[0], a[1] - .24, a[2] + .36), (b[0], b[1] - .24, b[2] + .36), (b[0], b[1] - .39, b[2] + .33), (a[0], a[1] - .39, a[2] + .33)], steel)
curve_path(sections, .065, black)
curve_path([(x, y - .24, z + .36) for x, y, z in sections], .028, alloy)
for x in [-1.65, 1.65]:
    box((x, -1.55, -3.12), (.78, .025, .19), black)
    for k in range(13): box((x - .34 + k * .056, -1.534, -3.12), (.012, .013, .16), dark)
for s in [-1, 1]:
    for i in range(4):
        x = s * (.36 + i * .49)
        box((x, -2.24, -1.08), (.44, .035, .38), steel)
        box((x, -2.21, -1.08), (.32, .018, .25), dark)
    for j in range(2):
        c = Vector((s * (1.25 + j * .42), -2.50, -.85))
        tube(c, c + Vector((0, .10, .10)), .095, alloy, 20)
        tube(c + Vector((0, .08, .08)), c + Vector((0, .19, .19)), .071, black, 16)
        box(c + Vector((0, .2, .2)), (.012, .017, .033), ochre)

R = Matrix.Rotation(COURIER_PITCH, 3, 'X')
DOWN = Matrix.Rotation(-.07, 3, 'X')
transform_since(dash_mark, lambda p: DOWN @ ((R @ (p - COURIER_EYE)) * DASH_SCALE))

# ---------------------------------------------------------------- bridge lining
# The Longwall B bridge (longwall-miner/build_model.py): four rows, eight facets each;
# side walls j=1,5 glazed in all three segments, the roof j=7 glazed in the front one.
rows_study = [(16.2, 2.2, 6.5), (19.2, 2.2, 6.5), (22, 2.0, 6.2), (24.2, 1.8, 4.8)]
LINE = .11
def row(z, w, top, inset=0):
    w2 = w - inset; t2 = top - inset; f = 3.65 + inset
    return [P(x, y, z) for x, y in [(-w2 * .85, t2), (-w2, t2 - .35), (-w2, 3.9 + inset * .5), (-w2 * .85, f), (w2 * .85, f), (w2, 3.9 + inset * .5), (w2, t2 - .35), (w2 * .85, t2)]]
outer = [row(*r) for r in rows_study]
inner = [row(*r, inset=LINE) for r in rows_study]
GLAZED = lambda j, seg: (j in [1, 5] and seg in [0, 1, 2]) or (j == 7 and seg == 2)
OPENINGS = []
for seg in range(3):
    for j in range(8):
        k = (j + 1) % 8
        o = [outer[seg][j], outer[seg][k], outer[seg + 1][k], outer[seg + 1][j]]
        q = [inner[seg][j], inner[seg][k], inner[seg + 1][k], inner[seg + 1][j]]
        if not GLAZED(j, seg):
            poly(list(reversed(q)), lining if j not in [2, 3, 4] else dark)
            if j not in [3]:
                cq = sum(q, Vector()) / 4; nq = (q[1] - q[0]).cross(q[3] - q[0]).normalized()
                if nq.dot(cq) > 0: nq = -nq
                pl = [cq + (p - cq) * .84 + nq * .025 for p in q]
                poly(list(reversed(pl)), steel)
                for a in range(4):
                    b = (a + 1) % 4; poly([q[a] + (pl[a] - q[a]) * .9 - nq * .02, q[b] + (pl[b] - q[b]) * .9 - nq * .02, pl[b], pl[a]], dark)
                for p in pl: tube(cq + (p - cq) * .92, cq + (p - cq) * .92 + nq * .02, .018, alloy, 8)
            continue
        c = sum(o, Vector()) / 4
        glass = [c + (p - c) * .74 for p in o]
        n = (o[1] - o[0]).cross(o[3] - o[0]).normalized()
        if n.dot(c) < 0: n = -n
        cq = sum(q, Vector()) / 4
        reveal = [cq + (p - cq) * .74 for p in q]
        OPENINGS.append((j, seg, glass, reveal, n))
        for a in range(4):
            b = (a + 1) % 4
            poly([q[b], q[a], reveal[a], reveal[b]], lining)
            out = [g + n * .17 for g in glass]
            poly([reveal[b], reveal[a], out[a], out[b]], steel)
        # A raised chamfered trim stands proud of the lining round each pane.
        trim = [cq + (p - cq) * .80 for p in q]
        for a in range(4):
            b = (a + 1) % 4
            lift = -n * .045
            poly([trim[a] + lift, trim[b] + lift, reveal[b] + lift * .4, reveal[a] + lift * .4], alloy)
            poly([trim[b], trim[a], trim[a] + lift, trim[b] + lift], dark)
        if j == 7:
            # The windscreen mullion: the exterior's centre bar, carried through inside.
            m0 = glass[0].lerp(glass[1], .5); m1 = glass[3].lerp(glass[2], .5)
            r0 = reveal[0].lerp(reveal[1], .5); r1 = reveal[3].lerp(reveal[2], .5)
            for t in [0, 1]:
                pass
            tube(m0.lerp(r0, .5), m1.lerp(r1, .5), .07, steel, 12)
            tube(r0 - n * .03, r1 - n * .03, .035, alloy, 8)
poly(list(inner[0]), lining)
poly(list(reversed(inner[-1])), dark)

# Floor plates and the pilot seat behind the eye.
for x in [-2.0, -1.2, -.4, .4, 1.1]:
    for z in [-3.2, -2.4, -1.6, -.8, 0, .8, 1.6, 2.4, 3.2]:
        if x > 1.0 and z < -2.5: continue
        box((x, -1.54, z), (.74, .03, .74), steel)
box((0, -1.08, .55), (.62, .16, .62), black)
box((0, -.45, .92), (.62, .92, .16), black)
tube((0, -1.52, .55), (0, -1.16, .55), .08, alloy, 12)

# ---------------------------------------------------------------- overhead mining console
# Hangs from the roof frame behind the windscreen head, angled down to the eye.
head = [o for o in OPENINGS if o[0] == 7][0]
OC = Vector((0, .80, -1.72))
on = (-OC).normalized(); ou = Vector((1, 0, 0)); ov = on.cross(ou).normalized()
if ov.y < 0: ov = -ov
oframe = (ou, ov, on)
def at(x, y, z=0): return OC + ou * x + ov * y + on * z
def yawed(yaw):
    r = Matrix.Rotation(yaw, 3, ov)
    return (r @ ou, ov, r @ on)
# A shallow curved bank: each screen turns toward the eye about the console's up axis.
bank = [('survey', -.80, .72), ('ore', -.42, .26), ('drill', 0, 0), ('anchor', .42, -.26), ('lasers', .80, -.72)]
for name, x, yaw in bank:
    f = yawed(yaw); c = at(x, 0, -.02 + abs(yaw) * .22)
    def sp(a, b, d=0, f=f, c=c): return c + f[0] * a + f[1] * b + f[2] * d
    box(sp(0, 0, -.07), (.43, .32, .12), dark, frame=f)
    box(sp(0, 0, -.004), (.41, .30, .02), steel, frame=f)
    box(sp(0, -.004, .012), (.375, .262, .02), black, frame=f)
    plane('screen-' + name, sp(0, -.004, .024), .335, .228, frame=f)
    bezel(sp(0, -.004, .036), .385, .275, .028, black, frame=f)
    for a in [-.19, .19]:
        for b in [-.135, .135]: tube(sp(a, b, 0), sp(a, b, .016), .011, alloy, 8)
box(at(0, .19, -.08), (2.25, .06, .2), steel, frame=oframe)
box(at(0, -.19, -.08), (2.25, .05, .18), dark, frame=oframe)
for x in [-.9, 0, .9]:
    a = at(x, .15, -.15); tube(a, Vector((a.x, .99, a.z + .05)), .03, alloy, 8)
box(Vector((0, .95, -1.62)), (2.0, .06, .3), dark)
for s in [-1, 1]:
    x = s * 1.17
    path([at(x, .13, -.06), at(x + s * .075, .13, .02), at(x + s * .075, -.15, .02), at(x, -.15, -.06)], .022, black)

# Square amber lamps on the header corners, facing the pilot (#839: discrete lamps).
for s in [-1, 1]:
    c = Vector((s * 1.2, .66, -1.95)); f = (Vector((1, 0, 0)), Vector((0, 1, 0)), (-c).normalized())
    f = (f[1].cross(f[2]).normalized(), f[2].cross(f[1].cross(f[2])).normalized(), f[2])
    box(c, (.15, .13, .06), black, frame=f)
    box(c + f[2] * .032, (.11, .09, .012), warm, frame=f)

# Ribbed hoses, two per side: from the console ends down the frame to the dash.
for k, off in enumerate([0, .11]):
    ribbed_hose([(-1.13 - off, .93, -1.56), (-1.33 - off, .78, -1.72), (-1.40 - off, .3, -1.96), (-1.38 - off, -.25, -1.96), (-1.22 - off, -.62, -1.86)], .05 - k * .008)
    ribbed_hose([(1.12 + off * .6, .93, -1.58), (1.0 + off, .74, -1.86), (.92 + off, .34, -2.22), (.88 + off, -.06, -2.5), (.84 + off, -.42, -2.42)], .05 - k * .008)
    for y in [.45, .05]:
        for s, xo, zz in [(-1, -1.40, -1.96), (1, .91, -2.25 if y > .2 else -2.5)]:
            c = Vector((xo - s * off if s < 0 else xo + off, y, zz))
            tube(c - Vector((0, .03, 0)), c + Vector((0, .03, 0)), .07 - k * .008, alloy, 12)

# D-shaped grab handles on the pillars, set off on two brackets.
for s, x, z in [(-1, -1.02, -1.95), (1, 1.18, -1.8)]:
    top = Vector((x, .40, z)); bot = Vector((x, -.08, z)); off = Vector((-s * .09, 0, .07))
    for e in [top, bot]: tube(e, e + off, .02, alloy, 8)
    curve_path([top + off, top + off * 1.15 + Vector((0, -.06, 0)), bot + off * 1.15 + Vector((0, .06, 0)), bot + off], .026, black, sides=12, steps=6)

# A glare shield fills the band between the glass sill and the dash brow.
for x0, x1 in [(-1.55, -.2), (-.2, 1.05)]:
    a0 = Vector((x0, -.31, -3.55)); a1 = Vector((x1, -.31, -3.55)); b0 = Vector((x0, -.50, -2.05)); b1 = Vector((x1, -.50, -2.05))
    poly([a0, a1, b1, b0], black)
    poly([b0, b1, b1 + Vector((0, -.07, .03)), b0 + Vector((0, -.07, .03))], steel)
curve_path([(-1.55, -.49, -2.03), (-.2, -.495, -2.02), (1.05, -.49, -2.03)], .03, black)
GD = (Vector((0, -.50, -2.05)) - Vector((0, -.31, -3.55))).normalized(); GN = Vector((1, 0, 0)).cross(GD).normalized()
if GN.y < 0: GN = -GN
gframe = (Vector((1, 0, 0)), -GD, GN)
def gp(x, t, lift=0): return Vector((x, -.31, -3.55)) + (Vector((0, -.50, -2.05)) - Vector((0, -.31, -3.55))) * t + GN * lift
for x in [-1.12, -.62, .32, .82]:
    for t in [.32, .55]:
        box(gp(x, t, .012), (.42, .16, .025), dark, frame=gframe)
        for k in range(9): box(gp(x - .18 + k * .045, t, .03), (.018, .12, .014), black, frame=gframe)
for x in [-1.4, -.2, .9]:
    box(gp(x, .43, .01), (.12, .05, .02), black, frame=gframe); box(gp(x, .43, .023), (.08, .025, .008), warm, frame=gframe)
curve_path([gp(-1.55, .02, .03), gp(-.2, .02, .035), gp(1.05, .02, .03)], .035, steel)

# Pillar lamps lower down, standing off the frame.
for s, x, z in [(-1, -1.25, -2.0), (1, 1.22, -1.85)]:
    box((x, .2, z), (.09, .14, .05), black)
    box((x, .2, z + .03), (.06, .1, .012), warm)

# Clamp anything the dash carried below the bridge floor onto it.
FLOOR = 3.65 - EYE_STUDY.y + .02
for name, (vs, fs, uvs) in BATCH.items():
    BATCH[name][0] = [(x, max(y, FLOOR), z) for x, y, z in vs]

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
        weighted = obj.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
        weighted.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=weighted.name)

for image in bpy.data.images:
    if image.source == 'FILE': image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'miner-cockpit.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT / 'miner-cockpit.glb'), export_format='GLB', export_yup=True, export_apply=True)
print('Cockpit exported', len(bpy.data.objects), 'objects', 'screens', [s[0] for s in SCREENS])
