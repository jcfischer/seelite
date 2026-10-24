"""Blender source for node #1057. Reference author units are 10 m; export km."""
from pathlib import Path
import sys, runpy, json, struct, math, random
import bpy, bmesh
from mathutils import Vector
HERE = Path(__file__).resolve().parent
sys.argv = [str(HERE.parent / "build_model.py"), "--", "kit-only"]
S = runpy.run_path(sys.argv[0])
poly, tube, box, plate, machinery, edge_trunk, window_band, vent = (
 S[k] for k in ("poly", "tube", "box", "plate", "machinery", "edge_trunk", "window_band", "vent")
)
steel, ivory, alloy, orange, warm, white, cyan, MATS = (
 S[k] for k in ("steel", "ivory", "alloy", "orange", "warm", "white", "cyan", "MATS")
)
X, Y, Z = (S[k] for k in ("X", "Y", "Z"))
import geometry as G
G.BATCH.clear()
G.GROUP_MAT.clear()
random.seed(1057)
for mat in [warm, white, cyan]:
 p = MATS[mat].node_tree.nodes.get("Principled BSDF")
 p.inputs["Emission Strength"].default_value = 0.15


def owner(name):
 G.OWNER = name


def band(axis, at, radius, minor, mat):
 axis = Vector(axis).normalized()
 u = axis.cross(Y if abs(axis.y) < .9 else X).normalized()
 v = axis.cross(u)
 def point(i, j):
  a = i * math.tau / 24
  b = j * math.tau / 4
  return axis * (at + minor * math.cos(b)) + (radius + minor * math.sin(b)) * (u * math.cos(a) + v * math.sin(a))
 for i in range(24):
  for j in range(4):
   poly([point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)], mat)


def socket(axis, start, end=10, radius=3.84):
 axis = Vector(axis)
 tube(axis * start, axis * end, radius, steel, 12)
 for t in [end - .7, end - .2]:
  band(axis, t, radius + .2, .2, alloy)
 u = axis.cross(Z).normalized()
 v = axis.cross(u)
 for k in range(8):
  n = u * math.cos(k * math.pi / 4) + v * math.sin(k * math.pi / 4)
  c = axis * (end - .6) + n * (radius + .1)
  box(c, (.3, .3, .5), orange, (u, v, axis))


def shell(axis, rows, sides=12):
 axis = Vector(axis)
 u = axis.cross(Y if abs(axis.y) < .9 else X).normalized()
 v = axis.cross(u)
 for (at, r), (bt, rr) in zip(rows, rows[1:]):
  for i in range(sides):
   a, b = i * math.tau / sides, (i + 1) * math.tau / sides
   points = [axis * t + rad * (u * math.cos(q) + v * math.sin(q)) for t, rad, q in [(at, r, a), (at, r, b), (bt, rr, b), (bt, rr, a)]]
   n = u * math.cos((a + b) / 2) + v * math.sin((a + b) / 2)
   poly(points, steel)
   plate(points, ivory[(i + round(at)) % 4], n, .10)


owner("TUBE")
shell(X, [(-9.1, 3.84), (-8.4, 4.8), (-5.6, 4.8), (-2.8, 4.8), (0, 4.8), (2.8, 4.8), (5.6, 4.8), (8.4, 4.8), (9.1, 3.84)])
for sign in [-1, 1]:
 socket(X * sign, 9.1)
for t in [-8.2, -7.6, 7.6, 8.2]:
 band(X, t, 4.8, .21, steel)
for i in range(12):
 a = (i + .5) * math.tau / 12
 n = Vector((0, math.cos(a), math.sin(a)))
 tangent = X.cross(n)
 if i % 3 == 0:
  edge_trunk(X * -7.2 + n * 4.72, X * 7.2 + n * 4.72, n, .8)
  for t in [-5, 0, 5]: window_band(X * t + n * 5.1, 1.3, .20, n, X)
 else:
  machinery(n * 4.74 + X * (-3 if i % 2 else 3), 2.5, 1.8, n, X, i)
  for t in [-6.8, 6.8]:
   box(X * t + n * 4.83, (.5, 2, .12), orange, (X, tangent, n))

owner("NODE")
shell(Z, [(-5.6, 5.3), (-4.8, 6), (0, 6), (4.8, 6), (5.6, 5.3)])
for axis in [X, -X, Y, -Y]: socket(axis, 4.4)
for sign in [-1, 1]:
 n = Z * sign
 tube(n * 5.5, n * 5.6, 5.3, steel, 12)
 band(Z, sign * 5.2, 5.9, .3, steel)
 for i in range(8):
  a = i * math.tau / 8
  b = (i + 1) * math.tau / 8
  plate([n * 5.63 + Vector((r * math.cos(q), r * math.sin(q), 0)) for r, q in [(2.6, a), (5.2, a), (5.2, b), (2.6, b)]], ivory[i % 4], n, .10)
 machinery(n * 5.8, 3.9, 3.9, n, X, 0)
 for x in [-3.6, 3.6]: window_band(n * 5.84 + X * x, 1, .2, n, Y)
 for y in [-3.5, 3.5]: edge_trunk(X * -2.6 + Y * y + n * 5.8, X * 2.6 + Y * y + n * 5.8, n, .7)

owner("HUB")
profile = [(-18, 15.912), (-12, 20.4), (36, 20.4), (42.8, 18.768)]
rows = [profile[0], profile[1]] + [(t, 20.4) for t in [-4, 4, 12, 20, 28, 36]] + [profile[-1]]
shell(Z, rows)
for sign, (at, radius) in [(-1, profile[0]), (1, profile[-1])]:
 n = Z * sign
 corners = [math.atan2(y * 3.5, x * 6) % math.tau for x in [-1, 1] for y in [-1, 1]]
 angles = sorted(set([i * math.tau / 12 for i in range(12)] + corners))
 for i, a in enumerate(angles):
  b = angles[(i + 1) % len(angles)]
  def inner(q):
   d = min(6 / max(abs(math.cos(q)), 1e-8), 3.5 / max(abs(math.sin(q)), 1e-8))
   return Vector((d * math.cos(q), d * math.sin(q), at - sign * .2))
  points = [inner(a), Vector((radius * math.cos(a), radius * math.sin(a), at - sign * .2)), Vector((radius * math.cos(b), radius * math.sin(b), at - sign * .2)), inner(b)]
  poly(points if sign == 1 else list(reversed(points)), steel)
  plate(points, ivory[i % 4], n, .08)
 for side in [-1, 1]:
  box((side * 7.7, 0, at - sign * .2), (2, 11.7, .3), steel)
  box((0, side * 5.2, at - sign * .2), (17.4, 1.8, .3), steel)
 if sign == 1:
  for side in [-1, 1]:
   for y in [-2.3, 0, 2.3]: machinery((side * 10.5, y, at + .2), 2, 1.6, Z, X, 2)
   for x in [-9, 0, 9]: vent((x, side * 11.5, at + .2), 5, 4, Z, X)
for z in [-11.5, -10.4, 33.5, 34.8]: band(Z, z, 20.1552, .3, steel)
for i in range(12):
 a = (i + .5) * math.tau / 12
 n = Vector((math.cos(a), math.sin(a), 0))
 t = Z.cross(n)
 for off in [-3.6, 3.6]: edge_trunk(n * 19.85 + t * off - Z * 8, n * 19.85 + t * off + Z * 32, n, .8)
 for j, z in enumerate([-6, 4, 14, 24, 31]):
  machinery(n * 19.9 + Z * z, 5.5, 4, n, t, i + j)
  if j % 2 == 0: window_band(n * 20.6 + Z * (z + 2.7), 4, .27, n, t)

owner("HUB_STATIC")
for axis, radius in [(X, 4.9), (-X, 4.9), (Y, 1.8), (-Y, 1.8)]:
 for t, minor, mat in [(20.5, .4, steel), (21, .2, alloy)]: band(axis, t, radius, minor, mat)

bpy.context.preferences.filepaths.save_version = 0
roots = {}
for key, (verts, faces, uvs) in G.BATCH.items():
 block, part = key.split("/", 1)
 if block not in roots:
  root = bpy.data.objects.new(block, None)
  bpy.context.collection.objects.link(root)
  root["authoring_pipeline"] = "stations/build_model.py + geometry.py"
  root["metres_per_author_unit"] = 10
  roots[block] = root
 mesh = bpy.data.meshes.new(key)
 mesh.from_pydata([tuple(Vector(v) * .01) for v in verts], [], faces)
 mesh.materials.append(MATS[G.GROUP_MAT[key]])
 mesh.update()
 uv = mesh.uv_layers.new(name="industrial-surface")
 for face, coords in zip(mesh.polygons, uvs):
  for index, xy in zip(face.loop_indices, coords): uv.data[index].uv = xy
 bm = bmesh.new()
 bm.from_mesh(mesh)
 bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-8)
 bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
 bm.to_mesh(mesh)
 bm.free()
 ob = bpy.data.objects.new(block + "-" + part, mesh)
 bpy.context.collection.objects.link(ob)
 ob.parent = roots[block]
 if part.startswith("cladding-"):
  bevel = ob.modifiers.new("plate-edge-radius", "BEVEL")
  bevel.width = .00024
  bevel.segments = 1
  bevel = ob.modifiers.new("weighted-normals", "WEIGHTED_NORMAL")
  bevel.keep_sharp = True
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "blocks.blend"))
glb = HERE / "blocks.glb"
bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", export_yup=False, export_apply=True, export_materials="EXPORT", export_extras=True)
data = glb.read_bytes()
jl = struct.unpack_from("<I", data, 12)[0]
doc = json.loads(data[20:20 + jl])
for mat in doc["materials"]:
 if "baseColorTexture" in mat.get("pbrMetallicRoughness", {}):
  mat["pbrMetallicRoughness"]["baseColorFactor"] = list(MATS[mat["name"]].diffuse_color)
binary = bytearray(data[20 + jl:])
for mesh in doc["meshes"]:
 axes = [0, 1] if mesh["name"].startswith("NODE/") else [0] if mesh["name"].startswith("TUBE/") else []
 for primitive in mesh["primitives"]:
  accessor = doc["accessors"][primitive["attributes"]["POSITION"]]
  view = doc["bufferViews"][accessor["bufferView"]]
  base = 8 + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
  stride = view.get("byteStride", 12)
  for i in range(accessor["count"]):
   for axis in axes:
    offset = base + i * stride + axis * 4
    value = struct.unpack_from("<f", binary, offset)[0]
    if abs(abs(value) - .1) < 1e-7:
     struct.pack_into("<f", binary, offset, math.copysign(.1, value))
  for bound in ["min", "max"]:
   for axis in axes:
    if abs(abs(accessor[bound][axis]) - .1) < 1e-7: accessor[bound][axis] = math.copysign(.1, accessor[bound][axis])
encoded = json.dumps(doc, separators=(",", ":")).encode()
encoded += b" " * (-len(encoded) % 4)
tail = binary
glb.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(encoded) + len(tail)) + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + tail)
print("EXPORTED Blender Assembly kit", glb.stat().st_size, flush=True)
