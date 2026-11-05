# Node #920 drill prototype (principal, D-D7..D-D10): two small Mining Laser
# mounts on Longwall B's forebody shoulders, port and starboard, for hardpoints
# h2 and h3. This script imports the study export, adds the mounts, exports
# them alone as longwall-mounts.glb in the export's own frame (metres, +Z
# forward, Y up), writes their muzzle tips to mounts.json, and renders the
# miner before and after from the front and side. Node #1147 grafts the result
# into the shipped model (graft-mounts.mjs, run by ../prepare-flight-asset.mjs).
#
#   Blender -b --factory-startup --python build_mounts.py -- <study.glb> <out dir>
import bpy, json, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
study, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=study)
ship = [o for o in bpy.context.scene.objects]

def g2b(x, y, z):
    return Vector((x, -z, y))

def b2g(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]

MAT = {m.name: m for m in bpy.data.materials}
SEAT = {"x": 5.3, "y": 3.4, "z": 15.2}
BASE_R, BASE_H = 0.8, 0.6
BARREL_R, BARREL_LEN = 0.22, 3.2
LIP_R, LIP_LEN = 0.3, 0.35

def cylinder(name, radius, depth, centre, along_z, mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=radius, depth=depth)
    o = bpy.context.active_object
    o.name = name
    o.location = centre
    if along_z:
        o.rotation_euler = (math.pi / 2, 0, 0)
    o.data.materials.append(MAT[mat])
    return o

made = []
muzzles = {}
for side, sx in (("port", 1.0), ("starboard", -1.0)):
    x, y, z = SEAT["x"] * sx, SEAT["y"], SEAT["z"]
    root = bpy.data.objects.new(f"longwall-mount-{side}", None)
    bpy.context.scene.collection.objects.link(root)
    base = cylinder(f"longwall-mount-{side}-base", BASE_R, BASE_H, g2b(x, y + BASE_H / 2, z), False, "service-ochre")
    axis_y = y + BASE_H + BARREL_R
    barrel = cylinder(f"longwall-mount-{side}-barrel", BARREL_R, BARREL_LEN, g2b(x, axis_y, z + BARREL_LEN / 2 - 0.4), True, "machined-alloy")
    tip_z = z + BARREL_LEN - 0.4
    lip = cylinder(f"longwall-mount-{side}-muzzle", LIP_R, LIP_LEN, g2b(x, axis_y, tip_z - LIP_LEN / 2), True, "dark-structure")
    for o in (base, barrel, lip):
        o.parent = root
    made += [root, base, barrel, lip]
    muzzles[side] = [x, axis_y, tip_z]

bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
clear = {}
for side, (x, y, z) in muzzles.items():
    hit, loc, *_ , obj, _m = bpy.context.scene.ray_cast(dg, g2b(x, y, z + 0.05), Vector((0, -1, 0)))
    clear[side] = None if not hit else {"z": b2g(loc)[2], "object": obj.name}

def render(path, view, hide_mounts):
    for o in made:
        o.hide_render = hide_mounts
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x, scene.render.resolution_y = 1400, 900
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    eye, target, scale = {
        "front": (g2b(0, 1, 140), g2b(0, 1, 0), 40),
        "side": (g2b(140, 1, -4.8), g2b(0, 1, -4.8), 95),
        "quarter": (g2b(70, 60, 90), g2b(0, 2, 12), 48),
        "detail": (g2b(40, 30, 50), g2b(0, 3.5, 16), 18),
    }[view]
    cam.location = eye
    cam.rotation_euler = (target - eye).to_track_quat("-Z", "Z").to_euler()
    cam_data.ortho_scale = scale
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)

for view in ("front", "side", "quarter", "detail"):
    render(f"{out}/before-{view}.png", view, True)
    render(f"{out}/after-{view}.png", view, False)

bpy.ops.object.select_all(action="DESELECT")
for o in made:
    o.hide_render = False
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=f"{out}/longwall-mounts.glb", use_selection=True, export_format="GLB", export_apply=True, export_image_format="NONE")
with open(f"{out}/mounts.json", "w") as f:
    json.dump({"frame": "Longwall export: metres, +Z forward, Y up", "muzzles": muzzles, "forwardHit": clear}, f, indent=2)
print("MOUNTS", json.dumps({"muzzles": muzzles, "forwardHit": clear}))
