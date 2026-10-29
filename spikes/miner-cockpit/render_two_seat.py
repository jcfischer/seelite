"""Two-seat bridge render (#1143): the cockpit study inside the V2-glazed Longwall B, against a rock face.
Blender --background spikes/miner-cockpit/miner-cockpit-2seat.blend --python spikes/miner-cockpit/render_two_seat.py -- <out.png> [view]
Views: target (centre line behind the seats, the concept frame) or pilot (left seat eye, the game frame).
"""
import bpy, bmesh, math, sys
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(bpy.data.filepath).resolve().parents[2]
args = sys.argv[sys.argv.index('--') + 1:]
out = args[0]; view = args[1] if len(args) > 1 else 'pilot'
sc = bpy.context.scene

# Pilot-local metres sit in Blender as (x, -z, y); the study's metres sit raw.
STUDY_TO_COCKPIT = Matrix(((-1, 0, 0, .6), (0, 0, 1, -20.2), (0, 1, 0, -5.21), (0, 0, 0, 1)))
def B(x, y, z): return Vector((x, -z, y))

with bpy.data.libraries.load(str(ROOT / 'spikes/miner-cockpit/longwall-miner-v2.blend'), link=False) as (src, dst):
    dst.objects = list(src.objects)
hull = bpy.data.collections.new('longwall-exterior'); sc.collection.children.link(hull)
rows = [(16.2, 2.2, 6.5), (19.2, 2.2, 6.5), (22, 2.0, 6.2), (24.2, 1.8, 4.8)]
def inside_bridge(v):
    if not (16.35 < v.z < 24.05): return False
    for (z0, w0, t0), (z1, w1, t1) in zip(rows, rows[1:]):
        if z0 <= v.z <= z1:
            f = (v.z - z0) / (z1 - z0); w = w0 + (w1 - w0) * f; t = t0 + (t1 - t0) * f
            return abs(v.x) < w - .12 and 3.78 < v.y < t - .12
    return False
for o in dst.objects:
    if o is None: continue
    hull.objects.link(o)
    if o.type != 'MESH': continue
    if o.name.endswith('cyan-display'): o.hide_render = True; continue
    bm = bmesh.new(); bm.from_mesh(o.data)
    mw = o.matrix_world
    doomed = [f for f in bm.faces if all(inside_bridge(mw @ v.co) for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context='FACES'); bm.to_mesh(o.data); bm.free()
for o in dst.objects:
    if o is not None and o.parent is None: o.matrix_world = STUDY_TO_COCKPIT @ o.matrix_world
glass = bpy.data.materials.get('canopy-glass')
if glass:
    p = glass.node_tree.nodes.get('Principled BSDF')
    p.inputs['Alpha'].default_value = .12; p.inputs['Roughness'].default_value = .05
    glass.blend_method = 'BLEND' if hasattr(glass, 'blend_method') else None
    if hasattr(glass, 'surface_render_method'): glass.surface_render_method = 'BLENDED'

# Screen faces: emissive fixtures in place of the live HUD.
for o in sc.objects:
    if o.name.startswith(('screen-', 'label-')):
        name = o.name[len('screen-'):] if o.name.startswith('screen-') else o.name
        img = ROOT / f'spikes/miner-cockpit/screens/{name}.png'
        if not img.exists(): continue
        m = bpy.data.materials.new('face-' + name); m.use_nodes = True
        nt = m.node_tree; nt.nodes.clear()
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(str(img))
        em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = .9 if name.startswith('label-') else 2.4
        outn = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(tex.outputs['Color'], em.inputs['Color']); nt.links.new(em.outputs[0], outn.inputs['Surface'])
        o.data.materials.clear(); o.data.materials.append(m)

# Rock face ahead: the game's own fractured-block asteroid (src/models/asteroids.glb), scaled up so
# its face fills the glass, its baked albedo warmed toward sandstone.
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'src/models/asteroids.glb'))
imported = [o for o in bpy.data.objects if o not in before]
rock = next(o for o in imported if o.name.startswith('rock_00_fractured-block_L0'))
for o in imported:
    if o is not rock: bpy.data.objects.remove(o, do_unlink=True)
rock.name = 'rock-face'; rock.parent = None
rock.scale = (60, 60, 60); rock.rotation_euler = (math.radians(15), math.radians(25), math.radians(40))
rock.location = B(-1, -8, -62)
for f in rock.data.polygons: f.use_smooth = True
for m in rock.data.materials:
    nt = m.node_tree; bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    src_link = next((l for l in nt.links if l.to_socket == bsdf.inputs['Base Color']), None)
    tint = nt.nodes.new('ShaderNodeMixRGB'); tint.blend_type = 'MULTIPLY'; tint.inputs[0].default_value = 1
    tint.inputs[2].default_value = (2.3, 1.45, .62, 1)
    if src_link:
        nt.links.new(src_link.from_socket, tint.inputs[1])
    else:
        tint.inputs[1].default_value = bsdf.inputs['Base Color'].default_value
    nt.links.new(tint.outputs[0], bsdf.inputs['Base Color'])
if rock.name not in sc.collection.objects: sc.collection.objects.link(rock)
for c in list(rock.users_collection):
    if c is not sc.collection: c.objects.unlink(rock)

# Light: a hard warm sun on the rock, warm lamps inside, cool bounce from the screens.
w = sc.world or bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (.004, .005, .007, 1)
def light(kind, name, energy, loc=None, rot_to=None, color=(1, 1, 1), size=None):
    l = bpy.data.lights.new(name, kind); l.energy = energy; l.color = color
    if size is not None: l.shadow_soft_size = size
    o = bpy.data.objects.new(name, l); sc.collection.objects.link(o)
    if loc: o.location = loc
    if rot_to: o.rotation_euler = Vector(rot_to).to_track_quat('-Z', 'Y').to_euler()
    return o
outside = bpy.data.collections.new('sunlit-outside'); sc.collection.children.link(outside)
outside.objects.link(rock)
for o in hull.objects: outside.objects.link(o)
sun = light('SUN', 'sun', 22, rot_to=B(.9, -.45, -.25), color=(1, .8, .52), size=.02)
sun.light_linking.receiver_collection = outside
sun.data.use_shadow = True
fill_sun = light('SUN', 'rock-fill', 5, rot_to=B(-.3, -.3, -1), color=(1, .85, .65), size=.1)
fill_sun.light_linking.receiver_collection = outside
fill_sun.data.use_shadow = False
cabin = bpy.data.collections.new('cabin'); sc.collection.children.link(cabin)
for o in list(sc.collection.objects):
    if o.type == 'MESH' and o.name != 'rock-face': cabin.objects.link(o)
inner_sun = light('SUN', 'cabin-sun', 24, rot_to=B(.35, -.62, .7), color=(1, .82, .58), size=.03)
inner_sun.light_linking.receiver_collection = cabin
AMBER = (1, .5, .14)
for p in [(-1.0, .45, -1.85), (2.2, .45, -1.85), (-.85, -.3, -2.5), (2.05, -.3, -2.5)]:
    light('POINT', f'pillar-lamp-{p[0]}-{p[1]}', 4, B(*p), color=AMBER, size=.04)
wn = Vector((0, .84, -.54)).normalized()
for k, dx in enumerate([-.6, .6]):
    key = light('AREA', f'window-key-{k}', 170, B(*(Vector((.6 + dx, .29, -2.9)) + wn * 1.6)), rot_to=B(*(-wn + Vector((0, -.35, .25)))), color=(1, .9, .78))
    key.data.size = 1.8
chin = light('AREA', 'chin-key', 25, B(.6, -1.0, -5.5), rot_to=B(0, .35, 1), color=(1, .88, .72)); chin.data.size = 2.0
for sx, d in [(-1.9, 1), (3.1, -1)]:
    side = light('AREA', f'side-window-key-{sx}', 80, B(sx + d * -1.2, .1, -.5), rot_to=B(d, -.15, -.1), color=(1, .9, .8)); side.data.size = 2.4
light('AREA', 'cabin-fill', 90, B(.6, .9, .3), rot_to=B(0, -1, -.3), color=(1, .9, .8)).data.size = 2.5
light('AREA', 'floor-bounce', 80, B(.6, -1.1, -.6), rot_to=B(0, 1, 0), color=(1, .85, .66)).data.size = 2.5
for x in [0, 1.2]:
    light('POINT', f'pod-spill-{x}', 5, B(x, -.35, -.85), color=(.45, .85, 1), size=.4)

cam = bpy.data.objects.new('pilot-camera', bpy.data.cameras.new('pilot-camera')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.clip_start = .03; cam.data.clip_end = 2000
cam.data.sensor_fit = 'VERTICAL'; cam.data.angle = math.radians(60)
sc.render.resolution_x, sc.render.resolution_y = 1536, 1024
if view == 'pilot':
    cam.location = (0, 0, 0); cam.rotation_euler = (math.radians(90), 0, 0)
else:
    cam.location = B(.6, .08, 1.18); cam.rotation_euler = (math.radians(90 - 6), 0, 0); cam.data.angle = math.radians(72)
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
sc.view_settings.view_transform = 'AgX'; sc.view_settings.exposure = 1.1
try:
    sc.eevee.use_shadows = True; sc.eevee.use_raytracing = True
except Exception: pass
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out)
