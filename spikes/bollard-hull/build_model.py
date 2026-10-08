# glossary-ignore: wound, tow — physical cable winding and towing hardware, not the carrier Diversion state.
"""O4 Bollard exterior study. Blender --background --python this_file.py.
Metres, Y up, +Z forward. Material-batched authored geometry; seeded detail.
"""
import bpy, bmesh, math, random, json, struct
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent
random.seed(798)
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
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(OUT/'paint-wear.png'),check_existing=True)
  mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(*color,1)
  m.node_tree.links.new(t.outputs['Color'],mix.inputs[1]);m.node_tree.links.new(mix.outputs[0],p.inputs['Base Color'])
 MATS[name]=m;return name

blue=[material('blue-grey-'+str(i),(.14+i*.009,.185+i*.010,.22+i*.010),.55,.36) for i in range(4)]
ivory=[material('pale-steel-'+str(i),(.32+i*.018,.33+i*.018,.32+i*.018),.50,.44) for i in range(3)]
steel=material('dark-structure',(.057,.071,.077),.76,.43)
black=material('recess-black',(.012,.019,.023),.42,.62)
alloy=material('machined-alloy',(.38,.39,.36),.8,.23)
rubber=material('hose-rubber',(.023,.027,.029),.08,.78)
orange=material('service-ochre',(.55,.29,.10),.37,.58)
warm=material('amber-lamp',(1,.14,.012),.1,.35,5,False)
cyan=material('cyan-display',(.025,.55,.66),.15,.32,1.7,False)
glass=material('canopy-glass',(.016,.033,.04),.55,.09,0,False,.73)

def poly(points,mat,group=None,uv=None):
 key=group or mat
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

# Bollard: bounded central pressure body, wide cylindrical drive cassettes,
# open structural channels, cable winch and annular salvage collar.
ivory=ivory
for i,k in enumerate(ivory):
 MATS[k].diffuse_color=(.51+i*.035,.51+i*.035,.47+i*.035,1)
 p=MATS[k].node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.32
 for nd in MATS[k].node_tree.nodes:
  if nd.type=='MIX_RGB':nd.inputs[2].default_value=MATS[k].diffuse_color

def surface(rows,mat,group):
 for a,b in zip(rows,rows[1:]):
  for j in range(len(a)):
   k=(j+1)%len(a);poly([a[j],a[k],b[k],b[j]],mat,group)
 poly(list(reversed(rows[0])),mat,group);poly(rows[-1],mat,group)

def hullring(z,w,t,b):
 return [Vector((x,y,z)) for x,y in [(-w*.75,t),(-w,t-1.4),(-w,b+1.3),(-w*.75,b),(w*.75,b),(w,b+1.3),(w,t-1.4),(w*.75,t)]]
body_rows=[(-23,5.4,3.4,-4.3),(-19,6.4,4.6,-5.2),(-10,6.5,4.9,-5.5),(0,6.1,4.6,-5.4),(10,5.9,4.1,-5.0),(16,5.8,3.2,-4.9),(20,4.9,2.7,-4.5)]
hr=[hullring(*r) for r in body_rows];surface(hr,steel,'pressure-hull')
for a,b in zip(hr,hr[1:]):
 for j in range(8):
  k=(j+1)%8
  # Four lengthwise subdivisions avoid gigantic blank panels.
  for u in range(3):
   aa=a[j].lerp(b[j],u/3);ab=a[k].lerp(b[k],u/3);ba=a[j].lerp(b[j],(u+1)/3);bb=a[k].lerp(b[k],(u+1)/3)
   pts=[aa,ab,bb,ba];c=sum(pts,Vector())/4;n=Vector((c.x,c.y,0)).normalized()
   plate(pts,random.choice(ivory),n,.11)
plate(hr[0],ivory[0],(0,0,-1),.16);plate(hr[-1],ivory[1],(0,0,1),.16)
# Broad deck has narrower plates and maintenance ports.
for z,top in [(-20,4.0),(-15,4.73),(-10,4.9),(-5,4.75),(0,4.6)]:
 for x in [-3.8,3.8]:
  radiator(x,top+.18,z,1.55,2.3)
  lamp(x,top+.38,z+1.65,'top')
for s in [-1,1]:
 for z in [-18,-10,0,9]:
  x=s*(6.4 if z<0 else 6.05)
  box((x,-.3,z),(.18,2.6,3.0),steel)
  box((x+s*.15,-.3,z),(.13,2.27,2.66),ivory[1])
  for dz in [-1.1,1.1]:tube((x+s*.25,-1.2,z+dz),(x+s*.25,.6,z+dz),.09,alloy)
  tube((x+s*.25,-2.3,z-1.2),(x+s*.25,-2.3,z+1.2),.16,alloy)
 # underside access pads
 for z in [-17,-6,6]:
  box((s*2.7,-5.45,z),(3.3,.28,4),steel)
  box((s*2.7,-5.63,z),(2.9,.13,3.6),ivory[0])

# Faceted barrel engine with graded rounded shoulder profile.
N=16
pod_profile=[(-26,4.1),(-25,5.1),(-22,5.9),(-18,6.15),(-11,6.15),(-4,6.15),(3,6.05),(9,5.75),(12,4.7)]
def podring(x,z,r):
 def squ(v):return math.copysign(abs(v)**.70,v)
 return [Vector((x+r*squ(math.cos(math.tau*i/N+math.pi/16)),r*squ(math.sin(math.tau*i/N+math.pi/16)),z)) for i in range(N)]
def annulus(cx,cy,z,inner,outer,depth,mat,n=32,phase=0):
 for i in range(n):
  a=math.tau*i/n+phase;b=math.tau*(i+1)/n+phase
  def squ(v):return math.copysign(abs(v)**(.70 if abs(cx)>10 else 1),v)
  pts=[(cx+inner*squ(math.cos(a)),cy+inner*squ(math.sin(a)),z),(cx+outer*squ(math.cos(a)),cy+outer*squ(math.sin(a)),z),(cx+outer*squ(math.cos(b)),cy+outer*squ(math.sin(b)),z),(cx+inner*squ(math.cos(b)),cy+inner*squ(math.sin(b)),z)]
  prism(pts,(0,0,1),depth,mat)
for side in [-1,1]:
 x=side*17.7;rs=[podring(x,z,r) for z,r in pod_profile]
 surface(rs,steel,'engine-port' if side<0 else 'engine-starboard')
 for (za,ra),(zb,rb) in zip(pod_profile,pod_profile[1:]):
  pieces=max(1,round((zb-za)/2.5))
  for k in range(pieces):
   ta=k/pieces;tb=(k+1)/pieces;a=podring(x,za+(zb-za)*ta,ra+(rb-ra)*ta);b=podring(x,za+(zb-za)*tb,ra+(rb-ra)*tb)
   for j in range(N):
    jj=(j+1)%N;pts=[a[j],b[j],b[jj],a[jj]];n=(a[j]+a[jj])/2-Vector((x,0,za+(zb-za)*ta));n.z=0
    mat=orange if -13<za<-7 or 2<za<10 else random.choice(ivory)
    if j in [0,7,8,15] and k%3==0:mat=steel
    plate(pts,mat,n,.12)
 # Protecting rings, raised bands and clasps with amber lamps.
 for z,r in [(-24,5.55),(-16,6.4),(-7,6.4),(6,6.25)]:
  annulus(x,0,z,r-.35,r,.48,steel,N,math.pi/16)
  for j in range(0,N,2):
   a=math.tau*(j+.5)/N+math.pi/16;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0));c=Vector((x,0,z+.22))+n*(r+.03)
   box(c,(.7,.24,.8),alloy,(t,n,Vector((0,0,1))))
   tube(c+n*.1,c+n*.19,.1,steel,8)
 # Front face is a deep dark protective grille; exhaust is aft.
 tube((x,0,12.01),(x,0,12.20),4.60,black,16)
 annulus(x,0,12.1,4.5,4.92,.38,steel,16,math.pi/16)
 for dx in [-3.7,-3.0,-2.3,-1.6,-.9,-.2,.5,1.2,1.9,2.6,3.3,4.0]:
  h=4.35*max(0,1-(abs(dx)/4.35)**(2/.7))**(.7/2);box((x+dx,0,12.48),(.14,h*2,.18),alloy)
 for yy in [-2.4,0,2.4]:box((x,yy,12.62),(7.2,.17,.20),steel)
 # Real recessed rear engine mouth with outer shell and inner nozzle walls.
 annulus(x,0,-28.1,3.0,4.65,.5,alloy,32)
 annulus(x,0,-27.5,3.4,4.65,1.9,steel,32)
 tube((x,0,-25.6),(x,0,-25.55),3.45,black,32)
 annulus(x,0,-25.67,2.65,2.82,.05,orange,32)
 for j in range(16):
  a=math.tau*j/16;tube((x+3.2*math.cos(a),3.2*math.sin(a),-27.8),(x+3.4*math.cos(a),3.4*math.sin(a),-25.7),.10,alloy)
 for z in [-20,-3,5]:
  radiator(x,6.22,z,3.7,2.8)
  for dx in [-2.5,2.5]:hatch(x+dx,5.91,z,1.0,2)
 for z in [-20,-10,0,7]:
  for sign in [-1,1]:
   xx=x+sign*6.15
   box((xx,1.3,z),(.48,1.3,1.1),steel)
   box((xx+sign*.26,1.3,z),(.08,.72,.55),warm)
   for yy in [-1.8,-1.3,-.8,-.3]:box((xx,yy,z),(.5,.13,1.8),alloy)
 # Exposed rigid truss bridges anchored directly to pressure hull and engine.
 for z in [-19,-7,6]:
  for yy in [-2.4,1.3]:
   box((side*9.9,yy,z),(8,.58,.8),steel)
   cable([(side*6.1,yy+.33,z-.26),(side*13.0,yy+.33,z-.26)],.09,alloy)
  for xa,xb in [(6.1,8.2),(8.2,10.4),(10.4,13.0)]:
   tube((side*xa,-2.1,z),(side*xb,1.0,z),.25,steel)
   tube((side*xa,1.0,z),(side*xb,-2.1,z),.20,alloy)
  for xx in [6.5,12.1]:
   box((side*xx,1.62,z),(1,.16,1.25),ivory[0]);lamp(side*xx,1.83,z,'top')
 # Hose and pump tiers contained within these bridges. Open areas stay readable.
 for z in [-22,-15,-10,-2,3]:
  y=1.1 if z in [-15,-2] else .2
  tube((side*6.1,y,z),(side*12.0,y,z),.34,alloy,12)
  for xx in [6.5,7.3,10.9,11.8]:tube((side*(xx-.16),y,z),(side*(xx+.16),y,z),.47,steel,12)
  cable([(side*6.2,y,z),(side*7,y+1,z+.7),(side*10.7,y+1,z+.7),(side*12,y,z)],.19,rubber)
  for k in range(13):
   xx=7.1+k*.28;tube((side*(xx-.04),y+1,z+.7),(side*(xx+.04),y+1,z+.7),.23,alloy,10)
 for xx,yy in [(8.4,-.8),(9.6,-1.1)]:
  tube((side*xx,yy,-21),(side*xx,yy,7),.18,alloy,12)
  for z in [-19,-7,6]:box((side*xx,yy,z),(.6,1.9,.35),steel)
 for z in [-12,0]:
  tube((side*10.6,-.5,z-1.4),(side*10.6,-.5,z+1.4),.85,steel,16)
  for dz in [-1.2,1.2]:tube((side*10.6,-.5,z+dz-.13),(side*10.6,-.5,z+dz+.13),.93,alloy,16)
 # Cabin protection and clustered lateral thruster wells.
 for z in [11,14]:
  xx=side*5.6
  tube((xx,-2.8,z),(xx+side*.7,-2.8,z),.61,steel,16)
  tube((xx+side*.71,-2.8,z),(xx+side*.8,-2.8,z),.42,alloy,16)
  tube((xx+side*.81,-2.8,z),(xx+side*.82,-2.8,z),.29,black,16)

# Trapezoidal compact wheelhouse; glass reveals small cyan/amber equipment.
cr=[ [Vector((x,y,z)) for x,y in [(-w,base),(-w*.78,top),(w*.78,top),(w,base)]] for z,w,base,top in [(1,3.35,4.4,8.1),(6,3.4,4.3,8.2),(12,2.85,3.9,6.6)] ]
# Solid aft bulkhead and lower opaque coaming. Front glass is broad and sloped.
poly(list(reversed(cr[0])),ivory[0])
for a,b in zip(cr,cr[1:]):
 for j in [0,1,2]:
  pts=[a[j],b[j],b[j+1],a[j+1]]
  poly(pts,glass,'canopy-glass')
 for j in range(4):tube(a[j],b[j],.17,steel,10);tube(a[j]+Vector((0,.05,0)),b[j]+Vector((0,.05,0)),.055,alloy,8)
for row in cr:
 for a,b in zip(row,row[1:]):tube(a,b,.16,alloy,10)
poly(cr[-1],glass,'canopy-glass')
tube((0,3.9,12),(0,6.6,12),.13,steel,10)
for s in [-1,1]:
 # Heavy angular armoured cheek follows the cockpit, no floating slab.
 pts=[(s*3.38,4.0,1),(s*3.48,4.0,6),(s*2.95,3.8,12),(s*2.60,5.0,12),(s*3.08,5.5,6),(s*3.07,5.4,1)]
 plate(pts,ivory[1],(s,0,0),.18)
 for z in [2,5,8]:tube((s*3.3,4.65,z),(s*3.46,4.65,z),.12,alloy,8)
box((0,4.2,7),(5.0,.25,8),black)
box((0,4.9,3.8),(1.4,1.3,1.2),steel);box((0,6.1,3.3),(1.4,1.3,.4),steel)
box((0,4.65,10.4),(4.7,.55,1.2),steel)
for x in [-1.5,-.75,0,.75,1.5]:
 box((x,4.96,10.4),(.55,.08,.70),black);box((x,5.01,10.4),(.43,.02,.5),warm if x==0 else cyan)
for s in [-1,1]:
 for z in [5,6.5,8]:box((s*2.2,5.1,z),(.27,.06,.42),cyan)
 # brow corner protective strip
 cable([(s*2.63,6.71,12.02),(s*2.8,7.1,10),(s*2.82,8.3,6)],.16,ivory[0])
lamp(-2,3.45,13);lamp(2,3.45,13)

# Dorsal winch: large transverse drum, ribbed cable, heavy cheek supports.
winch_y=7.1;winch_z=-11
for s in [-1,1]:
 box((s*3.15,5.3,winch_z),(1.1,2.8,5.3),steel)
 box((s*3.15,5.48,winch_z),(1.3,.3,5.65),ivory[1])
 tube((s*2.9,winch_y,winch_z),(s*3.55,winch_y,winch_z),2.8,alloy,24)
 tube((s*3.56,winch_y,winch_z),(s*3.7,winch_y,winch_z),2.46,ivory[0],24)
 tube((s*3.71,winch_y,winch_z),(s*3.85,winch_y,winch_z),.72,steel,16)
 for j in range(8):
  a=j*math.tau/8;tube((s*3.72,winch_y+2.02*math.cos(a),winch_z+2.02*math.sin(a)),(s*3.86,winch_y+2.02*math.cos(a),winch_z+2.02*math.sin(a)),.12,alloy,8)
 lamp(s*2.5,5.2,winch_z+2.9)
tube((-2.9,winch_y,winch_z),(2.9,winch_y,winch_z),2.26,black,32)
# Actual tightly wound helical cable makes this a winch, not a smooth barrel.
pts=[]
for k in range(3201):
 t=k/3200;a=t*40*math.tau;pts.append((-2.8+t*5.6,winch_y+2.31*math.cos(a),winch_z+2.31*math.sin(a)))
cable(pts,.065,steel)
tube((-3.25,9.85,winch_z-1.0),(3.25,9.85,winch_z-1.0),.20,steel,12)

# Reinforced tow collar. Its aperture stays open: four arms meet perimeter,
# never a flat disk. Lower central ram is the tool visible in the O4 target.
CY=-1.0;Z=26.0;R=9.5;INNER=7.05
annulus(0,CY,Z,INNER,R,1.9,steel,32,math.pi/8)
for i in range(16):
 a=math.tau*i/16+math.pi/8+.018;b=math.tau*(i+1)/16+math.pi/8-.018
 pts=[(INNER*math.cos(a),CY+INNER*math.sin(a),Z+1.94),(R*math.cos(a),CY+R*math.sin(a),Z+1.94),(R*math.cos(b),CY+R*math.sin(b),Z+1.94),(INNER*math.cos(b),CY+INNER*math.sin(b),Z+1.94)]
 plate(pts,orange if i in [1,5,9,13] else ivory[1],(0,0,1),.15)
 # Armoured outside sector, thick dark contact bumper and service light.
 mid=(a+b)/2;n=Vector((math.cos(mid),math.sin(mid),0));t=Vector((-math.sin(mid),math.cos(mid),0));c=Vector((0,CY,Z+1))+n*(R+.08)
 box(c,(2.35,.35,2.15),steel,(t,n,Vector((0,0,1))))
 for d in [-.7,.7]:tube(c+t*d+n*.2,c+t*d+n*.32,.11,alloy,8)
 if i%4==1:
  p=Vector((0,CY,Z+2.2))+n*7.96
  box(p,(.65,1.0,.2),steel,(t,n,Vector((0,0,1))))
  box(p+Vector((0,0,.13)),(.32,.65,.06),warm,(t,n,Vector((0,0,1))))
 if i%2==0:
  c=Vector((0,CY,Z+.9))+n*(INNER-.1)
  box(c,(.75,.42,1.1),alloy,(t,n,Vector((0,0,1))))
  box(c-n*.28,(.55,.25,.8),black,(t,n,Vector((0,0,1))))
for s in [-1,1]:
 for yy in [-1,1]:
  end=Vector((s*6.0,CY+yy*5.5,Z+.5));start=Vector((s*4.2,-1+yy*1.9,15))
  mid=start.lerp(end,.60);tube(start,mid,.70,steel,16);tube(mid,end,.46,alloy,16)
  for t in [.08,.2,.52]:
   c=start.lerp(end,t);d=(end-start).normalized();tube(c-d*.16,c+d*.16,.85,ivory[0],16)
  cable([start+Vector((0,.65,0)),mid+Vector((0,.65,0)),end+Vector((0,.55,0))],.10,rubber)
  tube(end-Vector((.65,0,0)),end+Vector((.65,0,0)),.65,steel,16)
# Lower ram from the keel to the lower inside collar edge.
a=Vector((0,-3.9,17));b=Vector((0,CY-5.8,Z+.25));tube(a,a.lerp(b,.6),.8,steel,16);tube(a.lerp(b,.6),b,.52,alloy,16)
for t in [.18,.4,.75]:
 c=a.lerp(b,t);d=(b-a).normalized();tube(c-d*.2,c+d*.2,.9,steel,16)
for s in [-1,1]:tube(b+Vector((s*.1,.3,0)),b+Vector((s*.75,.3,.5)),.18,alloy,12)
# Round 2: layered cabin coaming and plated brow, dense mounted service fittings.
for row in cr:
 for a,b in zip(row,row[1:]):
  tube(a,b,.26,steel,10)
  # Pale outside lip catches light around the deep black window gasket.
  off=Vector((0,.045,.045));tube(a+off,b+off,.13,ivory[0],8)
# Rear roof is opaque armour and the front remains broad glazing.
a,b=cr[0],cr[1]
plate([a[1],a[2],a[2].lerp(b[2],.22),a[1].lerp(b[1],.22)],ivory[1],(0,1,0),.15)
for side in [-1,1]:
 # Broad tapered edge of the roof and lower sill follow the actual cabin.
 for aa,bb in zip(cr,cr[1:]):
  j=1 if side<0 else 2
  tube(aa[j],bb[j],.23,steel,10)
  tube(aa[j]+Vector((0,.09,0)),bb[j]+Vector((0,.09,0)),.12,ivory[1],10)
  j=0 if side<0 else 3;tube(aa[j],bb[j],.26,ivory[0],8)
 for z in [2,5,8,11]:
  width=3.35 if z<7 else 3.35-(z-6)*.09
  tube((side*width,4.7,z),(side*(width+.15),4.7,z),.14,alloy,8)
# Visible front facia, front mullions, inner console and service lamps.
plate([(-2.9,3.9,12.1),(2.9,3.9,12.1),(2.7,4.55,12.1),(-2.7,4.55,12.1)],ivory[0],(0,0,1),.2)
for x in [-1.7,1.7]:tube((x,4.5,12.12),(x*.8,6.57,12.12),.13,alloy,10)
lamp(0,4.07,12.45)
# Plated machinery cheeks hide blank slab sides without filling open channels.
for side in [-1,1]:
 for z in [-18,-12,-5,2,9]:
  x=side*(6.5 if z<0 else 6.1)
  box((x,1.5,z),(.30,1.55,2.25),steel)
  box((x+side*.23,1.5,z),(.16,1.30,1.97),ivory[1])
  for dz in [-.78,.78]:
   tube((x+side*.33,1.1,z+dz),(x+side*.45,1.1,z+dz),.11,alloy,8)
   tube((x+side*.33,1.9,z+dz),(x+side*.45,1.9,z+dz),.11,alloy,8)
  # Small short branch pipe bends along each service cassette.
  cable([(x+side*.4,.1,z-1),(x+side*.85,.1,z-1),(x+side*.85,.1,z+1),(x+side*.4,.1,z+1)],.14,alloy)
 for y in [-1.4,-.9]:
  cable([(side*6.6,y,-20),(side*6.7,y,-12),(side*6.6,y,-4),(side*6.3,y,5)],.15,alloy)
  for z in [-18,-12,-6,0]:box((side*6.65,y,z),(.44,.45,.24),steel)
 for z in [-18,-11,-4]:
  # Attached deck cassettes leave gaps and winch unobstructed.
  x=side*3.4;y=4.8
  box((x,y+.25,z),(2.4,.36,2.5),steel)
  box((x,y+.5,z),(2.13,.2,2.22),ivory[2])
  for dx in [-.85,.85]:
   for dz in [-.8,.8]:tube((x+dx,y+.62,z+dz),(x+dx,y+.75,z+dz),.10,alloy,8)
  cable([(x-.36,y+.63,z),(x-.36,y+.85,z),(x+.36,y+.85,z),(x+.36,y+.63,z)],.07,alloy)
 # Dense top-tier hose bundles between structure bridges.
 for z in [-17,-13,-8,-3,3]:
  cable([(side*6.4,2.3,z),(side*7.2,2.7,z+.6),(side*10.5,2.7,z+.6),(side*11.9,2.1,z)],.23,rubber)
  for k in range(14):
   x=side*(7.1+k*.25);tube((x-.045,2.7,z+.6),(x+.045,2.7,z+.6),.29,alloy,10)
  box((side*7,2.5,z),(1,.75,1.3),steel)
  lamp(side*7,2.95,z,'top')
 # Engine-end protective cheeks and longitudinal stiffeners sit on the barrel.
 x=side*17.7
 for z,r in [(-21,6.03),(-14,6.2),(-7,6.2),(0,6.12),(7,5.91)]:
  for a in [.55,1.03,2.12,2.58,3.65,5.75]:
   n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0));c=Vector((x,0,z))+n*r
   box(c,(1.3,.22,1.85),steel,(t,n,Vector((0,0,1))))
   box(c+n*.16,(1.05,.12,1.56),ivory[1],(t,n,Vector((0,0,1))))
   for dz in [-.55,.55]:tube(c+n*.23+Vector((0,0,dz)),c+n*.34+Vector((0,0,dz)),.09,alloy,8)
 for angle in [.75,2.39]:
  n=Vector((math.cos(angle),math.sin(angle),0))
  cable([Vector((x,0,z))+n*r for z,r in [(-22,6.02),(-18,6.29),(-11,6.29),(-4,6.29),(3,6.2),(9,5.9)]],.10,alloy)
 # darkened armoured cap replaces the orange uninterrupted nose band
 for j in range(N):
  a=podring(x,9,5.82);b=podring(x,12,4.79);jj=(j+1)%N
  n=(a[j]+a[jj])/2-Vector((x,0,9));n.z=0
  plate([a[j],b[j],b[jj],a[jj]],steel,n,.14)
# Collar seam plates, hinge blocks and inner clamping hardware.
for i in range(16):
 a=math.tau*i/16+math.pi/8;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0));c=Vector((0,CY,Z+2.15))+n*8.45
 box(c,(.58,2.32,.22),steel,(t,n,Vector((0,0,1))))
 for r in [-.78,.78]:
  p=c+n*r;tube(p,p+Vector((0,0,.24)),.13,alloy,8)
 if i%2==0:
  p=Vector((0,CY,Z+2.2))+n*7.3
  box(p,(.9,.55,.42),alloy,(t,n,Vector((0,0,1))))
  tube(p-t*.64,p+t*.64,.22,steel,12)
# Round 3: cockpit armor and irregular mechanical fittings enrich O4's mass.
# The lower tapered brow masks the formerly aquarium-like windshield roof.
for side in [-1,1]:
 for a,b in zip(cr,cr[1:]):
  idx=1 if side<0 else 2
  aa=a[idx];bb=b[idx]
  pts=[aa+Vector((side*.25,.02,0)),bb+Vector((side*.25,.02,0)),bb+Vector((-side*.42,.02,0)),aa+Vector((-side*.42,.02,0))]
  plate(pts,ivory[1],(0,1,0),.16)
 # Cockpit cheek cassette: sloped service equipment under each glazed side.
 for z in [3,8]:
  x=side*3.48
  box((x,5.3,z),(.38,1.05,1.75),steel)
  for k in range(6):box((x+side*.23,4.94+k*.135,z),(.18,.055,1.35),alloy)
  for dz in [-.7,.7]:tube((x+side*.25,5.15,z+dz),(x+side*.4,5.15,z+dz),.09,alloy,8)
 # Bigger uneven junctions instead of another repeated line of identical hoses.
 for z,xx,rad in [(-19,8.4,.9),(-9,9.6,.63),(1,8.5,1.0)]:
  x=side*xx
  box((x,1.55,z),(1.65,1.1,2.2),steel)
  tube((x,2.16,z-.8),(x,2.16,z+.8),rad,alloy,16)
  for dz in [-.65,.65]:tube((x,2.16,z+dz-.12),(x,2.16,z+dz+.12),rad*1.18,steel,16)
  box((x,2.16+rad,z),(1.1,.16,1.15),ivory[0])
  for dx in [-.35,.35]:tube((x+dx,2.2+rad,z),(x+dx,2.45+rad,z),.10,alloy,8)
 # Armoured side cheeks on the bow, laid against the widening pressure shell.
 pts=[(side*5.9,1.2,12),(side*5.84,1.2,16),(side*4.98,.8,19.6),(side*4.98,-2.5,19.6),(side*5.84,-2.8,16),(side*5.9,-2.8,12)]
 plate(pts,ivory[1],(side,0,0),.18)
 # Long prominent fairleads have mounts and copper-grey metallic edges.
 cable([(side*5.85,2.6,12),(side*5.85,2.8,15.5),(side*4.9,2.5,19)],.14,alloy)
 for z in [13,15,17]:
  xx=5.9 if z<16 else 5.6
  box((side*xx,1.8,z),(.6,.85,.55),steel)
 # Reinforced collar arm actuator blocks sit at their hull roots.
 for yy in [-1,1]:
  start=Vector((side*4.2,-1+yy*1.9,15))
  box(start,(1.6,1.5,2.0),steel)
  for dx in [-.5,.5]:tube(start+Vector((dx,.65,-.6)),start+Vector((dx,.9,-.6)),.12,alloy,8)
# Surface normals remain faceted on plates, smooth the machined round hardware.
for name,(verts,faces,uvs) in BATCH.items():
 for i,(x,y,z) in enumerate(verts):
  if 0.5<=z<=12.9 and abs(x)<3.95 and y>4.5:
   verts[i]=(x,4.5+(y-4.5)*.78,z)
# Round 4: dark structural cheeks cradle the winch; asymmetrical service fittings.
for side in [-1,1]:
 # Outboard cheek is an arch with two triangulated feet, not a bare silver disc.
 x=side*3.95
 for j in range(16):
  a=math.pi*j/16;b=math.pi*(j+1)/16
  pa=Vector((x,winch_y+2.88*math.sin(a),winch_z+2.88*math.cos(a)))
  pb=Vector((x,winch_y+2.88*math.sin(b),winch_z+2.88*math.cos(b)))
  tube(pa,pb,.32,steel,8)
 for dz in [-2.7,2.7]:
  prism([(x,4.7,winch_z+dz*1.2),(x,4.7,winch_z+dz*.4),(x,8.1,winch_z+dz*.72)],(side,0,0),.35,steel)
  tube((x,4.9,winch_z+dz),(x,7.7,winch_z+dz*.76),.16,alloy,10)
 # Taller pressure junction and compact exchange box break up bridge repetition.
 for z,xx in [(-16,9.4),(-4,10.0)]:
  x=side*xx
  box((x,.55,z),(2.2,1.65,2.65),steel)
  box((x,1.5,z),(1.75,.3,2.1),ivory[0])
  for zz in [-.75,-.45,-.15,.15,.45,.75]:box((x,1.72,z+zz),(1.42,.16,.1),alloy)
  cable([(x-1.0,.55,z),(x-1.35,.55,z),(x-1.35,2.0,z+.8),(x-.6,2.0,z+.8)],.25,alloy)
 # Engine front lip is machined steel, with real front-to-back thickness.
 x=side*17.7
 annulus(x,0,12.48,4.58,4.89,.20,alloy,16,math.pi/16)
 for j in [1,5,9,13]:
  a=math.tau*(j+.5)/16+math.pi/16
  n=Vector((math.cos(a),math.sin(a),0));c=Vector((x,0,12.79))+n*4.86
  tube(c,c+Vector((0,0,.17)),.14,steel,8)
# Round 5: recessed stern maintenance bulkhead and canopy fixtures.
box((0,-.3,-23.2),(5.5,5.2,.28),steel)
box((0,-.3,-23.38),(5.05,4.7,.13),ivory[1])
for side in [-1,1]:
 for y in [-1.9,1.3]:tube((side*2.1,y,-23.47),(side*2.1,y,-23.63),.14,alloy,8)
 cable([(side*1.7,-1.2,-23.55),(side*1.7,-1.2,-23.85),(side*1.7,.5,-23.85),(side*1.7,.5,-23.55)],.11,alloy)
 for x in [side*3.0,side*3.55,side*4.1]:
  box((x,-.5,-23.21),(.3,3.1,.3),steel)
# Additional dashboard housings and controls show through the dark canopy.
for x in [-1.6,-.8,0,.8,1.6]:
 box((x,4.95,9.8),(.65,.42,.85),steel)
 box((x,5.18,9.8),(.48,.035,.53),cyan if x else warm)
 for dz in [-.32,.32]:box((x,5.21,9.8+dz),(.52,.025,.04),alloy)
for side in [-1,1]:
 for z in [4.5,6,7.5]:
  box((side*2.05,5.0,z),(.35,.25,.75),steel)
  for dz in [-.2,0,.2]:box((side*2.05,5.14,z+dz),(.12,.03,.06),warm if dz==0 else alloy)
 # Proper lamp housings glow under the cabin sill and winch cheeks.
 lamp(side*2.25,4.42,12.5)
objects=[]
for name,(verts,faces,uvs) in BATCH.items():
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.materials.append(MATS[GROUP_MAT[name]]);mesh.update()
 uv=mesh.uv_layers.new(name='surface-metres')
 for face,coords in zip(mesh.polygons,uvs):
  for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=xy
 # Weld each solid's coincident face corners before beveling; isolated face
 # islands cannot form the rounded machined edges the authored solids need.
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()

 if GROUP_MAT[name] in [alloy,rubber]:
  for face in mesh.polygons:face.use_smooth=True
 ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);objects.append(ob)
 if GROUP_MAT[name] in blue+ivory:
  bevel=ob.modifiers.new('machined-edge-radius','BEVEL');bevel.width=.075;bevel.segments=2
  normal=ob.modifiers.new('weighted-panel-normals','WEIGHTED_NORMAL');normal.keep_sharp=True
bpy.context.preferences.filepaths.save_version=0
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'bollard-hull.blend'))
glb=OUT/'bollard-hull.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=False,export_apply=True,export_materials='EXPORT')
# Preserve authored multiplicative tints through the glTF exporter.
data=glb.read_bytes();jl=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+jl])
for m in doc['materials']:
 if 'baseColorTexture' in m.get('pbrMetallicRoughness',{}):m['pbrMetallicRoughness']['baseColorFactor']=list(MATS[m['name']].diffuse_color)
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);tail=data[20+jl:]
glb.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+tail)
print('BOLLARD_EXPORTED',str(glb),glb.stat().st_size)
