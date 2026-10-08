"""O4 courier exterior study. Blender --background --python this_file.py.
Metres, Y up, +Z forward. Material-batched authored geometry; seeded detail.
"""
import bpy, math, random, json, struct
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent
random.seed(795)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
MATS={}; BATCH={}; GROUP_MAT={}

def material(name,color,metal=.55,rough=.5,emission=0,texture=True,alpha=1):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,alpha)
 p=m.node_tree.nodes.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*color,alpha);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 p.inputs['Alpha'].default_value=alpha
 if alpha<1:m.surface_render_method='DITHERED'
 if emission:
  p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
 if texture and not emission:
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(OUT/'steel-wear.png'),check_existing=True)
  mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(*color,1)
  m.node_tree.links.new(t.outputs['Color'],mix.inputs[1]);m.node_tree.links.new(mix.outputs[0],p.inputs['Base Color'])
 MATS[name]=m;return name

blue=[material('blue-grey-'+str(i),(.19+i*.025,.235+i*.027,.27+i*.028),.5,.48) for i in range(4)]
ivory=[material('pale-steel-'+str(i),(.49+i*.035,.48+i*.036,.435+i*.035),.43,.59) for i in range(3)]
steel=material('dark-structure',(.057,.071,.077),.76,.43)
black=material('recess-black',(.012,.019,.023),.42,.62)
alloy=material('machined-alloy',(.29,.295,.27),.84,.35)
rubber=material('hose-rubber',(.023,.027,.029),.08,.78)
orange=material('service-ochre',(.55,.29,.10),.37,.58)
warm=material('amber-lamp',(1,.49,.14),.2,.23,4,False)
cyan=material('cyan-display',(.025,.55,.66),.15,.32,1.7,False)
glass=material('canopy-glass',(.027,.085,.105),.5,.18,0,False,.76)

def poly(points,mat,group=None,uv=None):
 key=group or mat
 if key not in BATCH:BATCH[key]=[[],[],[]];GROUP_MAT[key]=mat
 verts,faces,uvs=BATCH[key];pts=[Vector(p) for p in points];offset=len(verts)
 verts.extend([tuple(p) for p in pts]);faces.append(tuple(range(offset,offset+len(pts))))
 if uv is None:
  n=(pts[1]-pts[0]).cross(pts[2]-pts[0]);axis=max(range(3),key=lambda i:abs(n[i]));ij=[i for i in range(3) if i!=axis]
  uv=[(p[ij[0]]/6.7,p[ij[1]]/6.7) for p in pts]
 uvs.append(uv)

def prism(points,n,depth,mat,group=None):
 pts=[Vector(p) for p in points];n=Vector(n).normalized()
 if (pts[1]-pts[0]).cross(pts[2]-pts[0]).dot(n)<0:pts.reverse()
 top=[p+n*depth for p in pts]
 poly(top,mat,group);poly(list(reversed(pts)),mat,group)
 for i in range(len(pts)):
  j=(i+1)%len(pts);poly([pts[i],pts[j],top[j],top[i]],mat,group)

def box(c,size,mat,basis=None,group=None):
 c=Vector(c);u,v,n=basis or (Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))
 a,b,d=[s/2 for s in size]
 prism([c+u*x*a+v*y*b-n*d for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]],n,2*d,mat,group)

def tube(a,b,r,mat,sides=8,group=None):
 a,b=Vector(a),Vector(b);z=(b-a).normalized();up=Vector((0,1,0)) if abs(z.y)<.85 else Vector((1,0,0));u=z.cross(up).normalized();v=z.cross(u)
 rings=[[c+r*(u*math.cos(i*math.tau/sides)+v*math.sin(i*math.tau/sides)) for i in range(sides)] for c in [a,b]]
 for i in range(sides):
  j=(i+1)%sides;poly([rings[0][i],rings[0][j],rings[1][j],rings[1][i]],mat,group)
 poly(list(reversed(rings[0])),mat,group);poly(rings[1],mat,group)

def cable(points,r=.12,mat=alloy):
 for a,b in zip(points,points[1:]):tube(a,b,r,mat,10)

def plate(points,mat,n=(0,1,0),depth=.09,bolts=True):
 pts=[Vector(p) for p in points];n=Vector(n).normalized();c=sum(pts,Vector())/len(pts)
 pts=[c+(p-c)*.982 for p in pts];prism(pts,n,depth,mat)
 if bolts:
  for i,p in enumerate(pts):
   q=pts[(i+1)%len(pts)];length=(q-p).length;count=max(1,int(length/1.65))
   for j in range(count+1):
    a=p.lerp(q,j/count)*.975+c*.025+n*(depth+.025)
    tube(a,a+n*.055,.057,alloy,6)
   for t in [.13,.49,.83]:
    a=p.lerp(q,t)+n*(depth+.004);b=p.lerp(q,min(.97,t+random.uniform(.03,.13)))+n*(depth+.004)
    mid=(a+b)/2;poly([a,b,mid*.986+c*.014+n*.012],steel)

def hatch(x,y,z,w=2.2,d=2.8):
 box((x,y+.07,z),(w,.14,d),steel)
 box((x,y+.16,z),(w-.16,.09,d-.16),blue[1])
 for dx in [-w*.38,w*.38]:
  for dz in [-d*.36,d*.36]:box((x+dx,y+.24,z+dz),(.13,.13,.3),alloy)
 cable([(x-.3,y+.22,z),(x-.3,y+.35,z),(x+.3,y+.35,z),(x+.3,y+.22,z)],.055)

def radiator(x,y,z,w,d):
 box((x,y,z),(w,.23,d),steel);box((x,y+.14,z),(w-.22,.07,d-.22),black)
 for i in range(int(d/.23)):
  zz=z-d/2+.18+i*.23;box((x,y+.23,zz),(w-.34,.1,.065),alloy)
 for xx in [x-w/2+.06,x+w/2-.06]:box((xx,y+.24,z),(.09,.14,d),steel)

def lamp(x,y,z,orient='front'):
 if orient=='top':
  box((x,y,z),(.8,.18,.37),steel);box((x,y+.1,z),(.52,.05,.19),warm)
 else:
  box((x,y,z),(.75,.43,.21),steel);box((x,y,z+.13),(.5,.19,.05),warm)

# Central pressure hull: a broad low body tapering all the way to the needle prow.
stations=[(-25,8.8,1.0,-2.7),(-21,10.4,1.45,-3.3),(-14,10.6,1.7,-3.5),(-7,9.3,1.85,-3.4),(0,7.6,1.85,-3.1),(7,6.5,1.65,-2.7),(14,4.8,1.3,-2.2),(21,3.4,.9,-1.6),(28,1.75,.42,-.95),(33,.32,-.06,-.35)]
def sample(z):
 for a,b in zip(stations,stations[1:]):
  if a[0]<=z<=b[0]:
   t=(z-a[0])/(b[0]-a[0]);return tuple(a[i]+(b[i]-a[i])*t for i in range(1,4))
 return stations[-1][1:]
def ring(z,w,top,bottom):
 return [Vector((x,y,z)) for x,y in [(-w*.82,top),(w*.82,top),(w,top-.7),(w,bottom+.7),(w*.76,bottom),(-w*.76,bottom),(-w,bottom+.7),(-w,top-.7)]]
rs=[ring(*s) for s in stations]
for a,b in zip(rs,rs[1:]):
 for j in range(1,8):
  k=(j+1)%8;pts=[a[j],a[k],b[k],b[j]];n=(pts[1]-pts[0]).cross(pts[2]-pts[0]).normalized();c=sum(pts,Vector())/4
  # Ring order is clockwise viewed from bow: reverse lateral patches to face outward.
  if n.dot(Vector((c.x,c.y,0)))<0:pts.reverse();n=-n
  plate(pts,random.choice(blue),n,.09)
poly(list(reversed(rs[0])),steel);poly(rs[-1],blue[1])
# Deck plating in individual strips, with a central opening under the canopy.
for za,zb in zip([-25,-21,-17,-13,-9,-5,-1,3,7,11,15,19,23,26,29,33],[-21,-17,-13,-9,-5,-1,3,7,11,15,19,23,26,29,33]):
 wa,ya,_=sample(za);wb,yb,_=sample(zb)
 for fa,fb in [(-.82,-.45),(-.45,-.17),(-.17,.17),(.17,.45),(.45,.82)]:
  if za>=7 and zb<=23 and abs((fa+fb)/2)<.4:continue
  pts=[(wa*fa,ya,za),(wa*fb,ya,za),(wb*fb,yb,zb),(wb*fa,yb,zb)]
  mat=random.choice(ivory) if random.random()<.24 else random.choice(blue)
  plate(pts,mat)
# Swept outer cargo shoulders with individual quadrilateral plates.
for side in [-1,1]:
 rows=[(-24,8.8,15.0),(-20,10.3,16.2),(-16,10.6,15.6),(-12,10.3,14.8),(-8,9.6,13.8),(-4,8.6,12.0),(0,7.6,10.1),(4,7.0,8.0)]
 for (za,ia,oa),(zb,ib,ob) in zip(rows,rows[1:]):
  for fa,fb in [(0,.5),(.5,1)]:
   pts=[(side*(ia+(oa-ia)*f),1.13-(.36*f),z) for z,ia,oa in [(za,ia,oa),(zb,ib,ob)] for f in []]
   pts=[(side*(ia+(oa-ia)*fa),1.13-.36*fa,za),(side*(ia+(oa-ia)*fb),1.13-.36*fb,za),(side*(ib+(ob-ib)*fb),1.13-.36*fb,zb),(side*(ib+(ob-ib)*fa),1.13-.36*fa,zb)]
   prism(pts,(0,-1,0),2.25,steel);plate(pts,random.choice(ivory) if random.random()<.52 else blue[1])
  plate([(side*oa,.72,za),(side*ob,.72,zb),(side*ob,-1.3,zb),(side*oa,-1.3,za)],blue[0],(side,0,0),.08)
 for z,x in [(-17,12.0),(-7,10.5)]:hatch(side*x,1.25,z,2.0,2.8)
 radiator(side*12.8,1.18,-21,2.2,2.1)

# A dorsal spine, articulated into broad service housings.
for z,l,w in [(-21,6,4.5),(-14.3,6.3,4.3),(-7.4,6.5,4.0),(-1,5.7,3.6)]:
 box((0,2.05,z),(w,.7,l),steel);box((0,2.48,z),(w-.25,.24,l-.23),blue[2])
 for x in [-w/2,w/2]:
  box((x,2.07,z),(.19,.58,l-.3),ivory[0])
  for dz in [-l*.36,l*.36]:lamp(x,2.1,z+dz)
 for x in [-w*.34,w*.34]:
  for dz in [-l*.39,l*.39]:tube((x,2.62,z+dz),(x,2.69,z+dz),.09,alloy,6)
for z in [-23,-18,-11,-4]:hatch(0,2.62,z,1.9,1.2)
# Low trapezoid navigation blister aft of the canopy, not a tall bridge.
prism([(-1.25,2.2,2),(1.25,2.2,2),(1.0,2.2,5),(-1,2.2,5)],(0,1,0),.9,steel)
plate([(-1.22,3.13,2),(1.22,3.13,2),(1.0,3.13,4.8),(-1,3.13,4.8)],blue[1],depth=.06)
box((0,2.86,5.02),(1.4,.4,.08),black)

# Canopy. Four sections form a shallow taper; real interior sits behind tinted panes.
canopy=[(6.5,2.25,3.6,1.8),(10.5,2.25,4.5,1.7),(15,1.92,3.85,1.45),(19.5,1.48,2.7,1.2),(23,0.72,1.35,.82)]
def canopy_ring(row):
 z,w,y,b=row;return [Vector((-w,b,z)),Vector((-w*.78,y-.15,z)),Vector((w*.78,y-.15,z)),Vector((w,b,z))]
cr=[canopy_ring(r) for r in canopy]
for a,b in zip(cr,cr[1:]):
 for j in range(3):
  pts=[a[j],b[j],b[j+1],a[j+1]]
  poly(pts,glass,'canopy-glass')
 for j in [0,1,2,3]:tube(a[j],b[j],.115,steel,10);tube(a[j]+Vector((0,.035,0)),b[j]+Vector((0,.035,0)),.033,alloy,8)
for row in cr:
 for a,b in zip(row,row[1:]):tube(a,b,.10,alloy,10)
poly([cr[0][3],cr[0][2],cr[0][1],cr[0][0]],blue[1])
poly(cr[-1],glass,'canopy-glass')
box((0,.55,14.5),(3.5,.2,15.0),black)
box((0,1.05,10),(1.25,.75,1.5),steel);box((0,1.85,9.6),(1.3,1.4,.4),steel)
box((0,1.18,17.8),(2.8,.34,1.35),steel)
for x in [-.9,0,.9]:
 box((x,1.37,17.7),(.68,.08,.68),black);box((x,1.415,17.7),(.5,.018,.44),warm if x==0 else cyan)
for side in [-1,1]:
 box((side*1.3,1.2,13),(.6,.7,5.4),steel)
 for z in [11.3,12.3,13.3,14.3,15.3]:
  box((side*1.3,1.57,z),(.3,.035,.16),cyan)
 # Nose side service conduit follows the taper, hugging the upper chine.
 path=[]
 for z in [2,8,14,20,26,30]:
  w,y,_=sample(z);path.append((side*(w+.05),y-.5,z))
 cable(path,.15)
 for z in [4,10,16,22,28]:
  w,y,_=sample(z);box((side*(w+.06),y-.48,z),(.32,.45,.18),steel)
 lamp(side*1.0,.24,29.4)

# Twin nacelles: long octagonal section with chamfered nose and recessed grilles.
def engine_ring(x,z,w,top,bottom):
 return [Vector((x+dx,y,z)) for dx,y in [(-w*.68,top),(w*.68,top),(w,top-1.0),(w,bottom+1.0),(w*.68,bottom),(-w*.68,bottom),(-w,bottom+1.0),(-w,top-1.0)]]
for side in [-1,1]:
 x=side*21.9;name='engine-port' if side<0 else 'engine-starboard'
 sections=[(-25.5,4.05,2.65,-3.7),(-23.8,5.05,3.45,-4.25),(-20,5.25,3.55,-4.3),(-15,5.25,3.55,-4.3),(-12,5.15,3.4,-4.2),(-9,5.25,3.55,-4.3),(-4,5.25,3.55,-4.3),(1.5,5.05,3.3,-4.15),(5.5,4.85,2.75,-3.95),(8.1,3.7,1.7,-3.15)]
 er=[engine_ring(x,*r) for r in sections]
 # The backing is named per pod for export assertions and independent selection.
 for a,b in zip(er,er[1:]):
  for j in range(8):
   k=(j+1)%8;pts=[a[j],b[j],b[k],a[k]]
   poly(pts,black,name)
   for fa,fb in [(0,.5),(.5,1)]:
    quad=[a[j].lerp(a[k],fa),b[j].lerp(b[k],fa),b[j].lerp(b[k],fb),a[j].lerp(a[k],fb)]
    c=sum(quad,Vector())/4;n=(quad[1]-quad[0]).cross(quad[2]-quad[0]).normalized()
    if n.dot(Vector((c.x-x,c.y,0)))<0:n=-n
    material_=random.choice(ivory) if random.random()<.55 else random.choice(blue)
    plate(quad,material_,n,.09)
 # True front aperture: deep black end wall with 13 vertical fins, thick surround.
 front=er[-1]
 poly(list(reversed([p-Vector((0,0,.4)) for p in front])),black,name)
 for j in range(8):tube(front[j],front[(j+1)%8],.18,alloy,8)
 for dx in [-2.8,-2.33,-1.86,-1.4,-.93,-.47,0,.47,.93,1.4,1.86,2.33,2.8]:
  box((x+dx,-.73,8.05),(.12,3.8,.36),steel)
  box((x+dx,-.73,8.25),(.033,3.8,.05),alloy)
 # Aft circular thrust chamber set into the octagonal engine body.
 tube((x,-.38,-25.3),(x,-.38,-27.4),3.68,steel,32)
 tube((x,-.38,-27.41),(x,-.38,-27.7),3.4,alloy,32)
 tube((x,-.38,-27.72),(x,-.38,-27.78),2.94,black,32)
 tube((x,-.38,-27.79),(x,-.38,-27.83),2.03,steel,32)
 for j in range(20):
  a=j*math.tau/20
  cable([(x+3.1*math.cos(a),-.38+3.1*math.sin(a),-27.85),(x+3.65*math.cos(a),-.38+3.65*math.sin(a),-27.1)],.085,alloy)
 # Armoured clamp bands around the segment joint and thrust chamber.
 for z in [-23.5,-11.1,-10.3]:
  rr=engine_ring(x,z,5.28,3.59,-4.32)
  for j in range(8):
   a=rr[j];b=rr[(j+1)%8];tube(a,b,.16,steel,8)
   for t in [.2,.8]:
    q=a.lerp(b,t);box(q,(.20,.20,.47),alloy)
 for z in [-19,-3.4]:
  radiator(x,3.68,z,3.5,3.0)
  for dx in [-3.0,3.0]:hatch(x+dx,3.56,z,1.0,2.1)
 # Attached side vent stacks and warm service lamps.
 for z in [-18,-5,2]:
  xx=x+side*5.35
  box((xx,-.4,z),(.18,2.5,2.7),steel)
  for k in range(12):box((xx+side*.16,-1.35+k*.18,z),(.2,.055,2.25),alloy)
  box((xx+side*.15,1.0,z+1.4),(.25,.5,.6),steel)
  box((xx+side*.30,1.0,z+1.4),(.035,.3,.32),warm)
 lamp(x-2.7,.4,7.8);lamp(x+2.7,.4,7.8)
 # Structural necks and dense contained machinery across the open engine roots.
 for z in [-20,-12,-3.8]:
  box((side*16.4,-.65,z),(8.4,1.0,1.5),steel)
  for dz in [-.6,.6]:tube((side*12.0,-.1,z+dz),(side*19.2,-.1,z+dz),.20,alloy)
  tube((side*12.4,-.1,z-1.0),(side*19,-.1,z+1.0),.13,steel)
 for z,r in [(-22,.28),(-17.7,.4),(-15.2,.25),(-9,.37),(-6,.3),(-1,.22)]:
  inner=12.7 if z<-10 else 10.8
  tube((side*inner,.08,z),(side*17,.08,z),r,alloy,12)
  for xx in [inner+.5,inner+1.4,16.3]:tube((side*(xx-.12),.08,z),(side*(xx+.12),.08,z),r*1.26,steel,12)
  cable([(side*inner,.08,z),(side*(inner-.4),.35,z+.65),(side*(inner-.4),.65,z+1.4)],r*.72)
 for z in [-18,-7]:
  box((side*15.5,.3,z),(1.65,1.1,2.1),steel)
  tube((side*15.5,.85,z-.9),(side*15.5,.85,z+.9),.62,alloy,12)
  for dz in [-.7,.7]:tube((side*15.5,.85,z+dz-.08),(side*15.5,.85,z+dz+.08),.7,steel,12)
  lamp(side*15.5,1.4,z,'top')
 # Narrow pipe bank parallels nacelle on the inner wall.
 for xx in [side*16.0,side*16.5]:
  cable([(xx,1.6,-22),(xx,1.6,-13),(xx,1.0,-11),(xx,1.0,-2)],.13)
  for z in [-21,-18,-15,-8,-5,-2]:box((xx,1.6 if z<-11 else 1,z),(.35,.38,.17),steel)

# Fine panel service markings and deck hardware, attached to the pressure hull.
for side in [-1,1]:
 for z in [-20,-12,-4,3,25]:
  w,y,_=sample(z);xx=side*w*.63
  if z<6:hatch(xx,y+.14,z,1.5,2.2)
 for z in [24,27,30]:
  w,y,_=sample(z);x=side*w*.48
  poly([(x-.18,y+.13,z-.8),(x+.18,y+.13,z-.8),(x+.16,y+.13,z+.8),(x-.16,y+.13,z+.8)],orange)
 # Reaction-control nozzles inset at shoulder corners, below deck.
 for z in [-21,-4]:
  x=side*(15.3 if z<-10 else 11.5)
  tube((x,-.4,z),(x+side*.45,-.4,z),.42,steel,12)
  tube((x+side*.46,-.4,z),(x+side*.48,-.4,z),.29,black,12)
# Lower cargo doors and landing-pad recesses make the underside inspectable.
for z in [-15,-2,11]:
 w,_,bottom=sample(z);box((0,bottom-.10,z),(w*1.2,.17,5.2),steel)
 for side in [-1,1]:
  box((side*w*.29,bottom-.21,z),(w*.53,.12,4.8),blue[1])
  for dz in [-1.9,1.9]:box((side*w*.29,bottom-.29,z+dz),(.85,.10,.28),alloy)

objects=[]
for name,(verts,faces,uvs) in BATCH.items():
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.materials.append(MATS[GROUP_MAT[name]]);mesh.update()
 uv=mesh.uv_layers.new(name='surface-metres')
 for face,coords in zip(mesh.polygons,uvs):
  for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=xy
 ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);objects.append(ob)
 if GROUP_MAT[name] not in [glass,warm,cyan]:
  bevel=ob.modifiers.new('machined-edge-radius','BEVEL');bevel.width=.027;bevel.segments=1
  normal=ob.modifiers.new('weighted-panel-normals','WEIGHTED_NORMAL');normal.keep_sharp=True
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'courier-hull.blend'))
glb=OUT/'courier-hull.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=False,export_apply=True,export_materials='EXPORT')
# Preserve authored multiplicative tints through the glTF exporter.
data=glb.read_bytes();jl=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+jl])
for m in doc['materials']:
 if 'baseColorTexture' in m.get('pbrMetallicRoughness',{}):m['pbrMetallicRoughness']['baseColorFactor']=list(MATS[m['name']].diffuse_color)
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);tail=data[20+jl:]
glb.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+tail)
print('COURIER_EXPORTED',str(glb),glb.stat().st_size)
