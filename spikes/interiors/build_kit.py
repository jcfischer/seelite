"""Editable interior module library. Metres, Y inward from mounting surface, Z axial.
Blender --background --python spikes/interiors/build_kit.py
Geometry helpers adapted from approved station studies, authored by Codex.
"""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from geometry import *
import geometry as G
OUT=Path(__file__).resolve().parent
# Canonical tint roles are changed by the viewer; generated paint stays shared.
ivory[:]=[material("paint-"+str(i),(.63+i*.045,.62+i*.043,.56+i*.042),.25,.72) for i in range(3)]
accent=material("theme-accent",(.35,.49,.47),.35,.62)
light=material("neutral-light",(1,.86,.65),.05,.4,2.5,False)
screen=material("instrument-screen",(.08,.33,.39),.12,.4,.6,False)

def cb(c,size,mat=ivory[1]):plated_box(c,size,mat,step=1000)
def pipe(a,b,r=.28):pipeline(a,b,r)
def rail(a,b):
 tube(a,b,.15,alloy,8)
 a,b=Vector(a),Vector(b)
 for i in range(max(2,int((b-a).length/4))+1):
  p=a.lerp(b,i/max(2,int((b-a).length/4)));tube(p,p-Y*1.4,.12,steel,6)
def grille(c,w,d):radiator(c[0],c[1],c[2],w,d)
def lamp_at(c,w=2,d=.75):
 c=Vector(c);cb(c,(w+.7,.6,d+.5),steel);box(c+Y*.37,(w,.12,d),light)
def edge_lamps(w,d,y):
 for x in [-w/2+.8,w/2-.8]:
  for z in [-d*.36,0,d*.36]:lamp_at((x,y,z),.7,2)
def door(c,w=6,h=7):
 # Vertical rear wall-mounted airlock opening, visually closed; not a route.
 x,y,z=c;cb((x,y,z),(w+2,h+2,1.2),steel);cb((x,y,z+.7),(w,h,.25),ivory[0])
 for xx in [x-w*.26,x+w*.26]:cb((xx,y,z+.93),(w*.45,h-.3,.17),blue[1])
 box((x,y,z+1.1),(.13,h-.5,.08),black)
 for xx in [x-w*.65,x+w*.65]:box((xx,y,z+.8),(.35,h*.7,.15),light)
def control(c):
 x,y,z=c;cb((x,y,z),(3,1.8,1.3),steel);box((x,y+1,z),(2.4,.1,.85),screen)
 for xx in [-.7,0,.7]:box((x+xx,y+1.08,z+.3),(.15,.07,.13),warm)
def pad():
 cb((0,.45,0),(58,.9,90),steel)
 for x in [-19,0,19]:
  for z in [-33,-11,11,33]:cb((x,1.05,z),(18.6,.3,21.5),ivory[0])
 for x in [-27.2,27.2]:
  cb((x,1.4,0),(1.5,.4,84),accent)
  for z in [-34,34]:
   cb((x*.81,2,z),(5,3.4,7),steel);cb((x*.81,3.7,z),(4,1,4),orange)
   for k in [-1,0,1]:box((x*.81+k,4.24,z),( .5,.06,3.7),black)
 for x in [-18,18]:
  for z in [-16,16]:
   cb((x,7.5,z),(4,12,5),steel);cb((x,13.8,z),(6,1,7),orange)
   pipe((x+1.6,2,z),(x+1.6,12,z),.35)
 edge_lamps(58,90,1.4)
 for z in [-43,43]:cb((0,1.3,z),(38,.3,1),ivory[2])
 for x in [-24,24]:grille((x,1.25,0),2.7,45)
def panel():
 box((0,-.55,0),(19.8,1.1,19.8),steel)
 plate([(-9.8,0,-9.8),(9.8,0,-9.8),(9.8,0,9.8),(-9.8,0,9.8)],ivory[1],Y,.06,False)
 # Recesses and fasteners are geometry; large quiet paint faces remain.
 for x in [-9,9]:
  for z in [-9,9]:tube((x,.02,z),(x,.13,z),.17,alloy,6)
def wall_panel(kind):
 panel()
 if kind=="hatch":
  cb((0,.7,0),(11,1.4,15),steel);cb((0,1.4,0),(9,.4,13),ivory[0])
  for x in [-3.4,3.4]:
   cable([(x,1.7,-1),(x,2.2,-1),(x,2.2,1),(x,1.7,1)],.15,alloy)
 elif kind=="vent":
  cb((0,.8,0),(12,1.6,16),steel);grille((0,1.7,0),10,14)
 elif kind=="repair":
  cb((2,.45,-1),(13,.9,15),ivory[0])
  for x in [-3,7]:
   for z in [-6,4]:tube((x,.9,z),(x,1.2,z),.25,orange,6)
 else:
  for x in [-6,6]:
   box((x,.6,0),(2,1.2,20),steel)
   for z in [-8,0,8]:box((x,1.3,z),(3,.25,1.5),alloy)
def rib():
 # Extruded chamfered beam: broad angled faces catch grazing fixture light.
 prism([(-4,0,-10),(4,0,-10),(4,2.6,-10),(3,3.6,-10),(-3,3.6,-10),(-4,2.6,-10)],Z,20,steel)
 box((0,3.8,0),(5.8,.4,19.8),ivory[0])
 for z in [-8,8]:
  box((0,4.1,z),(7,.5,2),alloy)
  for x in [-2.6,2.6]:tube((x,4.3,z),(x,4.5,z),.3,steel,6)
 for x in [-3.6,3.6]:box((x,3.85,0),(.3,.3,14),accent)
 for z in [-6,0,6]:
  for sign in [-1,1]:
   prism([(sign*4.05,.3,z-.4),(sign*4.05,2.5,z-.4),(sign*2.8,3.7,z-.4),(sign*2.4,3.7,z-.4),(sign*3.5,.3,z-.4)],Z,.8,alloy)
def trunk():
 box((0,1,0),(12,2,20),steel)
 for x,r in [(-4,.4),(-2,.65),(1,.75),(4,.3)]:tube((x,2+r,-10),(x,2+r,10),r,alloy,10)
 for z in [-8,0,8]:box((0,4,z),(11,.5,.6),steel)
 for z in [-5,5]:
  box((0,4.4,z),(3,.6,4),steel);box((0,4.8,z),(2.5,.2,3.4),light)
def command():
 cb((0,1,0),(36,2,28),steel)
 # Faceted gallery with visible consoles behind a framed panoramic window.
 cb((0,7,-7),(32,12,9),ivory[1])
 cb((0,15,0),(34,2,24),ivory[1]);cb((0,3,5),(33,4,12),ivory[0])
 for x in [-16,16]:cb((x,9,3),(2,10,18),steel)
 # Dark backing, individual console pedestals and luminous screen faces.
 box((0,9,-2),(29,9,.3),black)
 for x in [-11,-5,1,7,12]:control((x,6,4))
 for x in [-13,-6.5,0,6.5,13]:
  cb((x,10,10),( .55,8,1),steel)
  # Recessed clear glazing exposes illuminated control desks.
  box((x+2.8,10,10.1),(5,6.5,.1),glass)
 for y in [6,14]:cb((0,y,10),(32,.65,1.2),alloy)
 for x in [-12,0,12]:lamp_at((x,16.2,1),3,1)
 for x in [-17,17]:pipe((x,2,-10),(x,13,-10),.4)
 door((0,7,-11.8),6,7)
 grille((0,16.2,-6),18,5)
 for x in [-15,15]:rail((x,3,12),(x,3,-12))
def container(c,w=8,d=14,h=7):
 x,y,z=c;cb(c,(w,h,d),accent)
 for xx in [-w*.45,w*.45]:cb((x+xx,y,z),( .5,h+.3,d+.2),steel)
 for zz in [-d*.45,d*.45]:cb((x,y,z+zz),(w+.3,h+.3,.5),steel)
 for zz in [-d*.25,0,d*.25]:cb((x,y+h/2+.13,z+zz),(w-.3,.2,.35),alloy)
 for xx in [-w*.2,w*.2]:pipe((x+xx,y-h*.3,z+d*.51),(x+xx,y+h*.3,z+d*.51),.12)
def loading():
 cb((0,1,0),(40,2,48),steel)
 for x in [-9,9]:
  for z in [-12,6]:container((x,5.6,z),15,16,7)
 # Cargo lift and roller-transfer frontage, remains retracted.
 cb((0,2,20),(32,2,7),alloy)
 for x in range(-14,15,2):tube((x,3,17),(x,3,23),.5,steel,8)
 for x in [-18,18]:
  cb((x,9,-20),(2,18,3),steel);cb((x,9,-18),(1,17,.6),orange)
 cb((0,18,-20),(38,2,3),steel)
 for x in [-12,0,12]:lamp_at((x,19.2,-20),2,1)
 edge_lamps(40,48,2)
def gangway():
 # A complete 100 m wall-hugging run with 1.4 m rails and mounting brackets.
 cb((0,3,0),(7,1,100),steel)
 for z in range(-48,49,4):box((0,3.6,z),(6.3,.18,2.8),alloy)
 for x in [-3.1,3.1]:
  rail((x,5.2,-49),(x,5.2,49))
  for z in [-42,-21,0,21,42]:cb((x,1.5,z),(.5,3,1.7),steel);lamp_at((x,3.6,z),.3,.6)
 cb((0,3.7,0),(1,.15,97),accent)
def utility():
 cb((0,5,0),(14,10,32),steel)
 for z in [-10,0,10]:
  cb((0,6,z),(12,10,8),ivory[0]);grille((0,11.15,z),9,6)
 for x in [-5,5]:pipe((x,12,-14),(x,12,14),.45)
 for z in [-12,12]:lamp_at((0,12,z),2,1)
def crane():
 cb((0,1,0),(24,2,40),steel)
 for x in [-9,9]:
  cb((x,2,0),(2,2,38),alloy)
  cb((x,12,9),(4,20,5),orange)
  tube((x,9,7),(x,24,-4),1.6,steel,8)
  tube((x,24,-4),(x,28,-13),1.2,orange,8)
  pipe((x+1,11,7),(x+1,23,-4),.32)
 cb((0,28,-13),(21,2,3),steel)
 cb((0,29,-13),(5,3,5),orange)
 for x in [-8,8]:lamp_at((x,29,-13),2,1)
def airlock():
 cb((0,1,0),(18,2,24),steel);cb((0,4,-5),(16,7,12),ivory[1]);door((0,4.5,1.3),7,5)
 for x in [-7,7]:pipe((x,2,-10),(x,8,-10),.35)
 for x in [-5,5]:lamp_at((x,8,-4),2,1)

def service(style):
 # Thirty-metre interchangeable equipment rack; all projections stay under 9 m.
 box((0,.5,0),(30,1,20),black)
 for x in [-14,14]:cb((x,2,0),(2,4,20),steel)
 for z in [-9,9]:cb((0,2,z),(28,4,2),steel)
 for x in [-11,11]:
  tube((x,4,-10),(x,4,10),.65,orange if style=="works" else alloy,10)
  for z in [-7,7]:box((x,4,z),(2,1.6,1),steel)
 if style=="civic":
  for x in [-6,6]:
   cb((x,3.5,0),(9,5,14),ivory[1]);grille((x,6.1,0),6,10)
   cb((x,6.4,-5),(8,.5,1.5),accent)
  lamp_at((0,4,0),2,8)
 elif style=="works":
  for x in [-5,5]:
   tube((x,4,-7),(x,4,7),3,alloy,16)
   for z in [-6,6]:
    tube((x,4,z-.4),(x,4,z+.4),3.35,orange,16)
    box((x,1.5,z),(7,2,2),steel)
   pipe((x,7,0),(x,7,10),.4)
  for x in range(-12,13,4):box((x,4.1,-9),(1.6,.15,2),orange)
 elif style=="frontier":
  for x,z in [(-7,-3),(5,4)]:
   cb((x,2.5,z),(10,4,10),ivory[0]);grille((x,4.6,z),7,7)
  for i in range(4):
   x=-8+i*5
   cable([(x,6,-10),(x,6,-4),(x+2,7,1),(x+2,7,10)],.45,orange if i%2 else alloy)
  for x in [-12,12]:
   box((x,4,-5),(2,1,4),steel);box((x,4.6,-5),(1.4,.2,3),light)
 else:
  for x in [-7,0,7]:
   cb((x,3.5,0),(5.5,5,15),ivory[2])
   for z in [-4,3]:
    box((x,6.1,z),(4,.3,4),steel);box((x,6.3,z),(3.5,.1,3.5),screen)
    for k in [-1,0,1]:box((x+k,6.4,z+1),(.5,.1,.2),light)
  for z in [-8,8]:box((0,5,z),(22,.4,.7),accent)
 for z in [-9,9]:
  box((0,4.2,z),(8,.5,1.8),steel);box((0,4.6,z),(6,.2,1),light)

builders={"panel":panel,"rib":rib,"trunk":trunk,"berth":pad,"command":command,"loading":loading,"gangway":gangway,"utility":utility,"crane":crane,"airlock":airlock}
for theme in ["civic","works","frontier","survey"]:builders["service-"+theme]=lambda theme=theme:service(theme)
for kind in ["hatch","vent","repair","reinforced"]:builders["wall-"+kind]=lambda kind=kind:wall_panel(kind)
def export(name):
 root=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(root)
 root["author"]="Codex";root["units"]="metres";root["mount_normal"]="+Y";root["axial"]="+Z"
 for key,(verts,faces,uvs) in BATCH.items():
  mesh=bpy.data.meshes.new(key);mesh.from_pydata(verts,[],faces);mesh.materials.append(MATS[GROUP_MAT[key]]);mesh.update()
  uv=mesh.uv_layers.new(name="surface-metres")
  for face,coords in zip(mesh.polygons,uvs):
   for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=(xy[0]*.35,xy[1]*.35)
  bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
  ob=bpy.data.objects.new(key,mesh);bpy.context.collection.objects.link(ob);ob.parent=root
  if "/cladding-" in key:
   mod=ob.modifiers.new("edge-highlight","BEVEL");mod.width=.06;mod.segments=1
   mod=ob.modifiers.new("weighted-normals","WEIGHTED_NORMAL");mod.keep_sharp=True
 bpy.context.preferences.filepaths.save_version=0;bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"modules"/(name+".blend")))
 p=OUT/"modules"/(name+".glb");bpy.ops.export_scene.gltf(filepath=str(p),export_format="GLB",export_yup=False,export_apply=True,export_materials="EXPORT",export_extras=True)
 data=p.read_bytes();jl=struct.unpack_from("<I",data,12)[0];doc=json.loads(data[20:20+jl])
 for m in doc["materials"]:
  if "baseColorTexture" in m.get("pbrMetallicRoughness",{}):m["pbrMetallicRoughness"]["baseColorFactor"]=list(MATS[m["name"]].diffuse_color)
 enc=json.dumps(doc,separators=(",",":")).encode();enc+=b" "*((-len(enc))%4);tail=data[20+jl:]
 p.write_bytes(struct.pack("<4sII",b"glTF",2,20+len(enc)+len(tail))+struct.pack("<II",len(enc),0x4E4F534A)+enc+tail)
 print("EXPORTED",name,p.stat().st_size,flush=True)
(OUT/"modules").mkdir(exist_ok=True)
wanted=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
for name,fn in builders.items():
 if wanted and name not in wanted:continue
 bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False);BATCH.clear();GROUP_MAT.clear();random.seed(205)
 print("BUILD",name,flush=True);fn();export(name)
