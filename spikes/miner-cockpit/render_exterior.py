"""Exterior review frames of a Longwall study blend: bridge front and three-quarter.
Blender --background <blend> --python spikes/miner-cockpit/render_exterior.py -- <out-prefix>
"""
import bpy, math, sys
from mathutils import Vector, Matrix
def look_at(cam, loc, target):
    z = (Vector(loc) - Vector(target)).normalized(); x = Vector((0, 1, 0)).cross(z).normalized(); y = z.cross(x)
    cam.matrix_world = Matrix((x, y, z)).transposed().to_4x4() @ Matrix.Identity(4); cam.location = loc
out = sys.argv[sys.argv.index('--') + 1]
sc = bpy.context.scene
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
sc.view_settings.view_transform = 'AgX'
w = sc.world or bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (.015, .017, .022, 1)
def add_light(kind, energy, d, color=(1, .95, .88)):
    l = bpy.data.lights.new(kind, kind); l.energy = energy; l.color = color
    o = bpy.data.objects.new(kind, l); sc.collection.objects.link(o)
    o.rotation_euler = Vector(d).to_track_quat('-Z', 'Y').to_euler()
add_light('SUN', 4.5, (-.5, -.6, -.6))
add_light('SUN', 1.2, (.6, -.2, .7), (.6, .75, 1))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y = 1536, 1024
for name, loc, look, lens in [('front', (5, 8.5, 44), (0, 4.6, 21), 50), ('three-quarter', (-30, 17, 64), (0, 3, 12), 30), ('above', (3, 36, 31), (0, 4.5, 19), 45)]:
    look_at(cam, loc, look); cam.data.lens = lens
    sc.render.filepath = f'{out}-{name}.png'
    bpy.ops.render.render(write_still=True)
