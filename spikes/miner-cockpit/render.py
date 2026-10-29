"""Pilot-view render of the miner cockpit study inside the Longwall B exterior, against a rock face.
Blender --background spikes/miner-cockpit/miner-cockpit.blend --python spikes/miner-cockpit/render.py -- <out.png> [view]
Views: pilot (default, the game's 60 degree vertical frame at 3:2), wide, orbit.
"""
import bpy, bmesh, math, sys
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(bpy.data.filepath).resolve().parents[2]
args = sys.argv[sys.argv.index('--') + 1:]
out = args[0]; view = args[1] if len(args) > 1 else 'pilot'
sc = bpy.context.scene

# Pilot-local metres sit in Blender as (x, -z, y); the study's metres sit raw.
STUDY_TO_COCKPIT = Matrix(((-1, 0, 0, -.6), (0, 0, 1, -20.2), (0, 1, 0, -5.21), (0, 0, 0, 1)))
def B(x, y, z): return Vector((x, -z, y))

with bpy.data.libraries.load(str(ROOT / 'spikes/longwall-miner/longwall-miner.blend'), link=False) as (src, dst):
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

# Rock face ahead: a displaced slab with the miner study's asteroid albedo.
bpy.ops.mesh.primitive_grid_add(x_subdivisions=220, y_subdivisions=220, size=90)
rock = bpy.context.active_object; rock.name = 'rock-face'
rock.rotation_euler = (math.radians(90 - 8), math.radians(4), math.radians(-6))
rock.location = B(-2, -3, -17)
rm = bpy.data.materials.new('rock'); rm.use_nodes = True
nt = rm.node_tree; bsdf = nt.nodes['Principled BSDF']
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(str(ROOT / 'spikes/longwall-miner/asteroid-albedo.png'))
mapping = nt.nodes.new('ShaderNodeMapping'); mapping.inputs['Scale'].default_value = (3, 3, 3)
coord = nt.nodes.new('ShaderNodeTexCoord')
nt.links.new(coord.outputs['UV'], mapping.inputs['Vector']); nt.links.new(mapping.outputs[0], tex.inputs['Vector'])
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = .9
bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .8
nt.links.new(tex.outputs['Color'], bump.inputs['Height']); nt.links.new(bump.outputs[0], bsdf.inputs['Normal'])
rock.data.materials.append(rm)
tint = nt.nodes.new('ShaderNodeMixRGB'); tint.blend_type = 'MULTIPLY'; tint.inputs[0].default_value = 1
tint.inputs[2].default_value = (1.7, 1.25, .82, 1)
nt.links.new(tex.outputs['Color'], tint.inputs[1]); nt.links.new(tint.outputs[0], bsdf.inputs['Base Color'])
disp_tex = bpy.data.textures.new('rock-relief', 'CLOUDS'); disp_tex.noise_scale = 6; disp_tex.noise_depth = 4
mod = rock.modifiers.new('relief', 'DISPLACE'); mod.texture = disp_tex; mod.strength = 4.5; mod.texture_coords = 'LOCAL'

# Light: a hard warm sun on the rock, warm lamps inside, cool bounce from the screens.
w = sc.world or bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (.01, .022, .034, 1)
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
sun = light('SUN', 'sun', 28, rot_to=B(.45, -.55, -.7), color=(1, .84, .64), size=.02)
sun.light_linking.receiver_collection = outside
AMBER = (1, .5, .14)
for s in [-1, 1]:
    light('POINT', f'header-lamp-{s}', 4, B(s * 1.12, .62, -1.88), color=AMBER, size=.03)
    light('POINT', f'pillar-lamp-{s}', 3, B(s * 1.15, .2, -1.82), color=AMBER, size=.03)
    light('POINT', f'dash-lamp-{s}', 4, B(s * .75, -.45, -1.5), color=AMBER, size=.08)
wn = Vector((0, .84, -.54)).normalized()
for k, (dx, e) in enumerate([(-.9, 160), (.1, 160)]):
    key = light('AREA', f'window-key-{k}', e, B(*(Vector((-.6 + dx, .29, -2.9)) + wn * 1.6)), rot_to=B(*(-wn + Vector((0, -.35, .25)))), color=(.78, .88, 1))
    key.data.size = 1.6
side = light('AREA', 'side-window-key', 60, B(3.0, .1, -1.0), rot_to=B(-1, -.15, -.2), color=(.8, .9, 1)); side.data.size = 2.0
light('POINT', 'overhead-spill', 4, B(0, .5, -1.45), color=(.4, .85, 1), size=.5)
light('POINT', 'dash-spill', 6, B(0, -.5, -1.45), color=(.4, .85, 1), size=.5)

cam = bpy.data.objects.new('pilot-camera', bpy.data.cameras.new('pilot-camera')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.clip_start = .03; cam.data.clip_end = 2000
cam.data.sensor_fit = 'VERTICAL'; cam.data.angle = math.radians(60)
sc.render.resolution_x, sc.render.resolution_y = 1536, 1024
if view == 'pilot':
    cam.location = (0, 0, 0); cam.rotation_euler = (math.radians(90), 0, 0)
elif view == 'wide':
    cam.location = (0, 0, 0); cam.rotation_euler = (math.radians(90), 0, 0); cam.data.angle = math.radians(90)
else:
    cam.location = B(5, 4, 6); cam.rotation_euler = (B(0, -.5, -1.5) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    for o in hull.objects: o.hide_render = True
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
sc.view_settings.view_transform = 'AgX'; sc.view_settings.exposure = .6
try:
    sc.eevee.use_shadows = True; sc.eevee.use_raytracing = True
except Exception: pass
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out)
