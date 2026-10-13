"""Blender-only authoring/baking. Run blender -b --python this_file -- --count 1.

Unit bounding radius; Blender +Z becomes glTF +Y. No authoritative collision.
One atlas/material across every archetype and LOD, for the two field batches.
"""
import bpy, math, random, sys, argparse, json
from pathlib import Path
from mathutils import Vector, noise

ROOT = Path(__file__).resolve().parent
args = argparse.ArgumentParser()
args.add_argument('--count', type=int, default=16)
args.add_argument('--tile', type=int, default=2048)
opt = args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT = ROOT / 'runtime'
OUT.mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 8
scene.render.bake.margin = 8
scene.render.bake.use_clear = False
scene.render.bake.use_pass_direct = False
scene.render.bake.use_pass_indirect = False
scene.render.bake.use_pass_color = True
grid = 1
size = opt.tile
albedo = bpy.data.images.new('RockAtlasAlbedo', width=size, height=size, alpha=False)
normal = bpy.data.images.new('RockAtlasNormal', width=size, height=size, alpha=False)
normal.colorspace_settings.name = 'Non-Color'
ref = bpy.data.images.load(str(ROOT / 'source/rock-albedo-reference.png'))

PROFILES = [
 ('fractured-block',(1,.85,.78),0), ('long-wedge',(1,.52,.46),1),
 ('flat-slab',(1,.82,.30),2), ('contact-binary',(1,.56,.57),3),
 ('angular-shard',(1,.38,.32),4), ('stepped-strata',(.82,.72,1),5),
 ('impact-basin',(1,.92,.66),6), ('rubble-block',(.87,1,.82),7),
 ('cleaved-keel',(1,.49,.75),8), ('crooked-tooth',(.56,.63,1),9),
 ('broken-disc',(1,.96,.32),10), ('three-lobed',(1,.89,.62),11),
 ('split-spine',(.48,.53,1),12), ('saddle',(1,.69,.54),13),
 ('battered-pyramid',(.84,.80,1),14), ('offset-boulder',(1,.87,.84),15),
]

def material(i):
 m=bpy.data.materials.new('BakeSource-%02d'%i); m.use_nodes=True
 n=m.node_tree.nodes; l=m.node_tree.links; p=n.get('Principled BSDF')
 p.inputs['Roughness'].default_value=.94
 coord=n.new('ShaderNodeTexCoord')
 tex=n.new('ShaderNodeTexImage'); tex.image=ref; tex.projection='BOX'; tex.projection_blend=.22
 mapping=n.new('ShaderNodeVectorMath'); mapping.operation='SCALE'; mapping.inputs[3].default_value=1.7
 l.new(coord.outputs['Generated'],mapping.inputs[0]); l.new(mapping.outputs[0],tex.inputs['Vector'])
 l.new(tex.outputs['Color'],p.inputs['Base Color'])
 bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.55; bump.inputs['Distance'].default_value=.018
 l.new(tex.outputs['Color'],bump.inputs['Height']); l.new(bump.outputs['Normal'],p.inputs['Normal'])
 target=n.new('ShaderNodeTexImage'); n.active=target
 return m,target

def rock(i):
 name,scale,kind=PROFILES[i]; rng=random.Random(953+i*119)
 # Irregular supporting fracture planes form broad facets; local depressions
 # and layered offsets break convexity without disconnected decorative stones.
 planes=[]
 for j in range(22):
  v=Vector((rng.uniform(-1,1),rng.uniform(-1,1),rng.uniform(-1,1))).normalized()
  planes.append((v,rng.uniform(.67,.98)))
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=6, radius=1)
 obj=bpy.context.object; obj.name='rock_%02d_%s_L0'%(i,name)
 for vertex in obj.data.vertices:
  d=vertex.co.normalized(); r=min([1.1]+[h/d.dot(n) for n,h in planes if d.dot(n)>.05])
  p=d*r
  # Deterministic structural channels, coarse fracture and chipped face edges.
  ridge=noise.noise_vector(p*4.3+Vector((i*7.1,2.7,4.8)))[0]
  cell=noise.voronoi(p*2.2+Vector((i*7.1,2.7,4.8)))
  gap=cell[0][1]-cell[0][0]
  # Recessed fracture boundaries between sizeable plates, not uniform bump.
  r += .012*ridge - .032*math.exp(-gap*gap/.008)
  p=d*r
  if kind in (3,11):
   p.y*=.65+.5*abs(d.x); p.z*=.69+.45*abs(d.x)
   if kind==11: p.z+=.16*math.sin(d.x*4)*math.cos(d.y*4)
  if kind in (1,4,8): p.y*=.72+.30*d.x; p.z+=.13*d.x
  if kind in (5,12): p.x+=.055*math.floor(p.z*5); p.y+=.035*math.floor(p.z*7)
  if kind in (6,10):
   basin=max(0,1-(p.x*p.x+p.y*p.y)/.44)
   if p.z>0: p.z-=.25*basin*basin
  if kind in (9,14): p.x*=.8-.3*p.z; p.y*=.8-.22*p.z
  if kind==13: p.z-=.24*max(0,1-abs(p.x)*3)
  if kind==15: p.x+=.16*p.z*p.z; p.z+=.1*math.sin(p.y*4)
  vertex.co=Vector((p.x*scale[0],p.y*scale[1],p.z*scale[2]))
 bound=max(v.co.length for v in obj.data.vertices)
 for v in obj.data.vertices: v.co/=bound
 # Keep broad planar structure while simplifying, before UV/bake.
 mod=obj.modifiers.new('Authored surface simplification','DECIMATE'); mod.ratio=.30
 bpy.ops.object.modifier_apply(modifier=mod.name)
 # Embedded chips share the parent mesh/material; no per-chip draw calls.
 candidates=[]
 for v in obj.data.vertices:
  cell=noise.voronoi(v.co*2.2+Vector((i*7.1,2.7,4.8)))
  if cell[0][1]-cell[0][0]<.12: candidates.append(v.co.copy())
 rng.shuffle(candidates)
 chips=[]
 for p in candidates[:85]:
  bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=p+p.normalized()*.009)
  chip=bpy.context.object; s=rng.uniform(.009,.022)
  chip.scale=(s,s*rng.uniform(.55,1.4),s*rng.uniform(.45,.9))
  chip.rotation_euler=(rng.random()*6,rng.random()*6,rng.random()*6)
  chips.append(chip)
 bpy.ops.object.select_all(action='DESELECT')
 for o in [obj]+chips: o.select_set(True)
 bpy.context.view_layer.objects.active=obj
 bpy.ops.object.join()
 for f in obj.data.polygons: f.use_smooth=True
 # Continuous cylindrical UVs avoid changing projection at every triangle.
 # Repeating baked tile retains close-view detail with fixed texture memory.
 while obj.data.uv_layers: obj.data.uv_layers.remove(obj.data.uv_layers[0])
 uv=obj.data.uv_layers.new(name='UVMap')
 for poly in obj.data.polygons:
  coords=[]
  for li in poly.loop_indices:
   p=obj.data.vertices[obj.data.loops[li].vertex_index].co
   coords.append((li,math.atan2(p.y,p.x)/(2*math.pi)+.5,math.asin(max(-1,min(1,p.normalized().z)))/math.pi+.5))
  seam=max(c[1] for c in coords)-min(c[1] for c in coords)>.5
  for li,u,v in coords: uv.data[li].uv=((u+(1 if seam and u<.5 else 0))*4,v*2)
 return obj

objects=[]
# Bake generated surface onto a flat canonical UV tile once. The baked maps
# are shared by every form, and keep texture memory independent of K.
bpy.ops.mesh.primitive_plane_add(size=2)
plane=bpy.context.object
mat,target=material(0); plane.data.materials.append(mat)
tex=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image==ref)
tex.projection='FLAT'
coord=next(n for n in mat.node_tree.nodes if n.type=='TEX_COORD')
mat.node_tree.links.new(coord.outputs['UV'],tex.inputs['Vector'])
target.image=albedo; bpy.ops.object.bake(type='DIFFUSE')
target.image=normal; bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT')
bpy.data.objects.remove(plane,do_unlink=True)
for i in range(opt.count):
 bpy.ops.object.select_all(action='DESELECT')
 obj=rock(i); objects.append(obj)
 print('BAKED',i,PROFILES[i][0],flush=True)
albedo.filepath_raw=str(OUT/'albedo.png'); albedo.file_format='PNG'; albedo.save()
normal.filepath_raw=str(OUT/'normal.png'); normal.file_format='PNG'; normal.save()
runtime=bpy.data.materials.new('Asteroid baked atlas'); runtime.use_nodes=True
n=runtime.node_tree.nodes; l=runtime.node_tree.links; p=n.get('Principled BSDF')
p.inputs['Roughness'].default_value=.94
a=n.new('ShaderNodeTexImage'); a.image=albedo; l.new(a.outputs['Color'],p.inputs['Base Color'])
b=n.new('ShaderNodeTexImage'); b.image=normal
nm=n.new('ShaderNodeNormalMap'); l.new(b.outputs['Color'],nm.inputs['Color']); l.new(nm.outputs['Normal'],p.inputs['Normal'])
manifest=[]
for i,obj in enumerate(objects):
 obj.data.materials.clear(); obj.data.materials.append(runtime)
 levels=[obj]
 for level,ratio in [(1,.25),(2,.065)]:
  low=obj.copy(); low.data=obj.data.copy(); scene.collection.objects.link(low)
  low.name=obj.name[:-2]+'L%d'%level
  bpy.context.view_layer.objects.active=low
  dec=low.modifiers.new('Shared UV reduction','DECIMATE'); dec.ratio=ratio
  bpy.ops.object.modifier_apply(modifier=dec.name); levels.append(low)
 bound=max(v.co.length for o in levels for v in o.data.vertices)
 for o in levels:
  for v in o.data.vertices: v.co/=bound
  o.data.validate()
  o.data.update()
 manifest.append({'index':i,'name':PROFILES[i][0],'levels':[{'name':o.name,'triangles':sum(len(p.vertices)-2 for p in o.data.polygons),'bound':max(v.co.length for v in o.data.vertices)} for o in levels]})
bpy.ops.object.select_all(action='SELECT')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'asteroids.blend'))
bpy.ops.file.make_paths_relative()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'asteroids.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'asteroids.glb'),export_format='GLB',use_selection=True,export_yup=True,export_normals=True,export_tangents=False)
(OUT/'manifest.json').write_text(json.dumps({'count':opt.count,'atlasSize':size,'archetypes':manifest},indent=2))
print('EXPORTED',OUT,flush=True)
