"""O4 courier exterior study. Blender --background --python this_file.py.
Metres, Y up, +Z forward. Material-batched authored geometry; seeded detail.
"""
import bpy, bmesh, math, random, json, struct, sys
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent
sys.path.insert(0,str(OUT))
from adapt_cockpit import append_adapted_cockpit
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

blue=[material('blue-grey-'+str(i),(.09+i*.009,.145+i*.010,.20+i*.012),.55,.38+i*.018) for i in range(4)]
ivory=[material('pale-steel-'+str(i),(.32+i*.018,.345+i*.018,.355+i*.018),.52,.39+i*.02) for i in range(3)]
steel=material('dark-structure',(.057,.071,.077),.76,.43)
black=material('recess-black',(.012,.019,.023),.42,.62)
alloy=material('machined-alloy',(.39,.42,.45),.86,.28)
rail=material('brushed-rail',(.17,.205,.23),.72,.50)
rubber=material('hose-rubber',(.023,.027,.029),.08,.78)
orange=material('service-ochre',(.55,.29,.10),.37,.58)
warm=material('amber-lamp',(1,.17,.018),.2,.23,2.4,False)
cyan=material('cyan-display',(.025,.55,.66),.15,.32,1.7,False)
glass=material('canopy-glass',(.027,.085,.105),.015,.28,0,False,.38)
MATS[glass].node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.08
pilot_suit=material('pilot-suit',(.27,.32,.32),.04,.82,texture=False)
pilot_helmet=material('pilot-helmet',(.34,.37,.36),.18,.36,texture=False)
pilot_visor=material('pilot-visor',(.07,.10,.11),.45,.15,texture=False)
pilot_trim=material('pilot-harness',(.55,.24,.065),.04,.75,texture=False)
pilot_gloves=material('pilot-gloves-boots',(.045,.055,.06),.02,.84,texture=False)

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

def ellipsoid(c,r,mat):
 c=Vector(c);sides=20;latitudes=12
 rings=[[c+Vector((r[0]*math.sin(j*math.pi/latitudes)*math.cos(i*math.tau/sides),r[1]*math.cos(j*math.pi/latitudes),r[2]*math.sin(j*math.pi/latitudes)*math.sin(i*math.tau/sides))) for i in range(sides)] for j in range(1,latitudes)]
 for a,b in zip(rings,rings[1:]):
  for i in range(sides):
   k=(i+1)%sides;poly([a[i],a[k],b[k],b[i]],mat)
 for i in range(sides):
  k=(i+1)%sides
  poly([c+Vector((0,r[1],0)),rings[0][k],rings[0][i]],mat)
  poly([c-Vector((0,r[1],0)),rings[-1][i],rings[-1][k]],mat)

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

def hatch(x,y,z,w=2.2,d=2.8,*,surface,seat_group):
 starts={key:len(data[0]) for key,data in BATCH.items()}
 box((x,y+.07,z),(w,.14,d),steel,group=seat_group)
 box((x,y+.16,z),(w-.16,.09,d-.16),blue[1])
 for dx in [-w*.38,w*.38]:
  for dz in [-d*.36,d*.36]:box((x+dx,y+.24,z+dz),(.13,.13,.3),alloy)
 cable([(x-.3,y+.22,z),(x-.3,y+.35,z),(x+.3,y+.35,z),(x+.3,y+.22,z)],.055)
 # Seat the entire fitting, including its lid and latch, on the local skin.
 # Its base is inset; the lid and handle remain visibly raised. Mapping each
 # vertex follows both deck pitch and cross-slope rather than a centre height.
 for key,data in BATCH.items():
  for i in range(starts.get(key,0),len(data[0])):
   vx,vy,vz=data[0][i];data[0][i]=(vx,surface(vx,vz)-.02+(vy-y)*.8,vz)

def radiator(x,y,z,w,d,surface=None):
 starts={key:len(data[0]) for key,data in BATCH.items()}
 box((x,y,z),(w,.23,d),steel);box((x,y+.14,z),(w-.22,.07,d-.22),black)
 for i in range(int(d/.23)):
  zz=z-d/2+.18+i*.23;box((x,y+.23,zz),(w-.34,.1,.065),alloy)
 for xx in [x-w/2+.06,x+w/2-.06]:box((xx,y+.24,z),(.09,.14,d),steel)
 if surface:
  # Keep the grille's depth while seating its underside into the local skin.
  for key,data in BATCH.items():
   for i in range(starts.get(key,0),len(data[0])):
    vx,vy,vz=data[0][i];data[0][i]=(vx,surface(vx,vz)+.095+vy-y,vz)

def lamp(x,y,z,orient='front'):
 if orient=='top':
  box((x,y,z),(.8,.18,.37),steel);box((x,y+.1,z),(.52,.05,.19),warm)
 else:
  box((x,y,z),(.75,.43,.21),steel);box((x,y,z+.13),(.5,.19,.05),warm)

# Central pressure hull: a broad low body tapering all the way to the needle prow.
stations=[(-25,8.8,1.7,-3.0),(-21,10.4,2.65,-3.8),(-14,10.6,3.1,-4.1),(-7,9.3,3.2,-4.0),(0,8.5,3.3,-3.8),(7,7.6,3.25,-3.6),(14,6.5,2.75,-3.2),(21,4.95,1.9,-2.6),(28,2.7,1.05,-1.7),(33,.68,.25,-.65)]
def sample(z):
 for a,b in zip(stations,stations[1:]):
  if a[0]<=z<=b[0]:
   t=(z-a[0])/(b[0]-a[0]);return tuple(a[i]+(b[i]-a[i])*t for i in range(1,4))
 return stations[-1][1:]
def ring(z,w,top,bottom):
 height=top-bottom;upper=top-min(1.4,height*.28);lower=bottom+min(1.1,height*.22)
 return [Vector((x,y,z)) for x,y in [(-w*.82,top),(w*.82,top),(w,upper),(w,lower),(w*.76,bottom),(-w*.76,bottom),(-w,lower),(-w,upper)]]
rs=[ring(*s) for s in stations]
def deck_y(y,f):return y+.72*(1-(abs(f)/.82)**2)
def body_skin(x,z):
 w,y,_=sample(z)
 # Match the actual faceted plate strips, not the ideal curved crown.
 fractions=[-.82,-.45,-.17,.17,.45,.82];f=x/w
 for a,b in zip(fractions,fractions[1:]):
  if a<=f<=b:return deck_y(y,a)+(deck_y(y,b)-deck_y(y,a))*(f-a)/(b-a)+.09
 return deck_y(y,f)+.09
for a,b in zip(rs,rs[1:]):
 for j in range(1,8):
  k=(j+1)%8;pts=[a[j],a[k],b[k],b[j]];n=(pts[1]-pts[0]).cross(pts[2]-pts[0]).normalized();c=sum(pts,Vector())/4
  # Ring order is clockwise viewed from bow: reverse lateral patches to face outward.
  if n.dot(Vector((c.x,c.y,0)))<0:pts.reverse();n=-n
  plate(pts,random.choice(blue),n,.09)
 # The decorative plates are separated by seams; a continuous pressure shell
 # beneath them must close the body independently of all surface equipment.
shell=[]
for z in sorted(set([s[0] for s in stations]+[6.49,6.5,23,23.01])):
 w,top,bottom=sample(z)
 outline=ring(z,w,top,bottom)
 crown=[]
 for f in [-.82,-.45,-.17,.17,.45,.82]:
  y=1.82 if 6.5<=z<=23 and abs(f)<=.45 else deck_y(top,f)-.025
  crown.append(Vector((w*f,y,z)))
 shell.append(crown+outline[2:])
for a,b in zip(shell,shell[1:]):
 for j in range(len(a)):
  k=(j+1)%len(a);poly([a[j],a[k],b[k],b[j]],steel,'pressure-hull')
poly(shell[0],steel,'pressure-hull');poly(list(reversed(shell[-1])),steel,'pressure-hull')
# The stern is an armoured bulkhead with recessed access panels and heat vents.
plate(shell[0],blue[1],(0,0,-1),.15)
for side in [-1,1]:
 box((side*4.9,-.45,-25.22),(4.3,2.75,.22),steel)
 box((side*4.9,-.45,-25.36),(3.95,2.4,.12),blue[2])
 for y in [-1.35,.45]:
  for dx in [-1.6,1.6]:tube((side*4.9+dx,y,-25.44),(side*4.9+dx,y,-25.57),.1,alloy,8)
 box((side*2.15,.12,-25.45),(.35,2.0,.36),steel)
 box((side*2.15,.12,-25.65),(.16,1.55,.05),warm)
 for x in [side*7.6,side*6.9]:
  cable([(x,-1.9,-25.28),(x,-1.9,-25.58),(x,1.05,-25.58),(x,1.05,-25.28)],.1,alloy)
box((0,-.45,-25.24),(2.8,3.2,.3),black)
for y in [-1.75,-1.4,-1.05,-.7,-.35,0,.35,.7]:
 box((0,y,-25.49),(2.45,.1,.2),alloy)
# Deck plating in individual strips, with a central opening under the canopy.
for za,zb in zip([-25,-21,-17,-13,-9,-5,-1,3,7,11,15,19,23,26,29,33],[-21,-17,-13,-9,-5,-1,3,7,11,15,19,23,26,29,33]):
 wa,ya,_=sample(za);wb,yb,_=sample(zb)
 for fa,fb in [(-.82,-.45),(-.45,-.17),(-.17,.17),(.17,.45),(.45,.82)]:
  if za>=7 and zb<=23 and abs((fa+fb)/2)<.4:continue
  pts=[(wa*fa,deck_y(ya,fa),za),(wa*fb,deck_y(ya,fb),za),(wb*fb,deck_y(yb,fb),zb),(wb*fa,deck_y(yb,fa),zb)]
  mat=ivory[1] if (fa<-.4 and -22<za<-1) or (fa>.4 and -25<za<-13) else blue[random.choice([1,1,2,2,3])]
  plate(pts,mat)
# Swept outer cargo shoulders with individual quadrilateral plates.
for side in [-1,1]:
 rows=[(-24,8.8,15.0),(-20,10.3,16.2),(-16,10.6,15.6),(-12,10.3,14.8),(-8,9.6,13.8),(-4,8.6,12.0),(0,7.6,10.1),(4,7.0,8.0)]
 for (za,ia,oa),(zb,ib,ob) in zip(rows,rows[1:]):
  for fa,fb in [(0,.5),(.5,1)]:
   ya=sample(za)[1]-.55;yb=sample(zb)[1]-.55
   pts=[(side*(ia+(oa-ia)*fa),ya+(1.0-ya)*fa,za),(side*(ia+(oa-ia)*fb),ya+(1.0-ya)*fb,za),(side*(ib+(ob-ib)*fb),yb+(1.0-yb)*fb,zb),(side*(ib+(ob-ib)*fa),yb+(1.0-yb)*fa,zb)]
   prism(pts,(0,-1,0),2.25,steel);plate(pts,ivory[1] if fa>.4 else blue[1])
  plate([(side*oa,.72,za),(side*ob,.72,zb),(side*ob,-1.3,zb),(side*oa,-1.3,za)],blue[0],(side,0,0),.08)
 def shoulder_skin(x,z):
  for (za,ia,oa),(zb,ib,ob) in zip(rows,rows[1:]):
   if za<=z<=zb:
    t=(z-za)/(zb-za);inner=ia+(ib-ia)*t;outer=oa+(ob-oa)*t
    y=sample(z)[1]-.55;f=(abs(x)-inner)/(outer-inner)
    return y+(1-y)*f+.09
  raise ValueError('Hatch outside shoulder')
 for z,x in [(-17,12.0),(-7,10.5)]:hatch(side*x,2.13,z,2.0,2.8,surface=shoulder_skin,seat_group='shoulder-hatch-seats')
 radiator(side*12.8,1.52,-21,2.2,2.1,surface=shoulder_skin)

# Flush dorsal access covers follow both the deck pitch and transverse crown.
# No raised box housings or mounting pedestals: their skins overlap the existing
# armour by a few centimetres and retain only seams, fasteners and inset lamps.
def deck_point(x,z,offset=0):
 w,y,_=sample(z);return Vector((x,deck_y(y,x/w)+offset,z))
for z,l,w in [(-21,6,4.5),(-14.3,6.3,4.3),(-7.4,6.5,4.0),(-1,5.7,3.6),(3.5,3,2.3)]:
 za,zb=z-l/2,z+l/2
 cuts=sorted(set([za,zb]+[s[0] for s in stations if za<s[0]<zb]))
 for aa,bb in zip(cuts,cuts[1:]):
  for xa,xb in [(-w/2,0),(0,w/2)]:
   pts=[deck_point(xa,aa,.055),deck_point(xb,aa,.055),deck_point(xb,bb,.055),deck_point(xa,bb,.055)]
   n=(pts[3]-pts[0]).cross(pts[1]-pts[0]).normalized()
   prism(pts,n,.055,blue[2],"dorsal-access-covers")
 # Border rails and latch bars follow the skin instead of sitting horizontally.
 for x in [-w/2,w/2]:
  cable([deck_point(x,zz,.12) for zz in cuts],.035,steel)
  for dz in [-l*.35,l*.35]:
   p=deck_point(x,z+dz,.12);n=Vector((0,1,0))
   tube(p,p+n*.055,.075,alloy,8)
 for zz in [za,zb]:
  cable([deck_point(x,zz,.12) for x in [-w/2,0,w/2]],.035,steel)
 for zz in [z-.3,z+.3]:
  cable([deck_point(x,zz,.16) for x in [-.25,.25]],.055,alloy)
 # Small service lamps are embedded into the same pitched surface.
 for side in [-1,1]:
  x=side*(w/2-.22)
  pts=[deck_point(x+dx,z+dz,.13) for dx,dz in [(-.07,-.24),(.07,-.24),(.07,.24),(-.07,.24)]]
  poly(list(reversed(pts)),warm)

# Dorsal service assemblies: dark deck-seated beds, linked jacketed pipes,
# elbow returns and shielded valves keep a functional hierarchy around the lids.
for side in [-1,1]:
 for bay,(za,zb) in enumerate([(-22,-17.5),(-16.8,-12),(-11.3,-6.8),(-6.1,-1.6)]):
  x=side*2.85
  # Chamfered mounting tray follows every local deck slope, inset into its skin.
  outline=[(-.57,za-.22),(.57,za-.22),(.68,za+.12),(.68,zb-.12),(.45,zb+.22),(-.45,zb+.22),(-.68,zb-.12),(-.68,za+.12)]
  pts=[(x+dx,body_skin(x+dx,z)-.015,z) for dx,z in outline]
  prism(pts,(0,1,0),.045,black)
  for dx in [-.60,.60]:
   cable([(x+dx,body_skin(x+dx,z)+.055,z) for z in [za+.1,(za+zb)/2,zb-.1]],.035,rail)
  a=Vector((x,body_skin(x,za)+.36,za));b=Vector((x,body_skin(x,zb)+.36,zb))
  tube(a,b,.31,steel,20)
  length=(b-a).length;axis=(b-a).normalized()
  for j in range(int(length/.78)):
   c=a.lerp(b,(j+.5)/int(length/.78))
   tube(c-axis*.30,c+axis*.30,.345,alloy if (j+bay)%3 else rail,20)
  for t in [.06,.94]:
   c=a.lerp(b,t);y=body_skin(c.x,c.z)
   box((c.x,y+.16,c.z),(.92,.35,.26),steel)
   tube(c-axis*.08,c+axis*.08,.405,steel,20)
  # Rounded ends and smaller elbow pipes visibly return into sealed deck sockets.
  for c,direction in [(a,-1),(b,1)]:
   ellipsoid(c,(.31,.31,.20),alloy)
   z=c.z+direction*.37
   cable([c,c+Vector((0,0,direction*.22)),Vector((x,body_skin(x,z)+.18,z)),Vector((x,body_skin(x,z),z))],.12,rail)
   tube((x,body_skin(x,z)-.03,z),(x,body_skin(x,z)+.12,z),.24,steel,16)
  if bay in [0,2]:
   z=(za+zb)/2;yy=body_skin(x,z)+.36
   tube((x,yy,z),(x,yy+.42,z),.12,alloy,16)
   tube((x,yy+.40,z),(x,yy+.49,z),.22,orange,16)
   for dx in [-.38,.38]:
    cable([(x+dx,body_skin(x+dx,z),z-.36),(x+dx,yy+.58,z-.36),(x+dx,yy+.58,z+.36),(x+dx,body_skin(x+dx,z),z+.36)],.04,steel)
 # Slim guarded amber housings sit on the sloped deck beside the duct runs.
 for z in [-20,-13.8,-7.7,-1.8]:
  x=side*3.65;starts={key:len(data[0]) for key,data in BATCH.items()}
  box((x,.14,z),(.58,.32,1.35),steel)
  box((x,.325,z),(.31,.055,.92),warm)
  for dz in [-.52,.52]:box((x,.36,z+dz),(.61,.13,.12),alloy)
  for key,data in BATCH.items():
   for i in range(starts.get(key,0),len(data[0])):
    vx,vy,vz=data[0][i];data[0][i]=(vx,body_skin(vx,vz)+vy-.025,vz)

# Canopy. Four sections form a shallow taper; real interior sits behind tinted panes.
canopy=[(6.5,2.7,4.75,3.45),(10.5,2.65,5.65,3.45),(15,2.35,4.95,3.08),(19.5,1.85,3.85,2.5),(23,1.03,2.4,2.0)]
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
box((0,1.95,14.5),(3.5,.2,15.0),black)
# Seated courier pilot, facing +Z, with hands on paired control grips.
ellipsoid((0,3.0,10.2),(.35,.22,.26),pilot_suit)
ellipsoid((0,3.52,10.1),(.39,.55,.235),pilot_suit)
tube((0,3.96,10.13),(0,4.12,10.14),.14,pilot_gloves,16)
ellipsoid((0,4.3,10.16),(.29,.34,.28),pilot_helmet)
visor=[]
for j in range(7):
 latitude=-.38+j*.74/6
 visor.append([Vector((.295*math.sin(-1.12+i*2.24/16)*math.cos(latitude),4.3+.346*math.sin(latitude),10.16+.286*math.cos(-1.12+i*2.24/16)*math.cos(latitude))) for i in range(17)])
for a,b in zip(visor,visor[1:]):
 for i in range(16):poly([a[i],a[i+1],b[i+1],b[i]],pilot_visor)
for side in [-1,1]:
 hip=(side*.22,3.0,10.22);knee=(side*.24,2.73,11.10);ankle=(side*.24,2.16,11.28)
 tube(hip,knee,.16,pilot_suit,16);ellipsoid(knee,(.17,.17,.18),pilot_suit)
 tube(knee,ankle,.125,pilot_suit,16);ellipsoid((side*.24,2.09,11.39),(.17,.13,.32),pilot_gloves)
 shoulder=(side*.37,3.8,10.13);elbow=(side*.56,3.36,10.70);hand=(side*.47,3.13,11.32)
 ellipsoid(shoulder,(.17,.2,.19),pilot_suit);tube(shoulder,elbow,.13,pilot_suit,16)
 ellipsoid(elbow,(.135,.145,.14),pilot_suit);tube(elbow,hand,.105,pilot_suit,16)
 ellipsoid(hand,(.11,.105,.15),pilot_gloves)
 box((side*.19,3.52,10.335),(.075,.64,.045),pilot_trim)
 box((side*.47,2.99,11.43),(.32,.15,.50),steel)
 tube((side*.47,3.04,11.40),(side*.47,3.18,11.30),.045,pilot_gloves,12)
 tube((side*.47,2.93,10.35),(side*.47,2.93,11.45),.07,steel,12)
box((0,3.15,10.40),(.50,.08,.045),pilot_trim)
box((0,3.15,10.435),(.12,.10,.025),alloy)
box((-.12,3.72,10.355),(.10,.13,.035),pilot_helmet)
for side in [-1,1]:
 # Nose side service conduit follows the taper, hugging the upper chine.
 path=[]
 for z in [2,8,14,20,26,30]:
  w,y,_=sample(z);path.append((side*(w+.05),y-.5,z))
 cable(path,.15,rail)
 for z in [4,10,16,22,28]:
  w,y,_=sample(z);box((side*(w+.06),y-.48,z),(.32,.45,.18),steel)
 lamp(side*1.0,.24,29.4)
 for z in [5,11,17,23,28]:
  w,y,_=sample(z)
  # Side-facing lamp lens and guard mounted into the upper chine.
  xx=side*(w+.08)
  box((xx,y-.64,z),(.32,.42,1.18),steel)
  box((xx+side*.18,y-.64,z),(.055,.16,.78),warm)
  for dz in [-.48,.48]:box((xx+side*.21,y-.64,z+dz),(.1,.46,.1),alloy)
 # Stepped canopy coaming follows the glass perimeter into the pressure hull.
 for aa,bb in zip(canopy,canopy[1:]):
  za,wa,_,ba=aa;zb,wb,_,bbottom=bb
  ha,ya,_=sample(za);hb,yb,_=sample(zb)
  plate([(side*wa,ba,za),(side*(wa+.48),ba+.13,za),(side*(wb+.48),bbottom+.13,zb),(side*wb,bbottom,zb)],steel,depth=.10)
  plate([(side*(wa+.48),ba+.13,za),(side*min(ha*.81,wa+1.35),ya+.12,za),(side*min(hb*.81,wb+1.35),yb+.12,zb),(side*(wb+.48),bbottom+.13,zb)],blue[2],depth=.10)
 for z in [8,13,18]:
  w,y,_=sample(z);radiator(side*w*.58,y+.22,z,1.05,1.5,surface=body_skin)
 # Layered upper and lower side armour with an inset mechanical service belt.
 for za,zb in [(0,4),(4,8),(8,12),(12,16),(16,20),(20,24),(24,28)]:
  wa,ya,ba=sample(za);wb,yb,bb=sample(zb)
  n=Vector((side,0,side*(wa-wb)/(zb-za))).normalized()
  plate([(side*(wa+.09),ya-.88,za),(side*(wb+.09),yb-.88,zb),(side*(wb+.09),yb-1.5,zb),(side*(wa+.09),ya-1.5,za)],blue[1],n,.09)
  plate([(side*(wa+.07),ba+.48,za),(side*(wb+.07),bb+.48,zb),(side*(wb+.07),bb+1.08,zb),(side*(wa+.07),ba+1.08,za)],ivory[0] if za%8==0 else blue[0],n,.07)
  for f in [.18,.7]:
   z=za+(zb-za)*f;w,y,_=sample(z)
   box((side*(w+.25),y-1.75,z),(.24,.46,.8),steel)
   for dz in [-.27,.27]:box((side*(w+.39),y-1.75,z+dz),(.045,.32,.055),alloy)

# Twin nacelles: long octagonal section with chamfered nose and recessed grilles.
def engine_ring(x,z,w,top,bottom):
 return [Vector((x+dx,y,z)) for dx,y in [(-w*.68,top),(w*.68,top),(w*.90,top-.24),(w*.98,top-.66),(w,top-1.24),(w,bottom+1.24),(w*.98,bottom+.66),(w*.90,bottom+.24),(w*.68,bottom),(-w*.68,bottom),(-w*.90,bottom+.24),(-w*.98,bottom+.66),(-w,bottom+1.24),(-w,top-1.24),(-w*.98,top-.66),(-w*.90,top-.24)]]
for side in [-1,1]:
 x=side*21.9;name='engine-port' if side<0 else 'engine-starboard'
 sections=[(-25.5,4.05,2.65,-3.7),(-23.8,5.05,3.45,-4.25),(-20,5.25,3.55,-4.3),(-15,5.25,3.55,-4.3),(-12,5.15,3.4,-4.2),(-11.4,4.55,2.8,-3.6),(-10.2,4.55,2.8,-3.6),(-9.6,5.25,3.55,-4.3),(-4,5.25,3.55,-4.3),(1.5,5.05,3.3,-4.15),(5.5,4.85,2.75,-3.95),(8.1,3.7,1.7,-3.15)]
 er=[engine_ring(x,*r) for r in sections]
 # The backing is named per pod for export assertions and independent selection.
 for a,b in zip(er,er[1:]):
  for j in range(len(a)):
   k=(j+1)%len(a);pts=[a[j],b[j],b[k],a[k]]
   poly(pts,black,name)
   if -11.5<a[j].z<-10:continue
   for fa,fb in ([(0,.5),(.5,1)] if j in [0,4,8,12] else [(0,1)]):
    quad=[a[j].lerp(a[k],fa),b[j].lerp(b[k],fa),b[j].lerp(b[k],fb),a[j].lerp(a[k],fb)]
    c=sum(quad,Vector())/4;n=(quad[1]-quad[0]).cross(quad[2]-quad[0]).normalized()
    if n.dot(Vector((c.x-x,c.y,0)))<0:n=-n
    material_=ivory[1] if (j in [0,1,2,7,8,9,14,15] and a[j].z<1) else blue[1]
    plate(quad,material_,n,.09)
 # True front aperture: deep black end wall with 13 vertical fins, thick surround.
 front=er[-1]
 poly(list(reversed(front)),black,name)
 poly(er[0],black,name)
 # Solid aft firewall fills the corners outside the circular thrust chamber.
 plate(er[0],blue[1],(0,0,-1),.12)
 for j in range(len(er[0])):
  a=er[0][j]+Vector((0,0,-.17));b=er[0][(j+1)%len(er[0])]+Vector((0,0,-.17))
  tube(a,b,.11,alloy,8)
 for j in range(len(front)):tube(front[j],front[(j+1)%len(front)],.18,alloy,8)
 for dx in [-2.8,-2.33,-1.86,-1.4,-.93,-.47,0,.47,.93,1.4,1.86,2.33,2.8]:
  box((x+dx,-.73,8.05),(.12,3.8,.36),steel)
  box((x+dx,-.73,8.25),(.033,3.8,.05),alloy)
 # Aft circular thrust chamber set into the octagonal engine body.
 # Annular nozzle rolls over a machined lip into a recessed, closed throat.
 # Capped cylinders here used to read as flat discs when seen from astern.
 nozzle=[[(x+r*math.cos(j*math.tau/48),-.38+r*math.sin(j*math.tau/48),z) for j in range(48)]
         for z,r in [(-25.3,3.68),(-27.1,3.65),(-27.7,3.4),(-27.7,2.94),(-25.8,2.34)]]
 for band,(a,b) in enumerate(zip(nozzle,nozzle[1:])):
  for j in range(48):
   k=(j+1)%48;poly([a[j],a[k],b[k],b[j]],alloy if band==2 else steel)
 poly(nozzle[-1],black)
 tube((x,-.38,-25.82),(x,-.38,-26.02),.72,steel,32)
 for j in range(24):
  a=j*math.tau/24
  cable([(x+2.88*math.cos(a),-.38+2.88*math.sin(a),-27.55),(x+2.30*math.cos(a),-.38+2.30*math.sin(a),-25.88)],.055,alloy)
 for j in range(20):
  a=j*math.tau/20
  cable([(x+3.1*math.cos(a),-.38+3.1*math.sin(a),-27.85),(x+3.65*math.cos(a),-.38+3.65*math.sin(a),-27.1)],.085,alloy)
 # Armoured clamp bands around the segment joint and thrust chamber.
 for z in [-23.5,-11.1,-10.3]:
  rr=engine_ring(x,z,5.28,3.59,-4.32)
  for j in range(len(rr)):
   a=rr[j];b=rr[(j+1)%len(rr)];tube(a,b,.16,steel,8)
   for t in [.2,.8]:
    q=a.lerp(b,t);box(q,(.20,.20,.47),alloy)
 for z in [-19,-3.4]:
  radiator(x,3.68,z,3.5,3.0)
  for dx in [-1.91,1.91]:
   cable([(x+dx,3.63,z-1.56),(x+dx,4.15,z-1.56),(x+dx,4.15,z+1.56),(x+dx,3.63,z+1.56)],.07,alloy)
   for dz in [-1.56,1.56]:box((x+dx,3.73,z+dz),(.34,.2,.34),steel)
  for dx in [-3.0,3.0]:hatch(x+dx,3.56,z,1.0,2.1,surface=lambda x,z:3.64,seat_group='nacelle-hatch-seats')
 # Joint-ring cover straps, smaller service boxes, longitudinal edge ribs.
 for dx in [-3.4,3.4]:
  cable([(x+dx,3.46,-22),(x+dx,3.55,-14),(x+dx,3.18,-11),(x+dx,3.55,-7),(x+dx,3.45,1)],.065,alloy)
 for z in [-21,-16,-7,-1,4]:
  for dx in [-4.6,4.6]:
   box((x+dx,2.7,z),(.5,.20,.85),steel)
   for dz in [-.28,.28]:tube((x+dx,2.81,z+dz),(x+dx,2.89,z+dz),.06,alloy,6)
 for z in [-22,-18,-14,-7,-2,3]:
  for dx in [-2.5,2.5]:
   box((x+dx,3.7,z),(.5,.16,.4),steel)
   box((x+dx,3.80,z),(.27,.045,.22),alloy)
 # Attached side vent stacks and warm service lamps.
 for z in [-18,-5,2]:
  xx=x+side*5.35
  box((xx,-.4,z),(.18,2.5,2.7),steel)
  for k in range(12):box((xx+side*.16,-1.35+k*.18,z),(.2,.055,2.25),alloy)
  box((xx+side*.15,1.0,z+1.4),(.25,.5,.6),steel)
  box((xx+side*.30,1.0,z+1.4),(.035,.3,.32),warm)
  for yy in [-1.55,.96]:
   cable([(xx+side*.2,yy,z-1.3),(xx+side*.38,yy,z-1.3),(xx+side*.38,yy,z+1.3),(xx+side*.2,yy,z+1.3)],.07)
 # Outer wall equipment boxes and short lateral service lines break up the slab.
 for z in [-21,-13,-8,-1,5]:
  xx=x+side*5.36
  box((xx,-.25,z),(.28,1.20,.84),steel)
  box((xx+side*.18,-.25,z),(.12,.94,.60),blue[1])
  tube((xx+side*.29,-.25,z),(xx+side*.48,-.25,z),.26,alloy,12)
  tube((xx+side*.49,-.25,z),(xx+side*.50,-.25,z),.17,black,12)
 for yy in [-2.3,1.65]:
  cable([(x+side*5.22,yy,-22),(x+side*5.40,yy,-18),(x+side*5.40,yy,-13)],.105)
  cable([(x+side*5.40,yy,-8),(x+side*5.40,yy,-2),(x+side*5.20,yy,3)],.105)
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
 # Upper tier is visible above the shoulder edge: ribbed hoses and coupled pumps.
 for z in [-19.5,-16.5,-8.5,-5.8,-2]:
  inner=12.6 if z<-10 else 10.6
  cable([(side*inner,1.0,z-1),(side*(inner+.7),1.55,z),(side*16.1,1.55,z),(side*17.2,1.0,z+.7)],.23,rubber)
  for k in range(12):
   xx=inner+.8+(15.9-inner-.8)*k/11
   tube((side*(xx-.038),1.55,z),(side*(xx+.038),1.55,z),.28,alloy,10)
  box((side*(inner+.2),1.15,z-1),(1.0,.8,1.2),steel)
  box((side*(inner+.2),1.61,z-1),(.75,.16,.9),alloy)
 # Long visible flank trunks are supported by the engine-root bridges.
 for xx,yy in [(13.7,2.35),(14.35,2.05),(15.05,1.85)]:
  tube((side*xx,yy,-21),(side*xx,yy,-3),.23,alloy,12)
  for zz in [-20,-17,-14,-11,-8,-5]:
   tube((side*xx,yy,zz-.15),(side*xx,yy,zz+.15),.30,steel,12)
   box((side*xx,yy-.55,zz),(.65,.75,.22),steel)
 for z in [-13,-4]:
  box((side*14.5,.8,z),(1.3,.6,2.4),black)
  for zz in [-.85,-.55,-.25,.05,.35,.65,.95]:box((side*14.5,1.14,z+zz),(1.1,.13,.08),alloy)
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
  if z<6:hatch(xx,deck_y(y,.63)+.14,z,1.5,2.2,surface=body_skin,seat_group='body-hatch-seats')
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
 # Weld each solid's coincident face corners before beveling; isolated face
 # islands cannot form the rounded machined edges the authored solids need.
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
 if name.startswith('pilot-') and name!='pilot-harness':
  for face in mesh.polygons:face.use_smooth=True
 ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);objects.append(ob)
 if GROUP_MAT[name] in blue+ivory:
  bevel=ob.modifiers.new('machined-edge-radius','BEVEL');bevel.width=.075;bevel.segments=2
  normal=ob.modifiers.new('weighted-panel-normals','WEIGHTED_NORMAL');normal.keep_sharp=True
append_adapted_cockpit(OUT,MATS)
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
