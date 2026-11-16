"""Upward view from each bridge eye through a Longwall study's glazing (#1143).
Blender --background <longwall blend> --python spikes/miner-cockpit/measure_canopy.py
Study frame: metres, +Z forward, +Y up. The #920 laser mounts (prototype/920-drill,
spikes/longwall-miner/mounts/build_mounts.py: seat x +-5.3, y 3.4, z 15.2) are added as boxes.
"""
import bpy, bmesh, math, json
from collections import Counter
from mathutils import Vector

sc = bpy.context.scene
for sx in (1, -1):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    me = bpy.data.meshes.new('mount'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(f'laser-mount-{"port" if sx > 0 else "starboard"}', me); sc.collection.objects.link(o)
    o.location = (5.3 * sx, 4.12, 16.4); o.scale = (1.6, 1.44, 3.6)
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
GLASS = ('bridge-glazing',)

def trace(eye, d):
    origin = eye.copy(); through = None
    for _ in range(12):
        hit, loc, n, i, obj, m = sc.ray_cast(dg, origin, d, distance=400)
        if not hit: return through, None
        if obj.name.endswith(GLASS):
            through = through or loc
            origin = loc + d * 1e-3; continue
        return through, obj.name
    return through, 'too-many'

def dirn(az, el):
    a, e = math.radians(az), math.radians(el)
    return Vector((math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)))

def survey(eye):
    open_sr = 0.0; blockers = Counter(); fwd_top = None; spans = {}
    for el in range(10, 90, 2):
        for az in range(-180, 180, 4):
            d = dirn(az, el); through, hit = trace(eye, d)
            if through is None: continue
            w = math.cos(math.radians(el)) * math.radians(2) * math.radians(4)
            if hit is None: open_sr += w
            else:
                k = hit.split('::')[-1]; blockers[k] += 1
                span = spans.setdefault(k, [999, -999, 999, -999]); span[0] = min(span[0], az); span[1] = max(span[1], az); span[2] = min(span[2], el); span[3] = max(span[3], el)
    for el in range(0, 90):
        through, hit = trace(eye, dirn(0, el))
        if through is not None and hit is None: fwd_top = el
    up = trace(eye, Vector((0, 1, 0)))
    return {'open_sky_sr_above_10deg': round(open_sr, 3), 'forward_highest_open_deg': fwd_top,
            'straight_up': 'open' if up[0] is not None and up[1] is None else f'blocked by {up[1]}' if up[0] else 'solid roof',
            'blockers_through_glass': [(k, c, {'az': spans[k][:2], 'el': spans[k][2:]}) for k, c in blockers.most_common(6)]}

out = {name: survey(Vector(eye)) for name, eye in [('pilot (left seat)', (0.6, 5.21, 20.2)), ('miner (right seat)', (-0.6, 5.21, 20.2))]}
print('CANOPY', bpy.data.filepath.split('/')[-1], json.dumps(out))
