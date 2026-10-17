"""Longwall B articulated mining study. Blender --background --python this_file.py.
Metres, Y up, +Z forward. Material-batched authored geometry; seeded detail.
"""
import bpy, bmesh, math, random, json, struct
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent
random.seed(803)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
MATS={}; BATCH={}; GROUP_MAT={}; ACTIVE="hull"

def material(name,color,metal=.55,rough=.5,emission=0,texture=True,alpha=1):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,alpha)
 p=m.node_tree.nodes.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*color,alpha);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 p.inputs['Alpha'].default_value=alpha
 if alpha<1:m.surface_render_method='DITHERED'
 if emission:
  p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
 if texture and not emission:
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(OUT/'paint-wear.png'),check_existing=True)
  mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(*color,1)
  fade=m.node_tree.nodes.new('ShaderNodeMixRGB');fade.inputs[0].default_value=.60;fade.inputs[1].default_value=(1,1,1,1);m.node_tree.links.new(t.outputs['Color'],fade.inputs[2]);m.node_tree.links.new(fade.outputs[0],mix.inputs[1]);m.node_tree.links.new(mix.outputs[0],p.inputs['Base Color'])
 MATS[name]=m;return name

blue=[material('blue-grey-'+str(i),(.14+i*.009,.185+i*.010,.22+i*.010),.55,.36) for i in range(4)]
ivory=[material('pale-steel-'+str(i),(.32+i*.018,.33+i*.018,.32+i*.018),.30,.57) for i in range(3)]
steel=material('dark-structure',(.057,.071,.077),.76,.30,texture=False)
black=material('recess-black',(.012,.019,.023),.42,.62,texture=False)
alloy=material('machined-alloy',(.38,.39,.36),.9,.27,texture=False)
rubber=material('hose-rubber',(.023,.027,.029),.08,.78,texture=False)
orange=material('service-ochre',(.55,.29,.10),.37,.58)
warm=material('amber-lamp',(1,.14,.012),.1,.35,5,False)
cyan=material('cyan-display',(.025,.55,.66),.15,.32,1.7,False)
glass=material('canopy-glass',(.012,.055,.075),.25,.12,0,False,.80)

def poly(points,mat,group=None,uv=None):
 key=ACTIVE+"::"+(group or mat)
 if key not in BATCH:BATCH[key]=[[],[],[]];GROUP_MAT[key]=mat
 verts,faces,uvs=BATCH[key];pts=[Vector(p) for p in points];offset=len(verts)
 verts.extend([tuple(p) for p in pts]);faces.append(tuple(range(offset,offset+len(pts))))
 if uv is None:
  n=(pts[1]-pts[0]).cross(pts[2]-pts[0]);axis=max(range(3),key=lambda i:abs(n[i]));ij=[i for i in range(3) if i!=axis]
  uv=[(p[ij[0]]/5.0,p[ij[1]]/5.0) for p in pts]
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
    tube(a-n*.005,a+n*.025,.115,steel,8)
    tube(a+n*.025,a+n*.083,.075,alloy,6)
   for t in [.08,.19,.36,.49,.67,.83,.92]:
    a=p.lerp(q,t)+n*(depth+.004);b=p.lerp(q,min(.97,t+random.uniform(.03,.13)))+n*(depth+.004)
    mid=(a+b)/2;poly([a,b,mid*.975+c*.025+n*.012],steel if t<.7 else alloy)
   # Local abrasion trails below a few seam fasteners, physically on each plate.
   for t in [.27,.73]:
    a=p.lerp(q,t)+n*(depth+.006);inward=(c-a).normalized();along=(q-p).normalized()
    length=random.uniform(.16,.55);width=random.uniform(.025,.07)
    poly([a-along*width,a+along*width,a+inward*length+along*width*.3],steel)

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

# Authored Longwall. Named batches remain separate under mechanism parents.
for k in ivory:
 MATS[k].diffuse_color=(.64,.61,.53,1)
 for nd in MATS[k].node_tree.nodes:
  if nd.type=='MIX_RGB':nd.inputs[2].default_value=MATS[k].diffuse_color

def ring(z,w,t,b,cx=0):
 return [Vector((cx+x,y,z)) for x,y in [(-w*.72,t),(-w,t-1.15),(-w,b+1.15),(-w*.72,b),(w*.72,b),(w,b+1.15),(w,t-1.15),(w*.72,t)]]
def shell(rows,mat,tag):
 for a,b in zip(rows,rows[1:]):
  for j in range(len(a)):
   if tag=='pressure-cabin' and j in [0,6,7] and a[j].z>=16 and a[j].z<29:continue
   k=(j+1)%len(a);poly([a[j],a[k],b[k],b[j]],mat,tag)
 poly(list(reversed(rows[0])),mat,tag);poly(rows[-1],mat,tag)
def plated_hull(rows,mats,tag):
 shell(rows,steel,tag)
 for a,b in zip(rows,rows[1:]):
  for j in range(8):
   if tag=='pressure-cabin' and j in [0,6,7]:continue
   k=(j+1)%8;pts=[a[j],a[k],b[k],b[j]];n=(a[k]-a[j]).cross(b[j]-a[j]).normalized()
   # Multiple physical plates across each broad face; narrow end bevels stay whole.
   pieces=2 if (b[j]-a[j]).length>3 else 1
   across=2 if (a[k]-a[j]).length>5 else 1
   for u in range(pieces):
    for v in range(across):
     aa=a[j].lerp(a[k],v/across).lerp(b[j].lerp(b[k],v/across),u/pieces)
     ab=a[j].lerp(a[k],(v+1)/across).lerp(b[j].lerp(b[k],(v+1)/across),u/pieces)
     bb=a[j].lerp(a[k],(v+1)/across).lerp(b[j].lerp(b[k],(v+1)/across),(u+1)/pieces)
     ba=a[j].lerp(a[k],v/across).lerp(b[j].lerp(b[k],v/across),(u+1)/pieces)
     mat=(ivory[0] if j in [1,3,5,7] else orange) if tag.startswith('sealed-skip') else random.choice(mats)
     plate([aa,ab,bb,ba],mat,n,.16)
 plate(rows[0],mats[0],(0,0,-1));plate(rows[-1],mats[0],(0,0,1))
def annulus(cx,cy,z,ri,ro,depth,mat,n=32):
 for j in range(n):
  a=j*math.tau/n;b=(j+1)*math.tau/n
  prism([(cx+ri*math.cos(a),cy+ri*math.sin(a),z),(cx+ro*math.cos(a),cy+ro*math.sin(a),z),(cx+ro*math.cos(b),cy+ro*math.sin(b),z),(cx+ri*math.cos(b),cy+ri*math.sin(b),z)],(0,0,1),depth,mat)
for sx in [-1,1]:
 x=sx*5.8
 box((x,-2,-7),(1.25,2.3,64),steel)
 for z in range(-36,23,4):
  box((x,-.73,z),(1.36,.20,3.7),orange);box((x,-3.25,z),(1.4,.16,3.7),ivory[0])
  tube((x+sx*.73,-1,z-1.4),(x+sx*.73,-1,z+1.4),.1,alloy)
  for dz in [-1.4,1.4]:tube((x+sx*.72,-2.6,z+dz),(x+sx*.88,-2.6,z+dz),.14,alloy)
  if z%8==0:lamp(x+sx*.7,-.8,z)
 tube((sx*3.8,-3.0,-36),(sx*3.8,-3.0,25),.75,steel,16)
 for z in range(-34,23,5):
  box((sx*4.0,-3.5,z),(2.2,1.7,3.8),ivory[1]);box((sx*4.0,-4.38,z),(1.7,.1,2.8),orange)
  tube((sx*4.0,-3,z-2),(sx*4.0,-3,z-1.6),.95,alloy,12)
  for yy in [-2.4,-2,-1.6]:tube((sx*6.5,yy,z-1.5),(sx*6.5,yy,z+1.4),.09,alloy)
for z in range(-36,20,5):
 box((0,-2,z),(12,1.0,.65),steel);tube((-5,-2,z),(5,-2,z+4),.23,alloy)
for idx,cz in enumerate([-25,-10,5]):
 rows=[ring(cz-6,5.35,6.1,-.8),ring(cz-4.5,6.0,7.0,-.8),ring(cz,6.0,7.0,-.8),ring(cz+4.5,6.0,7.0,-.8),ring(cz+6,5.35,6.1,-.8)]
 plated_hull(rows,[orange,orange,ivory[0],ivory[1]],'sealed-skip-'+str(idx))
 for dz in [-4.8,4.8]:
  rr=ring(cz+dz,6.16,7.15,-.96)
  for j in range(8):tube(rr[j],rr[(j+1)%8],.22,steel)
  for sx in [-1,1]:
   x=sx*6.13;box((x,2.9,cz+dz),(.42,4.4,.72),steel);box((x+sx*.24,3.0,cz+dz),(.18,3.25,.43),orange)
   for yy in [1.15,4.9]:tube((x,yy,cz+dz),(x+sx*.45,yy,cz+dz),.22,alloy,8)
   box((sx*6.25,.1,cz+dz),(1.5,1.65,1.55),steel);box((sx*6.55,.3,cz+dz),(.75,.95,1.1),orange);lamp(sx*6.3,.6,cz+dz+.78)
 for sx in [-1,1]:
  box((sx*6.14,2.1,cz),(.2,3.2,4.4),steel);box((sx*6.26,2.1,cz),(.13,2.9,4.1),ivory[0])
  for dz in [-1.8,1.8]:tube((sx*6.34,1.0,cz+dz),(sx*6.34,3.15,cz+dz),.10,alloy)
  tube((sx*4.0,-3,cz),(sx*4.0,-.5,cz),.7,steel,12)
 hatch(0,7.18,cz,3.8,4.0)
 for x in [-3.0,3.0]:radiator(x,7.18,cz,1.6,2.8)
# Sealed forebody machinery hull, with a compact human-scale pressure bridge.
rows=[ring(13,4.7,3.6,-3),ring(17,5.2,3.8,-3),ring(23,5.0,3.8,-3),ring(29,3.6,1.8,-2.7),ring(31,2.8,.6,-2.1)]
plated_hull(rows,[orange,ivory[0],orange],'forebody-machinery')
# Each bridge facet is a closed backing polygon. Window facets substitute glass
# in the same plane: no empty holes or offset floating windshield assembly.
# Ring helper uses large chamfers appropriate for hulls; bridge gets gentler ones.
bridge_rows=[]
for z,w,top in [(16.2,2.2,6.5),(19.2,2.2,6.5),(22,2.0,6.2),(24.2,1.8,4.8)]:
 bridge_rows.append([Vector((x,y,z)) for x,y in [(-w*.85,top),(-w,top-.35),(-w,3.9),(-w*.85,3.65),(w*.85,3.65),(w,3.9),(w,top-.35),(w*.85,top)]])
for segment,(a,b) in enumerate(zip(bridge_rows,bridge_rows[1:])):
 for j in range(8):
  k=(j+1)%8;pts=[a[j],a[k],b[k],b[j]];n=(a[k]-a[j]).cross(b[j]-a[j]).normalized()
  window=(j in [1,5] and segment in [0,1,2]) or (j==7 and segment==2)
  if window:
   # Glass is the continuous pressure boundary; smaller armor surrounds it.
   poly(pts,glass,'bridge-glazing')
   c=sum(pts,Vector())/4
   inset=[c+(p-c)*.74 for p in pts]
   for q in range(4):
    r=(q+1)%4;prism([pts[q],pts[r],inset[r],inset[q]],n,.13,orange)
   if j==7:
    aa=pts[0].lerp(pts[1],.5);bb=pts[3].lerp(pts[2],.5);tube(aa+n*.15,bb+n*.15,.09,steel)
   for aa,bb in zip(inset,inset[1:]+inset[:1]):tube(aa+n*.14,bb+n*.14,.06,alloy)
  else:
   poly(pts,steel,'bridge-shell');plate(pts,orange if j in [0,6,7] else ivory[0],n,.12)
poly(list(reversed(bridge_rows[0])),steel,'bridge-shell');plate(bridge_rows[0],ivory[0],(0,0,-1),.10)
poly(bridge_rows[-1],steel,'bridge-shell');plate(bridge_rows[-1],orange,(0,0,1),.10)
# Two seats and a low instrument console, sized to people rather than the ship.
for x in [-.68,.68]:
 box((x,4.14,19.4),(.62,.18,.7),black);box((x,4.65,19.05),(.62,.9,.17),black)
 tube((x,3.8,19.4),(x,4.08,19.4),.12,alloy)
 box((x,4.22,22),(.95,.8,.6),steel);box((x,4.64,22),(.72,.035,.37),cyan)
for sx in [-1,1]:
 # Broad shoulders retain the equipment needed below the compact bridge.
 radiator(sx*3.7,3.96,18,1.6,3.0);hatch(sx*3.5,3.96,22,1.7,2.0)
 lamp(sx*3.1,0,29.3)
box((0,6.67,17.8),(3.4,.18,1.6),orange)

plated_hull([ring(-43,4.2,3,-3),ring(-39,5.3,4,-3),ring(-33,5.3,4,-3)], [ivory[0],orange],'powerpack')
for sx in [-1,1]:
 x=sx*12.5
 for z in [-40,-34]:
  box((sx*8,-.8,z),(10,.9,1.0),steel);tube((sx*5,1.5,z),(sx*11,-1.6,z),.35,alloy);tube((sx*5,-2,z),(sx*11,1.8,z),.33,steel);tube((sx*5,0,z+1),(sx*12,0,z+1),.45,steel)
 rows=[ring(-46,3.0,2.8,-2.8,x),ring(-44,3.8,3.7,-3.7,x),ring(-36,3.8,3.7,-3.7,x),ring(-32,3.2,3,-3,x)]
 plated_hull(rows,[ivory[0],orange,ivory[1]],'drive-'+str(sx))
 annulus(x,0,-47,2.15,3.3,.8,alloy,24);annulus(x,0,-46.2,2.1,3.4,1.4,steel,24);tube((x,0,-44.8),(x,0,-44.7),2.5,black,24)
 box((x,0,-31.9),(4.8,4.4,.25),black)
 for dx in [-1.9,-1.4,-.9,-.4,.1,.6,1.1,1.6,2.1]:box((x+dx,0,-31.7),(.14,3.85,.16),alloy)
 radiator(x,3.85,-38,3.5,3.4)
 for sign in [-1,1]:lamp(x+sign*2.4,1.3,-31.7)
 for y in [-1.5,1.5]:tube((x+sx*3.8,y,-39),(x+sx*4.5,y,-39),.38,steel,12)
for sx in [-1,1]:
 tube((sx*3.0,-5,16),(sx*3.0,-5,32),.7,steel,16)
 for z in [17,24,30]:box((sx*3,-5,z),(1.9,2.3,1.05),orange)
 tube((sx*3,-5,25),(sx*3,-5,35),.38,alloy,16)
tube((0,-5,12),(0,-5,29),1.75,steel,24)
for z in [15,20,25,29]:annulus(0,-5,z,1.72,2.0,.35,alloy,24)
ACTIVE='feed'
tube((0,0,-30),(0,0,-2),1.48,alloy,24)
for sx in [-1,1]:
 tube((sx*3,0,-28),(sx*3,0,-1),.36,alloy,16);box((sx*3,0,-3),(1.8,2.2,2.8),orange);tube((sx*3,-1,-4),(sx*4.9,-1,0),.42,steel,12)
annulus(0,0,-3.5,2.0,4.8,2.5,steel)
for j in range(16):
 a=j*math.tau/16;b=(j+1)*math.tau/16
 pts=[(r*math.cos(t),r*math.sin(t),z) for r,t,z in [(4.7,a,-2.3),(5.8,a,-.5),(5.8,b,-.5),(4.7,b,-2.3)]]
 plate(pts,ivory[0] if j%3 else orange,(math.cos((a+b)/2),math.sin((a+b)/2),.4),.10)
 c=Vector((5.65*math.cos(a),5.65*math.sin(a),-.7));box(c,(.5,.5,.7),steel)
 if j%4==0:lamp(c.x,c.y,-.05)
annulus(0,0,-.5,5.3,5.85,.55,steel)
ACTIVE='rotor'
annulus(0,0,0,3.95,5.5,.7,alloy,48);annulus(0,0,-.6,4.1,5.2,.6,steel,48)
for j in range(24):
 a=j*math.tau/24;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0))
 c=n*5.05+Vector((0,0,.55));box(c,(.58,.75,.65),steel,(t,n,Vector((0,0,1))))
 prism([c+t*.35-n*.2,c-t*.35-n*.2,c-t*.20+n*.35],(0,0,1),.85,alloy)
for j in range(8):
 a=j*math.tau/8;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0))
 prism([n*1.25+Vector((0,0,-1.4)),n*4+Vector((0,0,-.3)),n*3.8+t*.5+Vector((0,0,-.3))],(0,0,1),.4,steel)
tube((0,0,-3),(0,0,-.6),1.15,black,24)
for i in range(4):
 ACTIVE='anchor-'+str(i)+'-body'
 tube((0,0,0),(0,0,9),.68,steel,16)
 for z in [1,4,7]:
  box((0,0,z),(1.65,1.6,2.4),orange);box((0,.88,z),(1.2,.12,1.8),ivory[0])
  for x in [-.62,.62]:tube((x,-.6,z-.8),(x,-.6,z+.8),.11,alloy)
 for y in [-.65,.65]:tube((-.9,y,1),(-.9,y,8),.13,rubber)
 tube((-1.2,0,.8),(1.2,0,.8),.85,steel,16)
 for x in [-1.3,1.2]:tube((x,0,.8),(x+.12,0,.8),.64,alloy,16)
 annulus(0,0,8.8,.55,.88,.6,alloy,16)
 ACTIVE='anchor-'+str(i)+'-sleeve';tube((0,0,0),(0,0,1),.50,alloy,16)
 ACTIVE='anchor-'+str(i)+'-foot'
 tube((0,0,-1.6),(0,0,-.2),.66,alloy,16);box((0,0,-.65),(2.3,2.3,1.0),steel);box((0,0,-.05),(1.9,1.9,.3),orange)
 for j in range(3):
  a=j*math.tau/3;n=Vector((math.cos(a),math.sin(a),0));tube(n*.5+Vector((0,0,-.8)),n*1.8+Vector((0,0,-.15)),.36,steel,8);box(n*1.85+Vector((0,0,-.12)),(.8,.8,.28),alloy)
 tube((0,0,-.1),(0,0,.8),.23,alloy,12)
 for z in [.05,.25,.45,.65]:annulus(0,0,z,.20,.39,.09,steel,12)
 lamp(0,1.1,-.5)
# Round two: physical layer depth, hardpoint shoulders, articulated forearms.
ACTIVE='hull'
for idx,cz in enumerate([-25,-10,5]):
 for sx in [-1,1]:
  # Prominent dark corner pillars with ochre collars and silver lock dogs.
  for dz in [-5.0,5.0]:
   x=sx*6.30
   box((x,3.0,cz+dz),(.65,5.2,.95),steel)
   box((x+sx*.37,3.1,cz+dz),(.20,3.8,.57),orange)
   for yy in [1.0,5.1]:
    box((x+sx*.22,yy,cz+dz),(.75,.8,1.25),alloy)
    tube((x+sx*.64,yy,cz+dz),(x+sx*.76,yy,cz+dz),.20,steel,8)
  # Recessed mechanical access layer framed by several independent plates.
  for dz in [-2.0,0,2.0]:
   x=sx*6.22
   plate([(x,.2,cz+dz-.9),(x,1.9,cz+dz-.9),(x,1.9,cz+dz+.9),(x,.2,cz+dz+.9)],orange,(sx,0,0),.18)
   box((x+sx*.2,.96,cz+dz),(.20,.9,.9),black)
   for yy in [.6,.85,1.1,1.35]:box((x+sx*.35,yy,cz+dz),(.1,.07,.75),alloy)
  # Roof clamps crossing shoulder, bolted down at two heights.
  for dz in [-4.4,4.4]:
   cable([(sx*6.5,4.7,cz+dz),(sx*6.5,6.1,cz+dz),(sx*4.5,7.35,cz+dz),(sx*3.5,7.35,cz+dz)],.28,steel)
   for xx,yy in [(6.42,5.5),(4.7,7.0)]:box((sx*xx,yy,cz+dz),(.7,.7,1.05),orange)
  cable([(sx*6.6,-.4,cz-5.5),(sx*7,-.9,cz-4.5),(sx*7,-.9,cz+4.5),(sx*6.6,-.4,cz+5.5)],.22,rubber)
  for z in [cz-3,cz+3]:
   box((sx*6.8,-1,z),(1.1,1.3,1.8),steel);box((sx*7.4,-1,z),(.18,.9,1.2),ivory[0])
 # Scribed subdivisions on large roof panels, separate overlays and lift eyes.
 for dz in [-3.3,3.3]:
  for x in [-2.7,2.7]:
   plate([(x-1.2,7.12,cz+dz-.9),(x+1.2,7.12,cz+dz-.9),(x+1.2,7.12,cz+dz+.9),(x-1.2,7.12,cz+dz+.9)],ivory[0],(0,1,0),.13)
   tube((x-.4,7.35,cz+dz),(x-.4,7.7,cz+dz),.10,alloy);tube((x-.4,7.7,cz+dz),(x+.4,7.7,cz+dz),.1,alloy);tube((x+.4,7.7,cz+dz),(x+.4,7.35,cz+dz),.1,alloy)
# Cab frame and window division, industrial fixtures rather than smooth wedge.
for sx in [-1,1]:
 for z in [15.5,18.5,21.5]:
  box((sx*5.15,.2,z),(.6,1.9,2.2),steel);box((sx*5.50,.2,z),(.14,1.55,1.8),ivory[0])
  tube((sx*5.64,-.3,z-.55),(sx*5.64,.7,z-.55),.09,alloy)
 box((sx*3.15,1.1,28.8),(1.6,1.0,.7),steel);box((sx*3.15,1.1,29.18),(1.1,.45,.08),warm)
 for dx in [-.52,.52]:tube((sx*3.15+dx,.76,29.27),(sx*3.15+dx,1.42,29.27),.07,alloy)
 for sy in [-1,1]:
  # Heavy spherical-bearing mount securely intersects forebody keel.
  tube((sx*4.8,sy*2,13),(sx*6.6,sy*2,13),1.25,steel,20)
  tube((sx*6.6,sy*2,13),(sx*6.85,sy*2,13),.95,alloy,20)
  box((sx*5.5,sy*2,13),(2.4,2.8,2.8),orange)
 # Compact nozzles mounted around bow and stern.
 for z in [26,-41]:
  for yy in [-1.2,0]:
   x=sx*(4 if z>0 else 15.8)
   box((x,yy,z),(1.0,.9,1.5),steel)
   tube((x,yy,z+.7),(x,yy,z+1.05),.30,alloy,12);tube((x,yy,z+1.04),(x,yy,z+1.07),.21,black,12)
# Each anchor now has an elbow, armoured second boom and twin sliding rods.
for i in range(4):
 ACTIVE='anchor-'+str(i)+'-lower'
 tube((0,0,0),(0,0,6),.82,steel,16)
 for z in [1,3.2,5.2]:
  box((0,0,z),(1.95,1.8,1.8),orange);box((0,1.0,z),(1.4,.16,1.3),ivory[0])
  for x in [-.76,.76]:tube((x,-.75,z-.65),(x,-.75,z+.65),.14,alloy)
 for x in [-1.1,1.1]:tube((x,0,0),(x,0,5.8),.25,steel,12)
 cable([(-1.05,.8,.5),(-1.4,1.2,1.3),(-1.4,1.2,4.8),(-.8,.8,6)],.15,rubber)
 annulus(0,0,5.8,.6,.99,.4,alloy,16)
 ACTIVE='anchor-'+str(i)+'-lower-rod'
 tube((0,0,0),(0,0,1),.60,alloy,16)
 for x in [-.9,.9]:tube((x,0,0),(x,0,1),.18,alloy,12)
 ACTIVE='anchor-'+str(i)+'-elbow'
 tube((-1.5,0,0),(1.5,0,0),1.25,steel,20)
 for x in [-1.65,1.5]:
  tube((x,0,0),(x+.15,0,0),1.05,orange,16);tube((x-.01,0,0),(x+.17,0,0),.60,alloy,16)
 cable([(-1.0,0,-1),(-1.65,1.0,-.6),(-1.65,1.6,.5),(-.8,1.0,1.5)],.18,rubber)


ACTIVE='hull'
for z in [-17.5,-2.5]:
 for sx in [-1,1]:
  for y in [1.6,3.4,5.0]:
   tube((sx*4.9,y,z-1.9),(sx*4.9,y,z+1.9),.56,steel,16)
   for dz in [-1.4,-.7,0,.7,1.4]:annulus(sx*4.9,y,z+dz,.53,.73,.21,alloy,16)
  box((sx*6.8,1.1,z),(1.45,2.1,2),steel);box((sx*7.6,1.1,z),(.15,1.6,1.5),orange)
  cable([(sx*5.2,5.2,z-1.5),(sx*6.9,5.2,z-1),(sx*7.1,4.4,z+1),(sx*5.2,4.4,z+1.5)],.24,rubber)
# Larger asymmetric service housings along pressure cabin.
for sx in [-1,1]:
 box((sx*5.4,2.4,16),(1.1,2.1,2.5),steel)
 for z in [15.2,15.6,16,16.4,16.8]:box((sx*6.0,2.4,z),(.12,1.5,.16),alloy)



# Captive fasteners and hose loops across the articulated joints.
for i in range(4):
 ACTIVE='anchor-'+str(i)+'-elbow'
 for sx in [-1,1]:
  for j in range(8):
   a=j*math.tau/8;y=.84*math.cos(a);z=.84*math.sin(a)
   tube((sx*1.7,y,z),(sx*1.80,y,z),.14,steel,8)
   tube((sx*1.80,y,z),(sx*1.90,y,z),.09,alloy,6)
  cable([(sx*.9,-.7,-1.0),(sx*1.2,-1.6,-.7),(sx*1.2,-1.9,.4),(sx*.8,-1.1,1.7)],.18,rubber)
 ACTIVE='anchor-'+str(i)+'-body'
 for sx in [-1,1]:
  for j in range(6):
   a=j*math.tau/6;y=.53*math.cos(a);z=.8+.53*math.sin(a)
   tube((sx*1.33,y,z),(sx*1.47,y,z),.09,alloy,6)

objects=[];parents={}
for name,(verts,faces,uvs) in BATCH.items():
 mechanism=name.split('::')[0]
 if mechanism not in parents:
  parent=bpy.data.objects.new(mechanism,None);bpy.context.collection.objects.link(parent);parents[mechanism]=parent
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.materials.append(MATS[GROUP_MAT[name]]);mesh.update()
 uv=mesh.uv_layers.new(name='surface-metres')
 for face,coords in zip(mesh.polygons,uvs):
  for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=xy
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
 ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);ob.parent=parents[mechanism];objects.append(ob)
 if GROUP_MAT[name] in ivory+[orange]:
  bevel=ob.modifiers.new('machined-edge-radius','BEVEL');bevel.width=.10;bevel.segments=2
  normal=ob.modifiers.new('weighted-panel-normals','WEIGHTED_NORMAL');normal.keep_sharp=True
parents['feed'].location=(0,-5,36);parents['rotor'].parent=parents['feed']
for i in range(4):
 sx=-1 if i%2==0 else 1;sy=1 if i<2 else -1
 base=Vector((sx*6,sy*2,13));end=Vector((sx*8,sy*3,-5));d=end-base
 ob=parents['anchor-'+str(i)+'-body'];ob.location=base;ob.rotation_mode='QUATERNION';ob.rotation_quaternion=Vector((0,0,1)).rotation_difference(d.normalized())
 ob=parents['anchor-'+str(i)+'-sleeve'];ob.location=base+d.normalized()*9;ob.rotation_mode='QUATERNION';ob.rotation_quaternion=Vector((0,0,1)).rotation_difference(d.normalized());ob.scale.z=d.length-9
 parents['anchor-'+str(i)+'-foot'].location=end;parents['anchor-'+str(i)+'-foot'].scale=(1.35,1.35,1.35)
 parents['anchor-'+str(i)+'-elbow'].scale=(1.35,1.35,1.15)
 elbow=base+d*.48;upper=elbow-base;lower=end-elbow
 for suffix,origin,direction in [('body',base,upper),('sleeve',base+upper.normalized()*9,upper),('lower',elbow,lower),('lower-rod',elbow+lower.normalized()*6,lower),('elbow',elbow,lower)]:
  ob=parents['anchor-'+str(i)+'-'+suffix];ob.location=origin;ob.rotation_mode='QUATERNION';ob.rotation_quaternion=Vector((0,0,1)).rotation_difference(direction.normalized())
  if suffix=='body':ob.scale=(1.25,1.25,(upper.length-3)/9)
  if suffix=='sleeve':ob.location=base+upper.normalized()*(upper.length-3);ob.scale.z=3
  if suffix=='lower':ob.scale=(1.25,1.25,(lower.length-3)/6)
  if suffix=='lower-rod':ob.location=elbow+lower.normalized()*(lower.length-3);ob.scale.z=3
bpy.context.preferences.filepaths.save_version=0
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'longwall-miner.blend'))
glb=OUT/'longwall-miner.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=False,export_apply=True,export_materials='EXPORT')
data=glb.read_bytes();jl=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+jl])
for m in doc['materials']:
 if 'baseColorTexture' in m.get('pbrMetallicRoughness',{}):m['pbrMetallicRoughness']['baseColorFactor']=list(MATS[m['name']].diffuse_color)
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);tail=data[20+jl:]
glb.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+tail)
print('LONGWALL_EXPORTED',str(glb),glb.stat().st_size)
