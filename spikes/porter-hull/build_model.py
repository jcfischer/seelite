"""O2 Porter exterior study. Blender --background --python this_file.py.
Metres, Y up, +Z forward. Material-batched authored geometry; seeded detail.
"""
import bpy, bmesh, math, random, json, struct
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent
random.seed(797)
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
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(OUT/('steel-wear-coarse.png' if name in ['blue-grey-0','pale-steel-0'] else 'steel-wear.png')),check_existing=True)
  mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(*color,1)
  m.node_tree.links.new(t.outputs['Color'],mix.inputs[1]);m.node_tree.links.new(mix.outputs[0],p.inputs['Base Color'])
 MATS[name]=m;return name

blue=[material('blue-grey-'+str(i),(.14+i*.009,.185+i*.010,.22+i*.010),.45,.49) for i in range(4)]
ivory=[material('pale-steel-'+str(i),(.32+i*.018,.33+i*.018,.32+i*.018),.40,.57) for i in range(3)]
steel=material('dark-structure',(.057,.071,.077),.76,.43)
black=material('recess-black',(.012,.019,.023),.42,.62)
alloy=material('machined-alloy',(.29,.295,.27),.84,.35)
rubber=material('hose-rubber',(.023,.027,.029),.08,.78)
orange=material('service-ochre',(.55,.29,.10),.37,.58)
warm=material('amber-lamp',(1,.29,.045),.2,.23,3,False)
cyan=material('cyan-display',(.025,.55,.66),.15,.32,1.7,False)
glass=material('canopy-glass',(.012,.033,.041),.28,.16,0,False,.90)

def poly(points,mat,group=None,uv=None):
 key=group or mat
 if key not in BATCH:BATCH[key]=[[],[],[]];GROUP_MAT[key]=mat
 verts,faces,uvs=BATCH[key];pts=[Vector(p) for p in points];offset=len(verts)
 verts.extend([tuple(p) for p in pts]);faces.append(tuple(range(offset,offset+len(pts))))
 if uv is None:
  n=(pts[1]-pts[0]).cross(pts[2]-pts[0]);axis=max(range(3),key=lambda i:abs(n[i]));ij=[i for i in range(3) if i!=axis]
  scale=3.0 if mat in ["blue-grey-0","pale-steel-0"] else 5.0
  uv=[(p[ij[0]]/scale,p[ij[1]]/scale) for p in pts]
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
 for dx in [-w/2+.10,w/2-.10]:box((x+dx,y+.25,z),(.16,.22,d-.1),alloy)
 for dz in [-d/2+.10,d/2-.10]:box((x,y+.25,z+dz),(w-.1,.22,.16),steel)
 for dx in [-w*.3,w*.3]:box((x+dx,y+.30,z-d/2+.12),(.42,.18,.4),alloy)
 for zz in [z-d*.31,z+d*.31]:
  cable([(x-w*.28,y+.23,zz),(x-w*.28,y+.38,zz),(x+w*.28,y+.38,zz),(x+w*.28,y+.23,zz)],.065,alloy)
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

# The Porter: three removable freight cassettes along one command keel.
# Dimensions are in metres, Y up, +Z forward. Cargo is starboard (+X).
def section(x,z,w,top,bottom,ch=1.4):
 return [Vector((x+dx,y,z)) for dx,y in [(-w+ch,top),(w-ch,top),(w,top-ch),(w,bottom+ch),(w-ch,bottom),(-w+ch,bottom),(-w,bottom+ch),(-w,top-ch)]]

def hull(name,x,rows,mat,roof=None):
 rings=[section(x,*row) for row in rows]
 for a,b in zip(rings,rings[1:]):
  for j in range(8):
   k=(j+1)%8;poly([a[j],a[k],b[k],b[j]],black,name)
   n=(a[k]-a[j]).cross(b[j]-a[j]).normalized()
   c=(a[j]+a[k]+b[k]+b[j])/4
   if n.dot(Vector((c.x-x,c.y,0)))<0:n=-n
   subdivisions=max(1,int((a[k]-a[j]).length/4.4))
   for q in range(subdivisions):
    f,g=q/subdivisions,(q+1)/subdivisions
    pts=[a[j].lerp(a[k],f),a[j].lerp(a[k],g),b[j].lerp(b[k],g),b[j].lerp(b[k],f)]
    plate(pts,(blue[1] if name.startswith("cargo") and random.random()<.16 else random.choice(roof if roof and j==0 else mat)),n,.10)
 poly(rings[0],black,name);poly(list(reversed(rings[-1])),black,name)
 for rr,n in [(rings[0],(0,0,-1)),(rings[-1],(0,0,1))]:
  plate(rr,mat[0],n,.10)
 return rings

def seam_clamp(x,z):
 # A low crossbeam joins two wrapped, angular locking arms at pod corners.
 box((x,.8,z),(22,2.0,1.65),steel)
 for side in [-1,1]:
  xx=x+side*8.9
  # Chamfered bracket silhouette rather than a square post.
  outline=[(xx-1.2,2.4,z-.92),(xx+1.2,2.4,z-.92),(xx+1.2,6.3,z-.92),(xx+.5,7.65,z-.92),(xx-1.1,7.65,z-.92),(xx-1.7,6.5,z-.92)]
  prism(outline,(0,0,1),1.84,steel)
  for zz,n in [(z-.94,(0,0,-1)),(z+.94,(0,0,1))]:
   plate([(px,py,zz) for px,py,_ in outline],orange,n,.11)
  box((xx,4.6,z+1.10),(.82,2.7,.14),black)
  box((xx,4.7,z+1.2),(.45,2.1,.1),alloy)
  for yy in [3.1,6.45]:
   tube((xx,yy,z+1.10),(xx,yy,z+1.32),.3,steel,10)
   tube((xx,yy,z+1.32),(xx,yy,z+1.39),.16,alloy,6)
  cable([(xx-side*.8,2.9,z+.7),(xx-side*1.8,4.2,z+.7),(xx-side*1.8,6.1,z+.7)],.33,alloy)
  box((xx+side*.9,3.25,z+1.15),(.4,1.5,.22),steel)
  box((xx+side*.9,3.25,z+1.29),(.16,1.15,.035),warm)
 # Frame-top connections remain below the roof line.
 for zz in [z-.62,z+.62]:
  tube((x-7.4,6.7,zz),(x+7.4,6.7,zz),.25,steel,12)
 for xx in [x-6,x,x+6]:box((xx,6.75,z),(1.2,.65,1.7),steel)

def nozzle(x,y,z,r):
 rings=[[(x+rr*math.cos(j*math.tau/48),y+rr*math.sin(j*math.tau/48),zz) for j in range(48)] for zz,rr in [(z+2,r*.94),(z,r),(z-.6,r*.92),(z-.6,r*.79),(z+1.8,r*.64)]]
 for band,(a,b) in enumerate(zip(rings,rings[1:])):
  for j in range(48):
   k=(j+1)%48;poly([a[j],a[k],b[k],b[j]],alloy if band==2 else steel)
 poly(rings[-1],black)
 for j in range(24):
  a=j*math.tau/24
  cable([(x+r*.8*math.cos(a),y+r*.8*math.sin(a),z-.58),(x+r*.63*math.cos(a),y+r*.63*math.sin(a),z+1.6)],.065,alloy)
 for j in range(16):
  a=j*math.tau/16
  cable([(x+r*.98*math.cos(a),y+r*.98*math.sin(a),z+.3),(x+r*.95*math.cos(a),y+r*.95*math.sin(a),z+1.8)],.12,alloy)

# Three broad cuboid cassettes, with softened corners, separated by open locks.
for i,cz in enumerate([-19,1,21]):
 x=9
 rows=[(cz-8.2,9.5,5.9,-5.4),(cz-6.9,10.8,7,-6.5),(cz-3.2,10.8,7,-6.5),(cz+.5,10.8,7,-6.5),(cz+4.2,10.8,7,-6.5),(cz+6.7,10.6,6.8,-6.3),(cz+8.3,9.4,5.7,-5.2)]
 hull("cargo-"+str(i+1),x,rows,ivory,ivory)
 # Mid-roof rectangular cargo hatch, offset electrical cover and heating vents.
 hatch(x,7.16,cz,6.3,5.8)
 radiator(x+6,7.18,cz-2.5,2.1,4.5)
 radiator(x-5.9,7.18,cz+2,2.2,3.5)
 for dx in [-6.0,6.0]:
  hatch(x+dx,7.16,cz+4.8,2.1,1.4)
 for zz in [cz-6.1,cz+5.7]:
  for xx in [x-6.7,x+6.7]:
   cable([(xx-.5,7.2,zz),(xx-.5,7.6,zz),(xx+.5,7.6,zz),(xx+.5,7.2,zz)],.105,alloy)
 # Deep end door and vertical cargo reinforcement rails.
 z=cz+8.44
 box((x,-.05,z),(15.9,8.6,.24),steel)
 for k in range(7):
  xx=x-6.75+k*2.25
  plate([(xx-.99,-4.1,z+.15),(xx+.99,-4.1,z+.15),(xx+.99,4.05,z+.15),(xx-.99,4.05,z+.15)],ivory[0] if k%3 else blue[0],(0,0,1),.13)
  box((xx-1.09,-.05,z+.36),(.15,8.1,.25),steel)
  for yy in [-3.5,3.5]:tube((xx,yy,z+.32),(xx,yy,z+.42),.14,alloy,8)
 for xx in [x-8.6,x+8.6]:
  box((xx,-.3,z+.06),(.7,8.4,.5),steel)
  for yy in [-2.8,2.6]:box((xx,yy,z+.33),(.22,1.25,.08),warm)
 # Side-mounted exchanger cassettes and recessed utility sockets.
 for side in [-1,1]:
  xx=x+side*10.95
  for zz in [cz-3.8,cz+3.3]:
   box((xx,-.2,zz),(.2,6.2,3.2),steel)
   for k in range(20):box((xx+side*.15,-2.95+k*.29,zz),(.12,.10,2.7),alloy)
   for yy in [-3.45,3.2]:
    cable([(xx+side*.2,yy,zz-1.6),(xx+side*.38,yy,zz-1.6),(xx+side*.38,yy,zz+1.6),(xx+side*.2,yy,zz+1.6)],.09,steel)
  for zz in [cz-6.2,cz,cz+6.2]:
   box((xx,-.1,zz),(.26,1.7,1.1),steel)
   tube((xx+side*.2,-.1,zz),(xx+side*.55,-.1,zz),.34,alloy,12)
   tube((xx+side*.56,-.1,zz),(xx+side*.57,-.1,zz),.21,black,12)
 seam_clamp(x,cz-9.2)
 # Independent underside loading covers.
 for xx in [x-4.7,x+4.7]:box((xx,-6.65,cz),(7.8,.25,10.7),steel);box((xx,-6.85,cz),(7.2,.15,10),ivory[0])

# Narrow port command hull, widening behind the compact bridge.
kx=-14.7
hull("command-shell",kx,[(-29.5,5.1,3.4,-4.1),(-26,5.9,4.05,-4.7),(-21,6.0,4.15,-4.8),(-16,6.0,4.15,-4.8),(-11,6.0,4.15,-4.8),(-6,6.0,4.15,-4.8),(-1,6.0,4.15,-4.8),(4,6.0,4.15,-4.8),(9,6.0,4.15,-4.8),(14,5.1,3.8,-4.3),(19,4.7,3.65,-4.1),(24,4.3,2.7,-3.7),(28,3.8,1.6,-3.1),(31.5,3.4,1.25,-2.8)],blue,blue)
# Layered flank access equipment and foredeck lamp housings.
for z in [-22,-15,-8,-1,6]:
 hatch(kx,4.33,z,4.8,4.1)
 radiator(kx-4.55,4.33,z,1.6,2.8)
 for side in [-1,1]:
  xx=kx+side*6.15
  box((xx,-.3,z),(.3,4.5,3.8),steel)
  for yy in [-1.65,-.4,.85]:
   box((xx+side*.17,yy,z),(.18,.95,3.45),blue[1])
  for dz in [-1.3,1.3]:tube((xx+side*.31,-.4,z+dz),(xx+side*.47,-.4,z+dz),.15,alloy,8)
# Offset bridge with raked front windows, a solid sill and plated aft roof.
canopy=[(10.5,4,5.6,3.55),(15,3.7,7.0,3.55),(20,3.2,6.8,3.0),(24.6,2.65,3.3,2.3)]
cr=[]
for z,w,y,b in canopy:cr.append([Vector((kx-w,b,z)),Vector((kx-w*.79,y,z)),Vector((kx+w*.79,y,z)),Vector((kx+w,b,z))])
for idx,(a,b) in enumerate(zip(cr,cr[1:])):
 for j in range(3):
  pts=[a[j],b[j],b[j+1],a[j+1]]
  if idx==0 or (idx==1 and j==1):plate(pts,blue[1],(0,1,0) if j==1 else (-1 if j==0 else 1,0,0),.10)
  else:poly(pts,glass,"canopy-glass")
 for j in range(4):tube(a[j],b[j],.17,steel,10);tube(a[j]+Vector((0,.035,0)),b[j]+Vector((0,.035,0)),.06,alloy,8)
for rr in cr:
 for a,b in zip(rr,rr[1:]):tube(a,b,.14,alloy,10)
poly(list(reversed(cr[0])),blue[1]);poly(cr[-1],glass,"canopy-glass")
# Split forward glazing and detailed but deliberately small working cockpit.
tube((kx,6.8,20),(kx,3.3,24.6),.12,steel)
box((kx,3.7,19),(5.7,.5,1.7),steel)
for x in [-1.8,0,1.8]:
 box((kx+x,4,19),(.95,.1,.75),black);box((kx+x,4.06,19),(.7,.025,.46),cyan if x else warm)
for x in [-1.6,1.6]:
 box((kx+x,4.1,16),(1.25,.7,1.4),steel);box((kx+x,4.9,15.5),(1.35,1.5,.4),black)
for x in [kx-2.5,kx+2.5]:lamp(x,.3,31.6)
box((kx,-1.4,31.66),(4.7,1.05,.2),black)
for yy in [-1.75,-1.4,-1.05]:box((kx,yy,31.83),(4.2,.085,.15),alloy)

# Visible couplings between command keel and cargo bank. These carry the load.
for z in [-24,-10,10,28]:
 box((-4.6,-1.8,z),(9.5,2.3,1.65),steel)
 for dz in [-.65,.65]:tube((-9.5,-.4,z+dz),(.5,-.4,z+dz),.26,alloy,12)
 tube((-9.3,-1.1,z-1.1),(.4,-1.1,z+1.1),.2,steel)
for z in [-25,-20,-14,-6,1,7,14,23]:
 for yy,dz,r in [(1.5,0,.34),(2.5,.85,.20)]:
  cable([(-8.65,yy-.3,z-1),(-7.9,yy,z),(-3.6,yy,z),(-2.4,yy-.3,z+1)],r,rubber)
  for j in range(13):tube((-7.6+j*.28,yy,z),(-7.5+j*.28,yy,z),r*1.19,alloy,10)
 box((-5.5,2,z+1.8),(2.7,1.7,1.15),steel)
 box((-5.5,2.93,z+1.8),(2.2,.14,.8),blue[1])
 lamp(-5.5,3.12,z+1.8,"top")
for x in [-7.9,-6.95,-6.1]:
 tube((x,1.6,-26),(x,1.6,27),.19,alloy,12)
 for z in range(-24,28,4):tube((x,1.6,z-.13),(x,1.6,z+.13),.25,steel,12)
# Aft drive pod and transverse structural power manifold.
nozzle(kx,-.3,-34.6,4.9)
for z in [-30.2,-32.4]:
 tube((kx,-.3,z-.22),(kx,-.3,z+.22),5.1,steel,32)
for i in range(16):
 a=i*math.tau/16
 cable([(kx+4.7*math.cos(a),-.3+4.7*math.sin(a),-33.5),(kx+4.8*math.cos(a),-.3+4.8*math.sin(a),-28)],.18,alloy)
box((3,-1.7,-29.4),(27,3.1,3.0),steel)
for x in [-5,1,7,13,19]:
 box((x,-1.4,-31),(3.3,3.6,.3),blue[0])
 nozzle(x,-1.4,-31.5,1.3)
for x in [-6,5,16]:
 radiator(x,.1,-29.2,3,2)
# Finite recessed reaction control ports, no weapon shapes.
for x,z in [(kx-5.5,-22),(kx-4.9,17),(20,-23),(20,25)]:
 sign=-1 if x<0 else 1
 tube((x,-2,z),(x+sign*.45,-2,z),.43,steel,12)
 tube((x+sign*.46,-2,z),(x+sign*.47,-2,z),.28,black,12)

# Armoured thrust housing: a complete barrel, with segmented cladding.
for j in range(20):
 a=j*math.tau/20;b=(j+1)*math.tau/20
 for za,zb in [(-33.1,-31),(-31,-28.4)]:
  pts=[(kx+5.0*math.cos(ang),-.3+5.0*math.sin(ang),zz) for ang,zz in [(a,za),(b,za),(b,zb),(a,zb)]]
  plate(pts,ivory[0] if j%4 else blue[1],(math.cos((a+b)/2),math.sin((a+b)/2),0),.10)
# Small protruding service modules break the regular command-hull flank.
for z in [-19,-7,5]:
 xx=kx-6.22
 box((xx,-.2,z),(.7,3.8,2.8),steel)
 for yy in [-1.45,1.05]:
  box((xx-.43,yy,z),(.24,.32,2.55),orange)
 for zz in [z-.9,z+.9]:
  cable([(xx-.45,-1.3,zz),(xx-.65,-1.1,zz),(xx-.65,.75,zz),(xx-.45,1.0,zz)],.11,alloy)
 for j in range(10):box((xx-.42,-1+j*.21,z),(.22,.08,1.55),alloy)
 box((xx-.56,.0,z+1.65),(.13,1.3,.4),warm)
for z in [-24,-12,0,8]:
 for side in [-1,1]:
  xx=kx+side*4.85
  box((xx,4.22,z),(.45,.18,1.65),steel)
  box((xx,4.33,z),(.21,.03,1.25),warm)
# Tiny ochre access markings and inset designation plates on each cassette.
for cz in [-19,1,21]:
 for xx in [2.0,16.0]:
  box((xx,7.15,cz+4),(.9,.045,1.5),orange)
  box((xx,7.18,cz+4),(.66,.02,1.25),blue[0])
  for dz in [-.35,0,.35]:box((xx,7.21,cz+4+dz),(.4,.018,.055),alloy)

# Coupled pump barrels and ribbed jumpers fill the cassette-to-cassette seams.
for z in [-28.2,-8.2,11.8]:
 for yy,dz,r in [(4.75,-.25,.5),(3.5,.7,.34),(5.8,.55,.23)]:
  tube((-.5,yy,z+dz),(18.3,yy,z+dz),r,alloy,16)
  for xx in [1.0,4.5,8,11.5,15,17.5]:
   tube((xx-.15,yy,z+dz),(xx+.15,yy,z+dz),r*1.24,steel,12)
 for x in [2.5,9,15.5]:
  cable([(x,2.0,z-.7),(x,4.1,z-.7),(x+.6,5.25,z),(x+.6,4.1,z+.7),(x+.6,2,z+.7)],.36,rubber)
  box((x+.3,5.3,z),(1.6,1.05,1.2),steel)
  box((x+.3,5.9,z),(1.35,.2,.95),alloy)
# Paired machinery cylinders fill the service trench without hiding its void.
for z in [-23,-14,-3,7,18]:
 tube((-5.25,3.25,z-1.7),(-5.25,3.25,z+1.7),.80,alloy,16)
 for dz in [-1.25,1.25]:tube((-5.25,3.25,z+dz-.15),(-5.25,3.25,z+dz+.15),.97,steel,16)
 cable([(-7.9,2.2,z),(-7,3.25,z),(-5.5,3.25,z),(-3.8,4.4,z),(-1.2,4.4,z)],.32,orange)
# Broad armoured coaming reduces exposed glass area and steps down to the prow.
for aa,bb in zip(canopy[1:],canopy[2:]):
 za,wa,ya,ba=aa;zb,wb,yb,bb_=bb
 for side in [-1,1]:
  plate([(kx+side*wa,ba,za),(kx+side*(wa*.79),ya*.45+ba*.55,za),(kx+side*(wb*.79),yb*.45+bb_*.55,zb),(kx+side*wb,bb_,zb)],blue[1],(side,.1,0),.13)
for side in [-1,1]:
 pts=[(kx+side*2.8,2.55,25),(kx+side*3.5,2.15,25),(kx+side*3.1,1.45,30),(kx+side*2.45,1.45,30)]
 plate(pts,ivory[0],(0,1,0),.13)
for zz,yy in [(26,2.15),(28,1.65)]:radiator(kx,yy,zz,3,1.0)

# Raised but compact roof service housings give the command spine a working skyline.
for z in [-18,-7,4]:
 pts=[(kx-1.4,4.35,z-1.4),(kx+1.4,4.35,z-1.4),(kx+1.4,4.95,z-.8),(kx+1.2,5.25,z+.8),(kx-1.2,5.25,z+.8),(kx-1.4,4.95,z-.8)]
 prism(pts,(0,0,1),.22,blue[2])
 box((kx,4.65,z),(2.2,.6,2),steel)
 box((kx,5.05,z),(2.15,.17,1.8),blue[1])
 box((kx,4.8,z+1.12),(1.4,.33,.1),black)
 for dx in [-.4,.4]:box((kx+dx,4.8,z+1.19),(.3,.15,.02),warm)
# Raised ribs guard deep dark roof radiator assemblies.
for cz in [-19,1,21]:
 for xx,zz in [(14.9,cz-2.5),(3.1,cz+2)]:
  box((xx,7.15,zz),(2.7,.2,4.6),black)
  for dx in [-1.35,1.35]:
   box((xx+dx,7.45,zz),(.23,.6,4.9),blue[1])
  for dz in [-2.4,2.4]:box((xx,7.45,zz+dz),(2.9,.6,.24),alloy)
  for k in range(18):box((xx,7.40,zz-2.05+k*.24),(2.1,.22,.09),alloy)
# Upper canopy panels and heavy sill frame reduce the glazing to compact windows.
for aa,bb in zip(canopy[1:],canopy[2:]):
 za,wa,ya,ba=aa;zb,wb,yb,bb_=bb
 for side in [-1,1]:
  plate([(kx+side*wa*.79,ya,za),(kx+side*wa*.51,ya,za),(kx+side*wb*.51,yb,zb),(kx+side*wb*.79,yb,zb)],blue[1],(0,1,0),.16)
for z,w,y,b in canopy[1:]:
 tube((kx-w*.79,y+.07,z),(kx+w*.79,y+.07,z),.18,alloy,12)

# Inset forward windshield: thick armored sill and mullions, smaller glass area.
a,b=cr[2],cr[3]
left=a[1].lerp(b[1],.76);right=a[2].lerp(b[2],.76)
plate([left,right,b[2],b[1]],blue[1],(0,.6,.8),.16)
tube(left+Vector((0,.10,.10)),right+Vector((0,.10,.10)),.22,alloy,12)
for edge in [1,2]:tube(a[edge]+Vector((0,.07,.07)),b[edge]+Vector((0,.07,.07)),.24,steel,12)
hatch(kx,7.05,17.0,3.0,2.6)
objects=[]
for name,(verts,faces,uvs) in BATCH.items():
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.materials.append(MATS[GROUP_MAT[name]]);mesh.update()
 uv=mesh.uv_layers.new(name='surface-metres')
 for face,coords in zip(mesh.polygons,uvs):
  for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=xy
 # Weld each solid's coincident face corners before beveling; isolated face
 # islands cannot form the rounded machined edges the authored solids need.
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
 
 for face in mesh.polygons:face.use_smooth=True
 ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);objects.append(ob)
 if GROUP_MAT[name] in blue+ivory:
  bevel=ob.modifiers.new('machined-edge-radius','BEVEL');bevel.width=.17;bevel.segments=3
  normal=ob.modifiers.new('weighted-panel-normals','WEIGHTED_NORMAL');normal.keep_sharp=True
 else:
  normal=ob.modifiers.new('weighted-surface-normals','WEIGHTED_NORMAL');normal.keep_sharp=True
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'porter-hull.blend'))
glb=OUT/'porter-hull.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=False,export_apply=True,export_materials='EXPORT')
# Preserve authored multiplicative tints through the glTF exporter.
data=glb.read_bytes();jl=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+jl])
for m in doc['materials']:
 if 'baseColorTexture' in m.get('pbrMetallicRoughness',{}):m['pbrMetallicRoughness']['baseColorFactor']=list(MATS[m['name']].diffuse_color)
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);tail=data[20+jl:]
glb.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+tail)
print('PORTER_EXPORTED',str(glb),glb.stat().st_size)
