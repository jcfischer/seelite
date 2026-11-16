"""Discovery Voyager exterior study, authored by Codex.
Blender --background --python this_file.py.
Metres, X longitudinal, Y up. Material-batched geometry; deterministic detail.
"""
import bpy, bmesh, math, random, json, struct
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent
random.seed(809)
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
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(OUT/(('panel-wear.png' if name=='pale-steel-1' else 'panel-aged.png') if name.startswith('pale-steel') else 'steel-wear.png')),check_existing=True)
  mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(*color,1)
  m.node_tree.links.new(t.outputs['Color'],mix.inputs[1]);m.node_tree.links.new(mix.outputs[0],p.inputs['Base Color'])
 MATS[name]=m;return name

blue=[material('blue-grey-'+str(i),(.14+i*.009,.185+i*.010,.22+i*.010),.45,.49) for i in range(4)]
ivory=[material('pale-steel-'+str(i),(.36+i*.075,.38+i*.073,.38+i*.070),.32,.56) for i in range(3)]
steel=material('dark-structure',(.057,.071,.077),.76,.43)
black=material('recess-black',(.012,.019,.023),.42,.62)
alloy=material('machined-alloy',(.36,.375,.38),.86,.27)
rubber=material('hose-rubber',(.023,.027,.029),.08,.78)
orange=material('service-ochre',(.55,.29,.10),.37,.58)
warm=material('amber-lamp',(1,.29,.045),.2,.23,3,False)
cyan=material('cyan-display',(.025,.55,.66),.15,.32,1.7,False)
rust=material('fastener-oxidation',(.19,.105,.043),.15,.84)
chip=material('exposed-undercoat',(.12,.14,.14),.6,.62)
glass=material('canopy-glass',(.006,.013,.017),.08,.45,0,False,.90)

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
 uv=None
 if len(top)==4 and mat in ivory:
  off=random.uniform(.06,.28);span=random.uniform(.6,.85)
  uv=[(off,off),(off+span,off),(off+span,off+span),(off,off+span)]
  shift=random.randrange(4);uv=uv[shift:]+uv[:shift]
 poly(top,mat,group,uv);poly(list(reversed(pts)),mat,group)
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
 pts=[c+(p-c)*.992 for p in pts];prism(pts,n,depth,mat)
 if bolts:
  for i,p in enumerate(pts):
   q=pts[(i+1)%len(pts)];length=(q-p).length;count=max(1,int(length/1.65))
   for j in range(count+1):
    a=p.lerp(q,j/count)*.975+c*.025+n*(depth+.025)
    tube(a-n*.005,a+n*.025,.115,steel,8)
    tube(a+n*.025,a+n*.083,.075,alloy,6)
   for t in ([.19,.83] if random.random()<.35 else []):
    a=p.lerp(q,t)+n*(depth+.004);b=p.lerp(q,min(.97,t+random.uniform(.03,.13)))+n*(depth+.004)
    mid=(a+b)/2;poly([a,b,mid*.975+c*.025+n*.012],steel if t<.7 else alloy)
   # Local abrasion trails below a few seam fasteners, physically on each plate.
   for t in ([.27] if random.random()<.3 else []):
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

# Discovery: X is the long axis, Y up, sphere forward (+X).
# Sphere panels are curved, closed-shell pieces, not a tiled flat approximation.
C=Vector((50.4,0,0));R=12.1

def sph(theta,phi,r=R):
 return C+Vector((r*math.sin(theta)*math.cos(phi),r*math.cos(theta),r*math.sin(theta)*math.sin(phi)))

def patch(t0,t1,p0,p1,mat,r=R):
 ns=4;nt=4;group='sphere-'+mat
 for j in range(nt):
  a=t0+(t1-t0)*j/nt;b=t0+(t1-t0)*(j+1)/nt
  for k in range(ns):
   c=p0+(p1-p0)*k/ns;d=p0+(p1-p0)*(k+1)/ns
   poly([sph(a,c,r),sph(b,c,r),sph(b,d,r),sph(a,d,r)],mat,group,[(k/ns,j/nt),(k/ns,(j+1)/nt),((k+1)/ns,(j+1)/nt),((k+1)/ns,j/nt)])
 # Slightly recessed seam edges, smooth curved armor surface.
 for edge in [t0,t1]:
  for k in range(ns):
   c=p0+(p1-p0)*k/ns;d=p0+(p1-p0)*(k+1)/ns
   poly([sph(edge,c,r),sph(edge,d,r),sph(edge,d,r-.025),sph(edge,c,r-.025)],mat,group)
 for edge in [p0,p1]:
  for k in range(nt):
   c=t0+(t1-t0)*k/nt;d=t0+(t1-t0)*(k+1)/nt
   poly([sph(c,edge,r),sph(d,edge,r),sph(d,edge,r-.025),sph(c,edge,r-.025)],mat,group)

# Continuous dark sphere under the ivory armor. Every latitude panel varies subtly.
for j in range(16):
 t0=max(.0001,j*math.pi/16);t1=min(math.pi-.0001,(j+1)*math.pi/16)
 for k in range(32):
  p0=k*math.tau/32;p1=(k+1)*math.tau/32
  patch(t0,t1,p0,p1,steel,R-.035)
  # Cockpit slit is on the front hemisphere, just below equator.
  window=(j==6 and (k<7 or k>25))
  patch(t0+.0025,t1-.0025,p0+.0015,p1-.0015,glass if window else random.choice(ivory),R)
  for t,p in [(t0+.026,p0+.018),(t1-.026,p1-.018)]:
   q=sph(t,p,R+.036);n=(q-C).normalized();tube(q,q+n*.04,.055,alloy,6)
  if window and k==3:
   q=sph((t0+t1)/2,(p0+p1)/2,R+.05);n=(q-C).normalized();tube(q,q+n*.12,.14,warm,8)


for k in list(range(7))+list(range(26,32)):
 p=k*math.tau/32
 patch(6*math.pi/16,7*math.pi/16,p-.008,p+.008,alloy,R+.045)
 patch(6*math.pi/16-.006,6*math.pi/16+.006,p,p+math.tau/32,steel,R+.045)
 patch(7*math.pi/16-.006,7*math.pi/16+.006,p,p+math.tau/32,steel,R+.045)

for k in list(range(7))+list(range(26,32)):
 p=k*math.tau/32
 patch(6*math.pi/16,6*math.pi/16+.06,p+.003,p+math.tau/32-.003,ivory[1],R+.03)
 patch(7*math.pi/16-.038,7*math.pi/16,p+.003,p+math.tau/32-.003,ivory[1],R+.03)
# Surface-conforming circular pod doors on lower front quadrant.
for angle in [.35,1.0,1.65]:
 theta=1.80;n=Vector((math.sin(theta)*math.cos(angle),math.cos(theta),math.sin(theta)*math.sin(angle)))
 u=Vector((-math.sin(angle),0,math.cos(angle)));v=n.cross(u)
 centre=C+n*R
 for j in range(64):
  a=j*math.tau/64;b=(j+1)*math.tau/64
  for r0,r1,mat in [(0,2.43,ivory[1]),(2.43,2.47,steel),(2.47,2.51,alloy)]:
   pts=[]
   for r,t in [(r0,a),(r1,a),(r1,b),(r0,b)]:
    q=(n*R+u*(r*math.cos(t))+v*(r*math.sin(t))).normalized()*(R+.052)+C;pts.append(q)
   if r0==0:pts=pts[1:]+[C+n*(R+.052)]
   poly(pts,mat)
 for sign in [-1,1]:
  q=(n*R+u*sign*1.65).normalized()*(R+.1)+C;tube(q,q+n*.08,.13,steel,8)
 tube(centre+n*.08,centre+n*.14,.3,steel,12)

# Long dark keel and four visible plumbing runs.
tube((-53,0,0),(39,0,0),1.45,steel,24)
for y,z in [(-1.8,-1.8),(-1.8,1.8),(1.8,-1.8),(1.8,1.8)]:
 tube((-52,y,z),(39,y,z),.37,alloy,12)
 for x in range(-51,39,3):tube((x-.15,y,z),(x+.15,y,z),.46,orange if x%9==0 else steel,12)

# Octagonal service canisters, chamfered and plated in eight repeating stations.
def ring(x,w,h):
 pts=[]
 corners=[(1,.43),(.43,1),(-.43,1),(-1,.43),(-1,-.43),(-.43,-1),(.43,-1),(1,-.43)]
 for i,(yy,zz) in enumerate(corners):
  yn,zn=corners[(i+1)%8]
  for j in range(3):
   t=j/3;pts.append(Vector((x,h*(yy+(yn-yy)*t),w*(zz+(zn-zz)*t))))
 return pts

def module(x,length,w,h):
 # Rounded rectangular shell built from multiple axial sections, narrowing into collars.
 rows=[(-.5,.82),(-.42,1),(.42,1),(.5,.82)]
 for (fa,sa),(fb,sb) in zip(rows,rows[1:]):
  a=ring(x+length*fa,w*sa,h*sa);b=ring(x+length*fb,w*sb,h*sb)
  subdivisions=max(1,int(length*(fb-fa)/1.8))
  for i in range(24):
   j=(i+1)%24
   n=(a[j]-a[i]).cross(b[i]-a[i]).normalized();mid=(a[i]+a[j]+b[i]+b[j])/4
   if n.dot(Vector((0,mid.y,mid.z)))<0:n=-n
   for k in range(subdivisions):
    f=k/subdivisions;g=(k+1)/subdivisions
    plate([a[i].lerp(b[i],f),a[j].lerp(b[j],f),a[j].lerp(b[j],g),a[i].lerp(b[i],g)],random.choice(ivory),n,.045,bolts=(i%2==0))
 for end in [-1,1]:
  xx=x+end*length*.5;outer=ring(xx,w*.82,h*.82);inner=ring(xx,.98,1.05)
  for i in range(24):
   j=(i+1)%24
   plate([outer[i],outer[j],inner[j],inner[i]],steel,(end,0,0),.08)
   q=outer[i]*.84+inner[i]*.16;qq=outer[j]*.84+inner[j]*.16
   tube(q,qq,.18,orange,8)
   q2=outer[i]*.6+inner[i]*.4;qq2=outer[j]*.6+inner[j]*.4
   tube(q2,qq2,.12,alloy,8)
   if i%3==0:
    tube(inner[i],outer[i]*.8+inner[i]*.2,.12,alloy,8)
    p=outer[i]*.65+inner[i]*.35
    tube(p,p+Vector((end*.25,0,0)),.20,orange,10)
 for side in [-1,1]:
  box((x,0,side*(w+.045)),(length*.53,1.2,.1),steel)
  for j in range(15):box((x-length*.26+j*length*.037,0,side*(w+.11)),(.055,1.08,.1),alloy)
  for y in [-.72,.72]:box((x,y,side*(w+.13)),(length*.61,.12,.1),steel)

for x in [-31,-19,-7,5,17,29]:module(x,9.8,3.55,3.9)
module(37,1.1,2.6,2.8)
# The narrow neck visibly penetrates the sphere.
tube((34,0,0),(40,0,0),2.4,steel,24)
for x in [35,37,38.5]:tube((x-.16,0,0),(x+.16,0,0),2.7,orange,24)

# Deep reactor hull: an octagonal box with a segmented shell.
module(-55,19,7.1,7.8)
for z in [-7.35,7.35]:
 box((-55,0,z),(8.1,8.4,.2),steel)
 box((-55,0,z*1.025),(7.5,7.9,.2),black)
 for i in range(25):box((-55,-3.8+i*.31,z*1.045),(7.4,.10,.3),alloy)
 for x in [-59.1,-55,-50.9]:box((x,0,z*1.06),(.18,8.5,.25),steel)
for x in [-61,-55,-49]:
 for z in [-2.5,2.5]:radiator(x,8.05,z,2.6,3.1)
# Three hollow engine bells; rings and nested interior rather than solid caps.
for y,z in [(3.1,-3.2),(3.1,3.2),(-3.2,0)]:
 tube((-65,y,z),(-67,y,z),1.38,orange,24)
 for a,b,r0,r1 in [(-66,-68,1.35,1.55),(-68,-71,1.55,2.12),(-71,-71.4,2.12,2.12)]:
  for j in range(40):
   c=j*math.tau/40;d=(j+1)*math.tau/40
   poly([(a,y+r0*math.cos(c),z+r0*math.sin(c)),(a,y+r0*math.cos(d),z+r0*math.sin(d)),(b,y+r1*math.cos(d),z+r1*math.sin(d)),(b,y+r1*math.cos(c),z+r1*math.sin(c))],alloy)
   poly([(b,y+(r1-.16)*math.cos(c),z+(r1-.16)*math.sin(c)),(b,y+(r1-.16)*math.cos(d),z+(r1-.16)*math.sin(d)),(a,y+(r0-.16)*math.cos(d),z+(r0-.16)*math.sin(d)),(a,y+(r0-.16)*math.cos(c),z+(r0-.16)*math.sin(c))],steel)
 tube((-67.2,y,z),(-67.25,y,z),1.1,black,32)
 for x,r in [(-68,1.62),(-70.8,2.14)]:
  for j in range(40):
   c=j*math.tau/40;d=(j+1)*math.tau/40;tube((x,y+r*math.cos(c),z+r*math.sin(c)),(x,y+r*math.cos(d),z+r*math.sin(d)),.085,steel,6)
# Triangulated dish mast and concave bowl.
cable([(32,3.8,0),(29,11,0)],.33,steel)
cable([(34,3.8,0),(29,11,0)],.18,alloy)
for y in [5,6.5,8,9.5]:tube((31.7-(y-5)*.39,y,-.35),(31.7-(y-5)*.39,y,.35),.08,orange,8)
dc=Vector((28.8,11,0));normal=Vector((-.55,.83,.10)).normalized();u=normal.cross(Vector((0,0,1))).normalized();v=normal.cross(u)
for j in range(48):
 a=j*math.tau/48;b=(j+1)*math.tau/48
 for k in range(8):
  r0=k*.51;r1=(k+1)*.51
  pts=[dc+u*r*math.cos(t)+v*r*math.sin(t)+normal*(r*r*.095) for r,t in [(r0,a),(r1,a),(r1,b),(r0,b)]]
  if k==0:pts=pts[1:]
  poly(pts,ivory[j%3])
 if j%6==0:
  cable([dc+u*r*math.cos(a)+v*r*math.sin(a)+normal*(r*r*.095-.04) for r in [0,1,2,3,4.08]],.06,steel)
for a in [0,math.tau/3,math.tau*2/3]:tube(dc+u*4*math.cos(a)+v*4*math.sin(a)+normal*1.2,dc+normal*3,.055,steel,8)
tube(dc+normal*2.8,dc+normal*3.15,.18,alloy,12)
# Layered mechanical fittings around every canister rather than plain black caps.
for x in [-31,-19,-7,5,17,29]:
 for end in [-1,1]:
  xx=x+end*5.2
  for y,z in [(2.4,2.65),(-2.4,2.65),(2.4,-2.65),(-2.4,-2.65)]:
   box((xx,y,z),(.48,1.4,1.3),orange)
   tube((xx-end*.30,y,z),(xx+end*.40,y,z),.40,steel,12)
   tube((xx+end*.41,y,z),(xx+end*.51,y,z),.23,alloy,8)
  for y,z in [(0,2.1),(0,-2.1),(2.1,0),(-2.1,0)]:
   tube((xx,y,z),(xx+end*1.3,y,z),.48,steel,16)
   for d in [.25,.8,1.2]:tube((xx+end*(d-.07),y,z),(xx+end*(d+.07),y,z),.59,alloy,16)
 for side in [-1,1]:
  # Fastened service face insert in dark metal, multiple inset rails.
  zz=side*3.7
  for dx in [-2.1,2.1]:
   box((x+dx,0,zz),(1.3,2.35,.13),steel)
   box((x+dx,0,zz+side*.08),(.96,1.98,.09),alloy)
   for yy in [-.8,.8]:tube((x+dx,yy,zz+side*.12),(x+dx,yy,zz+side*.20),.075,orange,6)
  cable([(x-2.8,2.0,zz),(x-2.5,2.5,zz),(x+2,2.5,zz)],.1,steel)
 hatch(x,4.08,0,3.1,2.8)
# Rear neck carries many overlapping cylinders, flanges and a protective rail.
for z in [-2.8,2.8]:
 for y in [-1.4,1.4]:
  tube((-46,y,z),(-36,y,z),.53,steel,16)
  for x in [-45,-42,-39,-36]:tube((x-.18,y,z),(x+.18,y,z),.68,alloy,16)
for z in [-3.6,3.6]:
 tube((-46,3.2,z),(-35,3.2,z),.16,alloy,10)
 tube((-46,-3.2,z),(-35,-3.2,z),.16,alloy,10)
# Reactor corner armor, concentric service collars and anchored steel conduits.
for x in [-63.7,-46.2]:
 for y,z in [(5.8,5.4),(-5.8,5.4),(5.8,-5.4),(-5.8,-5.4)]:
  box((x,y,z),(.65,1.8,1.7),orange)
  box((x+.1,y,z),(1.45,1.5,1.3),steel)
  tube((x-.8,y,z),(x+.8,y,z),.45,alloy,12)
 for r in [2.2,2.9,3.3]:
  for j in range(32):
   a=j*math.tau/32;b=(j+1)*math.tau/32
   tube((x,r*math.cos(a),r*math.sin(a)),(x,r*math.cos(b),r*math.sin(b)),.17,alloy,8)
for x in [-61,-49]:
 for side in [-1,1]:
  cable([(x,6.2,side*5.1),(x,8.2,side*4.3),(x+2,8.2,side*4.3)],.22,steel)
  box((x,4.9,side*6.9),(.85,1.45,.22),steel)
  box((x,4.9,side*7.04),(.2,.9,.08),warm)
# Sparse surface access hatches, edge scuffs and individual fastener stains on sphere.
for theta,phi in [(1.15,1.1),(1.65,1.15),(.75,1.5),(1.3,.3),(2.4,.65)]:
 patch(theta-.045,theta+.045,phi-.04,phi+.04,steel,R+.06)
 patch(theta-.036,theta+.036,phi-.03,phi+.03,ivory[0],R+.08)
for j in range(140):
 theta=random.uniform(.25,2.85);phi=random.uniform(0,math.tau)
 # Tiny restrained abrasion islands seated on the sphere, avoiding glass.
 if 1.57<theta<1.78 and (phi<1.38 or phi>5.05):continue
 pts=[sph(theta,phi,R+.032),sph(theta+.003,phi+.002,R+.032),sph(theta+.012,phi+.001,R+.032)]
 poly(pts,alloy)


# Localized, irregular oxidation stains at panel fasteners. Curved decals stay on the armor.
for j in range(1,15):
 for k in range(32):
  for edge in [0,1]:
   if random.random()<.55:continue
   t=j*math.pi/16+(.025 if edge==0 else .165);p=k*math.tau/32+(.018 if edge==0 else .177)
   if 6*math.pi/16<t<7*math.pi/16 and (k<7 or k>25):continue
   w=random.uniform(.007,.017);h=random.uniform(.008,.027)
   pts=[sph(t+dy*h*random.uniform(.7,1.3),p+dx*w*random.uniform(.7,1.3),R+.038) for dx,dy in [(-.8,-.4),(.3,-.65),(1,.1),(.55,.75),(.16,1.8),(-.45,.75),(-1,.05)]]
   poly(pts,rust)
   q=sph(t,p,R+.043);n=(q-C).normalized();tube(q,q+n*.028,.075,alloy,6)
   if random.random()<.45:
    pts=[sph(t+.008,p+.008,R+.04),sph(t+.032,p+.012,R+.04),sph(t+.055,p+.006,R+.04)]
    poly(pts,chip)
# More asymmetrical service access panels on the sphere, each with its own inset.
for t,p in [(1.02,.75),(1.42,1.68),(2.2,1.4),(.65,.8),(1.65,.6),(2.0,2.1),(.9,2.0),(1.2,2.4)]:
 patch(t-.060,t+.060,p-.041,p+.041,steel,R+.065)
 patch(t-.046,t+.046,p-.032,p+.032,ivory[0],R+.08)
 patch(t-.025,t+.025,p-.015,p+.015,chip,R+.085)
# Industrial collars have secondary hydraulic lines and their own retention fasteners.
for x in [-31,-19,-7,5,17,29]:
 for end in [-1,1]:
  xx=x+end*5.25
  for i in range(12):
   a=i*math.tau/12;y=2.3*math.cos(a);z=2.3*math.sin(a)
   tube((xx,y,z),(xx+end*1.5,y,z),.14,orange if i%3==0 else alloy,10)
   for dd in [.25,.65,1.1]:tube((xx+end*(dd-.035),y,z),(xx+end*(dd+.035),y,z),.22,steel,8)
  for side in [-1,1]:
   cable([(xx,2.6,side*2.2),(xx+end*.7,3.0,side*2.4),(xx+end*1.8,2.5,side*2.3)],.12,steel)
 for side in [-1,1]:
  z=side*3.68
  for dx in [-2.65,2.65]:
   box((x+dx,1.35,z),(.8,.85,.17),ivory[0])
   box((x+dx,1.35,z+side*.11),(.46,.46,.08),steel)
   for yy in [.1,.65,1.1]:box((x+dx,yy-1.2,z),(.65,.10,.18),alloy)
  for yy in [-2,2]:
   cable([(x-2.1,yy,z),(x-1.8,yy+.3,z+side*.18),(x-.8,yy+.3,z+side*.18)],.085,alloy)
# Aft roof pipes have bends and mounted valve units, not three dominating slab radiators.
for z in [-4.7,0,4.7]:
 cable([(-63,6.9,z),(-61.5,8.1,z),(-48,8.1,z),(-46,6.5,z)],.18,alloy)
 for x in [-60,-56,-51]:
  box((x,8.25,z),(.5,.45,.8),steel)
  tube((x,8.2,z),(x,8.65,z),.22,orange,10)


# A small number of working lamps are rooted in real fittings.
for x in [-43,-13,23,35]:
 for side in [-1,1]:
  box((x,1.5,side*2.5),(.5,.55,.38),steel)
  box((x,1.5,side*2.72),(.24,.40,.06),warm)


# Densely serviced aft keel: trunk sleeves, multiple pipe diameters and mounting rings.
tube((-46,0,0),(-35,0,0),2.03,steel,32)
for x in [-45.6,-44.4,-43.2,-42,-40.8,-39.6,-38.4,-37.2,-36]:
 tube((x-.10,0,0),(x+.10,0,0),2.13,alloy,32)
for i in range(10):
 a=i*math.tau/10;y=2.3*math.cos(a);z=2.3*math.sin(a)
 tube((-46,y,z),(-35,y,z),.23 if i%2 else .34,alloy if i%3 else orange,12)
 for x in [-45,-43,-40,-37]:tube((x-.08,y,z),(x+.08,y,z),.40 if i%2 else .48,steel,12)
for x in [-44,-39,-36]:
 for side in [-1,1]:
  box((x,0,side*2.9),(1.3,2.6,.5),steel)
  box((x,0,side*3.18),(.8,1.8,.08),alloy)
  for yy in [-.7,.7]:tube((x,yy,side*3.21),(x,yy,side*3.29),.14,orange,8)
# Narrow segmented corner plates with steel inserts and obvious fasteners.
for x in [-63.7,-46.2]:
 for y in [-5.8,5.8]:
  for side in [-1,1]:
   z=side*6.3
   box((x,y,z),(.85,1.35,.11),steel)
   for yy in [y-.44,y+.44]:
    tube((x,yy,z),(x,yy,z+side*.12),.16,alloy,8)
   box((x,y,z+side*.12),(.36,.10,.08),orange)


# Triangulated communication mast, with depth rather than a single flat support.
for z in [-.35,.35]:
 tube((32,3.8,z),(29,11,z),.16,steel,10)
 tube((34,3.8,z),(29,11,z),.12,alloy,10)
for y in [5,7,9]:
 xx=32-(y-3.8)*3/7.2
 tube((xx,y,-.35),(xx,y,.35),.10,alloy,8)
 tube((xx,y,-.35),(xx-.65,y+1.5,.35),.08,steel,8)

# Dish mast equipment and a more legible lattice on both sides.
for z in [-.45,.45]:
 for y in [4.5,5.7,6.9,8.1,9.3]:
  x=32-(y-3.8)*3/7.2
  tube((x,y,z),(x+.6,y,z),.07,alloy,8)
  tube((x,y,z),(x+.1,y+1.1,z),.075,orange,8)
box((32,4.2,0),(1.5,1.3,1.4),steel)
box((32,4.3,.8),(.8,.65,.25),alloy)
lamp(32,4.4,.98)
# Broad concentric reactor interfaces and radial service connections.
for x in [-46,-45.5,-44.9]:
 for r in [3.4,4.0,4.65,5.2]:
  for j in range(32):
   a=j*math.tau/32;b=(j+1)*math.tau/32
   tube((x,r*math.cos(a),r*math.sin(a)),(x,r*math.cos(b),r*math.sin(b)),.10,orange if r==4.65 else alloy,8)
for j in range(16):
 a=j*math.tau/16;y=4.4*math.cos(a);z=4.4*math.sin(a)
 tube((-46,y,z),(-43,2.5*math.cos(a),2.5*math.sin(a)),.23,steel,10)
 tube((-46,y,z),(-45.6,y,z),.36,alloy,12)

def proportions(x,y,z):
 if x < -45:
  return (x+(x+45)*.29,y*.9,z)
 if x < -36:
  return (x+(x+45)*3.5/9,y*(.9+.1*(x+45)/9),z)
 if x < 35:
  return (-32.5+(x+36)*64/71,y,z)
 if x < 39:
  return (31.5+(x-35)*7.5/4,y,z)
 return (x,y,z)

objects=[]
for name,(verts,faces,uvs) in BATCH.items():
 verts=[proportions(x,y,z) for x,y,z in verts]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.materials.append(MATS[GROUP_MAT[name]]);mesh.update()
 uv=mesh.uv_layers.new(name='surface-metres')
 for face,coords in zip(mesh.polygons,uvs):
  for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=xy
 # Weld each solid's coincident face corners before beveling; isolated face
 # islands cannot form the rounded machined edges the authored solids need.
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
 
 for face in mesh.polygons:face.use_smooth=True
 ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);objects.append(ob)
 if name.startswith('sphere-'):
  mesh.normals_split_custom_set_from_vertices([(v.co-C).normalized() for v in mesh.vertices])
  continue
 if GROUP_MAT[name] in blue+ivory:
  bevel=ob.modifiers.new('machined-edge-radius','BEVEL');bevel.width=.022;bevel.segments=2
  normal=ob.modifiers.new('weighted-panel-normals','WEIGHTED_NORMAL');normal.keep_sharp=True
 else:
  normal=ob.modifiers.new('weighted-surface-normals','WEIGHTED_NORMAL');normal.keep_sharp=True
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'discovery.blend'))
glb=OUT/'discovery.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=False,export_apply=True,export_materials='EXPORT')
# Preserve authored multiplicative tints through the glTF exporter.
data=glb.read_bytes();jl=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+jl])
for m in doc['materials']:
 if 'baseColorTexture' in m.get('pbrMetallicRoughness',{}):m['pbrMetallicRoughness']['baseColorFactor']=list(MATS[m['name']].diffuse_color)
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);tail=data[20+jl:]
glb.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+tail)
print('DISCOVERY_EXPORTED',str(glb),glb.stat().st_size)
