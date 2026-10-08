"""Nine approved station studies. Blender authoring, 10 m per unit, Y up.
Source geometry and generated Coriolis texture are retained in each .blend.
Run Blender --background --python build_model.py -- [station ...].
"""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from geometry import *
import geometry as G

rust=material('salvaged-red',(.24,.14,.10),.42,.72)
deckpaint=material('landing-grey',(.105,.12,.12),.40,.69)
ivory[:]=[material('armour-'+str(i),(.55+i*.045,.55+i*.043,.50+i*.039),.38,.68) for i in range(4)]

def frame(c,w,h,depth=1,bar=1,mat=steel):
 x,y,z=c
 for xx in [x-w/2-bar/2,x+w/2+bar/2]:box((xx,y,z),(bar,h+2*bar,depth),mat)
 for yy in [y-h/2-bar/2,y+h/2+bar/2]:box((x,yy,z),(w,bar,depth),mat)

def vent(c,w,h,n=Z,u=X):
 c=Vector(c);n=Vector(n);u=Vector(u);v=n.cross(u)
 box(c,(w,h,.42),steel,(u,v,n));box(c+n*.25,(w-.4,h-.4,.15),black,(u,v,n))
 for i in range(max(2,int(h/.45))):
  box(c+n*.4+v*(-h/2+.3+i*.45),(w-.65,.15,.18),alloy,(u,v,n))

def window_band(c,w,h=.65,n=Z,u=X):
 c=Vector(c);n=Vector(n);u=Vector(u);v=n.cross(u)
 box(c,(w,h+.5,.4),black,(u,v,n))
 for i in range(max(1,int(w/1.25))):
  box(c+u*(-w/2+.55+i*1.25)+n*.23,(.50,h,.12),warm,(u,v,n))

def pipe(a,b,r=.22):
 a,b=Vector(a),Vector(b);tube(a,b,r,alloy,8)
 for t in [0,.15,.42,.72,1]:
  q=a.lerp(b,t);d=(b-a).normalized();tube(q-d*.15,q+d*.15,r*1.4,steel,8)

def truss(a,b,w=3):
 a,b=Vector(a),Vector(b);d=(b-a).normalized();u=d.cross(Y if abs(d.y)<.9 else X).normalized();v=d.cross(u)
 for sx in [-1,1]:
  for sy in [-1,1]:tube(a+u*w*sx/2+v*w*sy/2,b+u*w*sx/2+v*w*sy/2,.23,steel,6)
 count=max(1,int((b-a).length/4))
 for i in range(count):
  aa=a.lerp(b,i/count);bb=a.lerp(b,(i+1)/count)
  for side in [-1,1]:
   tube(aa+u*w*side/2-v*w/2,bb+u*w*side/2+v*w/2,.12,alloy,6)
   tube(aa+v*w*side/2-u*w/2,bb+v*w*side/2+u*w/2,.12,alloy,6)
   tube(aa+u*w*side/2-v*w/2,aa+u*w*side/2+v*w/2,.18,steel,6)

def cylinder(a,b,r,segments=16,rows=4,windows=False):
 a,b=Vector(a),Vector(b);d=(b-a).normalized();u=d.cross(Y if abs(d.y)<.9 else X).normalized();v=d.cross(u)
 length=(b-a).length
 for i in range(segments):
  aa=i*math.tau/segments;bb=(i+1)*math.tau/segments
  n=u*math.cos((aa+bb)/2)+v*math.sin((aa+bb)/2)
  for j in range(rows):
   p=a+(b-a)*j/rows;q=a+(b-a)*(j+1)/rows
   pts=[p+r*(u*math.cos(aa)+v*math.sin(aa)),p+r*(u*math.cos(bb)+v*math.sin(bb)),q+r*(u*math.cos(bb)+v*math.sin(bb)),q+r*(u*math.cos(aa)+v*math.sin(aa))]
   plate(pts,random.choice(ivory),n,.12)
  if i%4==0:
   pipe(a+n*(r+.3),b+n*(r+.3),.16)
  if windows and i%2==0:
   window_band(a.lerp(b,.65)+n*(r+.25),r*.62,.6,n,u if abs(n.dot(u))<.3 else d)
 for t in [0,.08,.47,.90,1]:
  q=a.lerp(b,t);tube(q-d*.26,q+d*.26,r*1.025,steel,segments)

def fascia(c,w,h,n=Z,u=X):
 c=Vector(c);n=Vector(n);u=Vector(u);v=n.cross(u)
 for sign in [-1,1]:
  q=c+u*sign*w*.40
  vent(q+v*h*.15,w*.13,h*.48,n,u)
  window_band(q-v*h*.28,w*.13,.55,n,u)
 for sign in [-1,1]:
  q=c+v*sign*h*.40
  vent(q,w*.35,h*.13,n,u)
  for j in [-1,1]:
   box(q+u*j*w*.33,(w*.09,h*.12,.7),steel,(u,v,n))
   box(q+u*j*w*.33+n*.43,(w*.04,h*.08,.2),white,(u,v,n))
 for j in [-1,1]:
  for k in [-1,1]:
   q=c+u*j*w*.26+v*k*h*.30
   for offset in [-.45,0,.45]:pipe(q+u*offset-v*h*.10,q+u*offset+v*h*.10,.10)

def dock_hub(w=32,h=28,length=32,z=0):
 # Actual open rectangular passage through all faces, 120 x 70 m clear.
 opening_w=12;opening_h=7;front=z+length/2
 for side in [-1,1]:
  plated_box((side*(w+opening_w)/4,0,z),((w-opening_w)/2,h,length),step=7)
  plated_box((0,side*(h+opening_h)/4,z),(opening_w,(h-opening_h)/2,length),step=7)
 frame((0,0,front+.7),12,7,1.5,1.2,steel)
 frame((0,0,front+1.55),12.3,7.3,.6,.3,alloy)
 for zz in [front-1,front-5,front-10,front-17]:
  frame((0,0,zz),12,7,.35,.24,steel)
  for xx in [-5.7,5.7]:
   for yy in [-2.8,2.8]:box((xx,yy,zz),(.12,.3,.5),white)
 for x in [-7.6,7.6]:
  for y in [-2.2,0,2.2]:lamp(x,y,front+1.2)
 for y in [-4.7,4.7]:
  for x in [-4,-2,0,2,4]:box((x,y,front+1.5),(1,.45,.15),orange if int(x)%4 else black)
 for yy in [-h*.35,h*.35]:
  for xx in [-w*.32,0,w*.32]:vent((xx,yy,front+.22),w*.18,h*.14)
 for xx in [-w*.38,w*.38]:
  for yy in [-h*.15,h*.15]:window_band((xx,yy,front+.25),3.2,.65)
 for side in [-1,1]:
  fascia((side*w/2,0,z),length,h,X*side,Z)
 for x in [-w*.3,w*.3]:
  radiator(x,h/2+.3,z,6,length*.55);mast(x,h/2+1,z-length*.3,4)
 return (0,0,front+1.55)

def torus(radius=61,width=12,depth=12,z=0,segments=64,rounded=True):
 cross=[(-width/2+2,-depth/2), (width/2-2,-depth/2),(width/2,-depth/2+2),(width/2,depth/2-2),(width/2-2,depth/2),(-width/2+2,depth/2),(-width/2,depth/2-2),(-width/2,-depth/2+2)]
 if not rounded:cross=[(-width/2,-depth/2),(width/2,-depth/2),(width/2,depth/2),(-width/2,depth/2)]
 for i in range(segments):
  a=i*math.tau/segments;b=(i+1)*math.tau/segments;mid=(a+b)/2
  radial=Vector((math.cos(mid),math.sin(mid),0));tangent=Vector((-math.sin(mid),math.cos(mid),0))
  def p(t,r,zz):return Vector(((radius+r)*math.cos(t),(radius+r)*math.sin(t),z+zz))
  for j,(r,zz) in enumerate(cross):
   rr,zzz=cross[(j+1)%len(cross)];n=radial*(zzz-zz)-Z*(rr-r)
   # Cross-section winding determines exterior normal.
   n=-n.normalized()
   pts=[p(a,r,zz),p(b,r,zz),p(b,rr,zzz),p(a,rr,zzz)]
   plate(pts,steel if i%16 in [0,1] else orange if i%32==7 and j in [1,2] else random.choice(ivory),n,.12)
  front=radial*radius+Z*(z+depth/2+.2)
  if i%4 in [0,1]:window_band(front,(2*math.pi*radius/segments)*.72,.70,Z,tangent)
  elif i%4==2:vent(front,3.6,width*.55,Z,tangent)
  else:
   for rr in [-width*.25,0,width*.25]:
    pipe(radial*(radius+rr)+tangent*-2+Z*(z+depth/2+.25),radial*(radius+rr)+tangent*2+Z*(z+depth/2+.25),.13)
  if i%8==0:
   box(front+Z*.45,(1,1,.4),steel,(tangent,radial,Z));box(front+Z*.70,(.5,.5,.15),white,(tangent,radial,Z))
  if i%8==3:
   q=radial*(radius+width/2+.4)+Z*z
   vent(q,4,depth*.6,radial,tangent)

def ring():
 global OWNER
 port=dock_hub(31,28,26)
 torus(61,14,15,0,64)
 for i in range(4):
  a=i*math.pi/2;n=Vector((math.cos(a),math.sin(a),0))
  cylinder(n*15,n*54,3.2,12,6)
  for r in [17,50,53]:tube(n*(r-.5),n*(r+.5),4.2,steel,16)
 return dict(port=port,axis='z',rotation=True)

def drum():
 # Segmented 84 m-author-unit barrel with long service recesses.
 r=35;start=-52;end=43;N=16
 for i in range(N):
  a=i*math.tau/N;b=(i+1)*math.tau/N;mid=(a+b)/2
  n=Vector((math.cos(mid),math.sin(mid),0));t=Vector((-math.sin(mid),math.cos(mid),0))
  for j in range(10):
   lo=start+j*(end-start)/10;hi=start+(j+1)*(end-start)/10
   pts=[(r*math.cos(aa),r*math.sin(aa),zz) for aa,zz in [(a,lo),(b,lo),(b,hi),(a,hi)]]
   plate(pts,steel if i%4==0 else random.choice(ivory),n,.15)
  if i%4==0:
   for off in [-2.5,0,2.5]:pipe(n*(r+.5)+t*off+Z*start,n*(r+.5)+t*off+Z*end,.40 if off==0 else .2)
   for z in [-35,-10,15,35]:window_band(n*(r+.75)+Z*z,5,.7,n,t)
  else:
   for z in [-32,0,30]:vent(n*(r+.2)+Z*z,5,8,n,t)
 for z in [-52,-47,-5,39,43]:annulus((0,0),z,34,37,2,steel,32)
 # Front has four regions around a true opening, with octagonal silhouette.
 fw=9;fh=5.25
 for i in range(16):
  a=i*math.tau/16;b=(i+1)*math.tau/16
  def inner(t):
   s=min(fw/max(abs(math.cos(t)),1e-7),fh/max(abs(math.sin(t)),1e-7))
   return Vector((s*math.cos(t),s*math.sin(t),45))
  p=Vector((r*math.cos(a),r*math.sin(a),45));q=Vector((r*math.cos(b),r*math.sin(b),45))
  plate([inner(a),p,q,inner(b)],random.choice(ivory),Z,.18)
 frame((0,0,46),18,10.5,2,1.2)
 for z in [44,38,30]:frame((0,0,z),18,10.5,.3,.2)
 for x in [-10.8,10.8]:
  for y in [-2,0,2]:lamp(x,y,47)
 fascia((0,0,45.4),28,23)
 for a in range(8):
  t=a*math.tau/8;n=Vector((math.cos(t),math.sin(t),0));vent(n*26+Z*45.5,3,7,Z,Vector((-math.sin(t),math.cos(t),0)))
 tube((0,0,-54),(0,0,-52),34,steel,32)
 for a in range(12):
  t=a*math.tau/12;n=Vector((math.cos(t),math.sin(t),0));vent(n*20-Z*54,9,10,-Z)
 return dict(port=(0,0,47),axis='z',rotation=True)

def assembly():
 port=dock_hub(34,30,37)
 # Long service mast, mechanically behind the rotating hub.
 truss((0,-64,-18),(0,74,-18),3)
 for y in [-51,56]:
  truss((0,y,-18),(22,y,-18),2)
  vertical_radiator(18,y+4,-18,17,8)
 for side in [-1,1]:
  cylinder((side*17,0,-2),(side*27,0,-2),4,12,2,True)
 cylinder((27,0,-2),(48,0,-2),5,12,5,True)
 cylinder((50,0,-2),(62,0,-2),6,12,2)
 cylinder((-26,-18,-2),(-26,24,-2),5.5,12,7,True)
 cylinder((34,-22,-2),(34,-8,-2),5,12,3,True)
 cylinder((34,-8,-2),(34,0,-2),2,10,2)
 truss((34,0,-2),(34,18,-2),1.6);vertical_radiator(34,21,-2,15,6)
 return dict(port=port,axis='z',rotation=True)

def wheel():
 port=dock_hub(40,36,37)
 torus(81,11,11,8,72,False)
 # Complete unfinished second rim; four continuous rails.
 for r in [77.5,84.5]:
  for z in [-13,-5]:
   for i in range(72):
    a=i*math.tau/72;b=(i+1)*math.tau/72;tube((r*math.cos(a),r*math.sin(a),z),(r*math.cos(b),r*math.sin(b),z),.43,steel,6)
 for i in range(72):
  a=i*math.tau/72;b=(i+1)*math.tau/72
  for z in [-13,-5]:
   tube((77.5*math.cos(a),77.5*math.sin(a),z),(84.5*math.cos(b),84.5*math.sin(b),z),.20,alloy,6)
  for r in [77.5,84.5]:
   tube((r*math.cos(a),r*math.sin(a),-13),(r*math.cos(b),r*math.sin(b),-5),.20,alloy,6)
  if i%9 in [0,1,2]:
   pts=[(r*math.cos(t),r*math.sin(t),-4.8) for r,t in [(78,a),(84,a),(84,b),(78,b)]];plate(pts,random.choice(ivory),Z,.1)
 for angle in [0,math.pi/2,math.pi,math.pi*1.5]:
  n=Vector((math.cos(angle),math.sin(angle),0));t=Vector((-math.sin(angle),math.cos(angle),0))
  for z in [-9,8]:
   for lo in range(10,77,8):
    c=n*(lo+4)+Z*z
    box(c,(8,2.8,3),steel,(n,t,Z))
    plate([c+n*x+t*y+Z*1.5 for x,y in [(-3.9,-1.3),(3.9,-1.3),(3.9,1.3),(-3.9,1.3)]],ivory[1],Z,.12)
    pipe(c-n*4+t*1.6,c+n*4+t*1.6,.16)
    if lo%16==10:window_band(c+Z*1.8,4,.4,Z,n)
 return dict(port=port,axis='z',rotation=True)

def pad(x=0,y=0,z=0,w=35,d=31):
 plated_box((x,y-1.6,z),(w,3.2,d),step=7)
 for i in range(5):
  for j in range(5):deck_tile(x-w/2+(i+.5)*w/5,y+.06,z-d/2+(j+.5)*d/5,w/5-.1,d/5-.1)
 for sign in [-1,1]:
  box((x+sign*w*.40,y+.20,z),(.24,.025,d*.78),orange)
  box((x,y+.20,z+sign*d*.39),(w*.80,.025,.24),orange)
  for off in [-.40,-.2,0,.2,.4]:
   lamp(x+off*w,y+.5,z+sign*(d/2-.4),'top')
   if abs(off)>.3:plated_box((x+off*w,y+.5,z+sign*d*.47),(2.2,1.8,2),ivory[1])
 for sign in [-1,1]:
  box((x+sign*w*.30,y+.21,z),(.12,.025,d*.6),ivory[3])
  box((x,y+.21,z+sign*d*.30),(w*.60,.025,.12),ivory[3])
 # Centre landing mark sits on the surface, with nothing above the pad.
 box((x,y+.23,z),(4,.026,.18),orange);box((x,y+.23,z),(.18,.026,3),orange)
 plated_box((x,y+1.9,z-d/2+2),(7,4,3.5),step=3)
 window_band((x,y+2.5,z-d/2+3.85),5,.7)
 mast(x+2,y+4,z-d/2+2,4)
 for side in [-1,1]:vent((x+side*w*.30,y-1.4,z+d/2+.22),7,1.7)
 return (x,y+.25,z)

def derrick():
 port=pad(0,21,0,38,34)
 plated_box((0,-24,0),(30,4,28))
 for x in [-9,9]:
  for z in [-8,8]:
   cylinder((x,-22,z),(x,-5,z),6,16,4)
   pipe((x,-4,z),(x*.3,-4,z),.4)
 plated_box((0,-2,0),(6,43,6),steel)
 for x in [-4,4]:
  for z in [-4,4]:beam((x,-22,z),(x,20,z),.55)
 for y in range(-20,20,7):
  for z in [-4.5,4.5]:
   beam((-4,y,z),(4,min(y+7,20),z),.32,alloy);beam((4,y,z),(-4,min(y+7,20),z),.32,alloy)
  for x in [-4.5,4.5]:beam((x,y,-4),(x,min(y+7,20),4),.32,alloy)
 for y in range(-17,18,4):lamp(0,y,3.4)
 return dict(port=port,axis='y',rotation=False)

def buoy():
 cylinder((0,-16,0),(0,9,0),17,20,5)
 port=pad(0,14,0,35,33)
 for angle in [0,math.pi/2,math.pi,3*math.pi/2]:
  n=Vector((math.cos(angle),0,math.sin(angle)))
  truss(n*16-Y*3,n*22-Y*3,1.2)
  c=n*23-Y*3
  if abs(n.x)>.5:radiator(c.x,c.y,c.z,12,9)
  else:radiator(c.x,c.y,c.z,9,12)
  vent(n*17.5,6,8,n,X if abs(n.z)>.5 else Z)
 return dict(port=port,axis='y',rotation=False)

def rig():
 cylinder((14,-24,-7),(14,14,-7),11,16,7)
 port=pad(-15,13,9,31,28)
 plated_box((0,11,-2),(32,5,6),step=6)
 for z in [-2,12]:
  truss((-28,10,z),(11,-15,z-6),3)
  truss((-28,10,z),(11,10,z-6),2)
  beam((-12,-2,z),(5,10,z-3),.65)
 cylinder((14,-29,-7),(14,-25,-7),5,12,2)
 tube((14,-34,-7),(14,-29,-7),2.3,alloy,12)
 for y in range(-36,-31):tube((14,y,-7),(14,y+.3,-7),max(.3,(y+37)*.37),steel,12)
 for side in [-1,1]:
  a=Vector((14+side*4,-27,-7));b=Vector((14+side*9,-33,-7));c=Vector((14+side*7,-38,-7))
  tube(a,b,1.3,steel,6);tube(b,c,1.05,alloy,6);tube(c,c+Vector((-side*2,-1,0)),.65,steel,6)
  for p in [a,b]:tube(p-Z*1.5,p+Z*1.5,1.9,alloy,12)
 tanks(25,-15,-11,3,'z',2.2,12)
 vertical_radiator(26,-18,-7,4,11)
 return dict(port=port,axis='y',rotation=False)

def cluster():
 plated_box((0,-7,0),(28,25,27),step=6)
 port=pad(0,6,0,30,29)
 for side in [-1,1]:
  cylinder((side*13,-2,0),(side*28,-2,0),2.7,12,2)
 cylinder((-39,-11,7),(-39,9,7),5,12,4,True)
 cylinder((29,-2,-4),(41,-2,-4),5,12,3,True)
 cylinder((13,-12,13),(29,-12,13),2.7,12,2)
 cylinder((34,-20,13),(34,-2,13),5,12,4,True)
 truss((0,-39,1),(0,-18,1),1.5)
 truss((0,6,-10),(0,29,-10),1.5)
 for side in [-1,1]:fascia((side*14.3,-7,0),23,20,X*side,Z)
 fascia((0,-7,13.8),25,21)
 tanks(29,-18,11,2,'z',1,7)
 return dict(port=port,axis='y',rotation=False)

def salvage():
 # A vertical-faced pad is the explicitly approved O9 reference orientation.
 plated_box((0,-2,-5),(29,33,21),step=6)
 frame((0,0,6),20,18,1,1.2)
 box((0,0,6),(20,18,.6),blue[1])
 for side in [-1,1]:
  box((side*8.8,0,6.35),(.22,15.5,.03),orange);box((0,side*7.7,6.35),(17.8,.22,.03),orange)
  for t in [-7,0,7]:lamp(t,side*9.8,7)
 # Cargo pods mounted into the central freighter structure.
 for c,size in [((-22,4,-4),(14,12,15)),((-18,-18,-5),(11,15,15)),((18,-13,-4),(12,14,15)),((-9,19,-7),(10,12,13))]:
  plated_box(c,size,rust if c[0]<-15 else ivory[1],step=4)
  cx,cy,cz=c
  for x in [-size[0]*.35,0,size[0]*.35]:pipe((cx+x,cy-size[1]*.44,cz+size[2]/2+.3),(cx+x,cy+size[1]*.44,cz+size[2]/2+.3),.16)
  truss((cx,cy,cz),(0,cy,-5),2)
 # Recognisable salvaged cockpit bow, pointing right.
 sections=[(14,9,7),(23,8,7),(34,3,3),(38,0.6,1)]
 for i in range(len(sections)-1):
  x,h,w=sections[i];xx,hh,ww=sections[i+1]
  for side in range(4):
   coords=[(-1,-1),(1,-1),(1,1),(-1,1)];a=coords[side];b=coords[(side+1)%4]
   p=[Vector((x,6+a[0]*h,-3+a[1]*w)),Vector((xx,6+a[0]*hh,-3+a[1]*ww)),Vector((xx,6+b[0]*hh,-3+b[1]*ww)),Vector((x,6+b[0]*h,-3+b[1]*w))]
   n=(p[1]-p[0]).cross(p[2]-p[0]).normalized();plate(p,rust if side==2 else ivory[1],n,.18)
 for x in [28,31]:box((x,10,2.8),(2.6,2.0,.18),glass)
 cylinder((-1,16,-7),(-1,32,-7),6,16,4)
 for side in [-1,1]:truss((side*10,16,-7),(side*4,28,-7),1.2)
 for x in [-11,11]:
  pipe((x,-17,7),(x,17,7),.32)
  vent((x,-11,7.2),3,5)
 plated_box((0,-27,-7),(15,17,15),rust)
 for x in [-5,0,5]:vent((x,-27,1),3,10)
 return dict(port=(0,0,6.4),axis='z',rotation=False)

# Round two: replace broad primitive faces with structural recesses and machinery.
old_cylinder=cylinder
old_pad=pad
old_ring=ring
old_drum=drum
old_assembly=assembly
old_wheel=wheel
old_derrick=derrick
old_buoy=buoy
old_rig=rig
old_cluster=cluster
old_salvage=salvage

def surface_frame(c,w,h,n=Z,u=X,bar=.65):
 c=Vector(c);n=Vector(n);u=Vector(u);v=n.cross(u)
 for sign in [-1,1]:
  box(c+u*sign*(w/2+bar/2),(bar,h+bar*2,.65),steel,(u,v,n))
  box(c+v*sign*(h/2+bar/2),(w,bar,.65),steel,(u,v,n))
 for sx in [-1,1]:
  for sy in [-1,1]:
   q=c+u*sx*w/2+v*sy*h/2
   box(q+n*.4,(bar*1.8,bar*1.8,.6),alloy,(u,v,n))
   tube(q+n*.65,q+n*.85,.16,steel,6)

def machinery(c,w,h,n=Z,u=X,kind=0):
 c=Vector(c);n=Vector(n);u=Vector(u);v=n.cross(u)
 box(c,(w,h,.65),black,(u,v,n));surface_frame(c+n*.3,w,h,n,u,.35)
 if kind%3==0:
  for i in range(3):
   q=c+u*(i-1)*w*.25+n*.6
   pipe(q-v*h*.36,q+v*h*.36,.22)
   tube(q-v*h*.20,q+v*h*.20,.6,alloy,10)
   tube(q-v*h*.02,q+v*h*.02,.72,steel,10)
 elif kind%3==1:
  vent(c+n*.6,w*.85,h*.8,n,u)
 else:
  for i in range(3):
   q=c+v*(i-1)*h*.27+n*.6
   box(q,(w*.78,h*.18,.9),alloy,(u,v,n));box(q+n*.5,(w*.65,h*.10,.18),steel,(u,v,n))
   box(q+u*w*.25+n*.62,(.28,.35,.1),warm,(u,v,n))

def edge_trunk(a,b,n=Z,width=1.6):
 a,b=Vector(a),Vector(b);n=Vector(n);d=(b-a).normalized();u=d.cross(n).normalized();length=(b-a).length
 box((a+b)/2,(width,length,.65),black,(u,d,n))
 for off in [-width*.30,0,width*.30]:pipe(a+u*off+n*.55,b+u*off+n*.55,.15)
 for i in range(max(1,int(length/4))+1):
  q=a.lerp(b,i/max(1,int(length/4)))+n*.85
  box(q,(width+.6,.40,.55),steel,(u,d,n))
  if i%3==0:box(q+n*.34,(.30,.25,.12),warm,(u,d,n))

def cylinder(a,b,r,segments=16,rows=4,windows=False):
 old_cylinder(a,b,r,segments,rows,windows)
 a,b=Vector(a),Vector(b);d=(b-a).normalized();u=d.cross(Y if abs(d.y)<.9 else X).normalized();v=d.cross(u)
 length=(b-a).length
 # Domed shoulder skin replaces the flat stepped-can reading.
 for q,sign in [(a,-1),(b,1)]:
  for j in range(4):
   t=j/4*math.pi/2;tt=(j+1)/4*math.pi/2
   rr=r*(.98-.64*(1-math.cos(t)));rr2=r*(.98-.64*(1-math.cos(tt)));dd=r*.48*math.sin(t);dd2=r*.48*math.sin(tt)
   for i in range(segments):
    aa=i*math.tau/segments;bb=(i+1)*math.tau/segments
    pts=[q+d*sign*z+(u*math.cos(ang)+v*math.sin(ang))*rad for rad,z,ang in [(rr,dd,aa),(rr,dd,bb),(rr2,dd2,bb),(rr2,dd2,aa)]]
    normal=(u*math.cos((aa+bb)/2)+v*math.sin((aa+bb)/2))+d*sign
    plate(pts,ivory[1],normal,.08,False)
  tube(q+d*sign*r*.48,q+d*sign*(r*.48+.35),r*.34,steel,segments)
  for k in range(4):
   n=u*math.cos(k*math.pi/2)+v*math.sin(k*math.pi/2)
   pipe(q+n*r*.82,q+n*r*.35+d*sign*(r*.49),.15)
 if r>=3:
  for k in range(4):
   n=u*math.cos(k*math.pi/2)+v*math.sin(k*math.pi/2);t=d.cross(n)
   edge_trunk(a+n*(r+.2)+d*1.8,b+n*(r+.2)-d*1.8,n,min(1.3,r*.25))
   if length>10:machinery(a.lerp(b,.4)+n*(r+.4),r*.65,min(length*.32,7),n,t,k)
  for k in range(8):
   n=u*math.cos(k*math.pi/4)+v*math.sin(k*math.pi/4);t=d.cross(n)
   box(a.lerp(b,.5)+n*(r+.55),(r*.6,.65,.65),steel,(t,d,n))
   if windows and k%2==0:window_band(a.lerp(b,.66)+n*(r+.6),r*.72,.3,n,t)

def dock_hub(w=32,h=28,length=32,z=0):
 # A chamfered eight-sided pressure hull with a framed 120 x 70 m passage.
 front=z+length/2;back=z-length/2;b=min(w,h)*(.08 if name=="ring" else .22)
 rim=[(-w/2+b,-h/2),(w/2-b,-h/2),(w/2,-h/2+b),(w/2,h/2-b),(w/2-b,h/2),(-w/2+b,h/2),(-w/2,h/2-b),(-w/2,-h/2+b)]
 for i,(x,y) in enumerate(rim):
  xx,yy=rim[(i+1)%8];mid=Vector(((x+xx)/2,(y+yy)/2,0));n=mid.normalized();u=Vector((xx-x,yy-y,0)).normalized()
  for j in range(4):
   lo=back+j*length/4;hi=back+(j+1)*length/4
   plate([(x,y,lo),(xx,yy,lo),(xx,yy,hi),(x,y,hi)],random.choice(ivory),n,.2)
  edge_trunk((x,y,back),(x,y,front),Vector((x,y,0)).normalized(),1.4)
  machinery(mid+Z*z,(Vector((xx,yy,0))-Vector((x,y,0))).length*.64,length*.56,n,u,i)
  # Each front wedge connects the octagonal perimeter to the opening.
  def inner(px,py):
   scale=min(9/max(abs(px),1e-6),5.25/max(abs(py),1e-6));return (px*scale,py*scale,front)
  aa=Vector(inner(x,y));bb=Vector((x,y,front));cc=Vector((xx,yy,front));dd=Vector(inner(xx,yy))
  for row in range(3):
   a0=aa.lerp(bb,row/3);a1=aa.lerp(bb,(row+1)/3);b0=dd.lerp(cc,row/3);b1=dd.lerp(cc,(row+1)/3)
   plate([a0,a1,b1,b0],ivory[(i+row)%4],Z,.20+row*.22)
  for frac in [.52,.79]:
   pp=aa.lerp(bb,frac);qq=dd.lerp(cc,frac);tube(pp+Z*.9,qq+Z*.9,.17,steel,6)
  tube((x,y,front+.3),(xx,yy,front+.3),.7,steel,6)
  tube((x,y,front+.5),(xx,yy,front+.5),.2,alloy,8)
  q=mid*.78+Z*(front+.5)
  if i%2==0:machinery(q,max(2,min(w,h)*.22),3.2,Z,u,i)
  else:window_band(q,2.5,.35,Z,u)
 # Actual inside passage walls, no cap.
 for side in [-1,1]:
  box((side*9.3,0,z),(.6,11.1,length),steel)
  box((0,side*5.55,z),(18,.6,length),steel)
 for zz in [front,front-3,front-7,front-12]:
  frame((0,0,zz),18,10.5,.45,.35,alloy if zz==front else steel)
  for side in [-1,1]:
   for yy in [-4.5,4.5]:box((side*8.7,yy,zz),(.15,.4,.55),warm)
 for off,bar,depth in [(0,1.2,1.3),(1.0,.6,.6),(1.5,.22,.3)]:frame((0,0,front+off),18+off*1.2,10.5+off*.7,depth,bar,steel if off<1 else alloy)
 for x in [-10.8,10.8]:
  edge_trunk((x,-6.5,front+.9),(x,6.5,front+.9),Z,1)
  for y in [-4,0,4]:lamp(x,y,front+1.5)
 for y in [-7.1,7.1]:edge_trunk((-10.3,y,front+.7),(10.3,y,front+.7),Z,1.1)
 for x in [-4,-2,0,2,4]:box((x,-6.3,front+1.3),(.8,.3,.15),orange)
 for x in [-w*.27,w*.27]:mast(x,h/2-1,z-length*.2,3)
 return (0,0,front+1.8)

def pad(x=0,y=0,z=0,w=35,d=31):
 port=old_pad(x,y,z,w,d)
 # A single quiet landing surface hides the coarse bright tile grid.
 box((x,y+.28,z),(w*.94,.10,d*.94),deckpaint)
 for side in [-1,1]:
  box((x+side*w*.28,y+.346,z),(.35,.015,d*.56),ivory[1])
  box((x,y+.346,z+side*d*.28),(w*.56,.015,.35),ivory[1])
  box((x+side*w*.39,y+.345,z),(.18,.02,d*.78),orange)
  box((x,y+.345,z+side*d*.39),(w*.78,.02,.18),orange)
  # Structural deck rim: thick support brackets and recessed service modules.
  for i in range(7):
   xx=x-w*.43+i*w*.86/6
   c=Vector((xx,y-1.2,z+side*(d/2+.30)))
   box(c,(w*.115,2.4,.8),steel);box(c+Z*side*.46,(w*.077,1.55,.18),ivory[i%4])
   if i%2:machinery(c+Z*side*.58,w*.08,1.25,Z*side,X,i)
   else:pipe(c-X*w*.055+Y*.85+Z*side*.7,c+X*w*.055+Y*.85+Z*side*.7,.12)
  for i in range(6):
   zz=z-d*.42+i*d*.84/5;c=Vector((x+side*(w/2+.3),y-1.2,zz))
   box(c,(.8,2.4,d*.13),steel);vent(c+X*side*.5,d*.10,1.4,X*side,Z)
  # Low perimeter safety rail outside the flight pad.
  for zz in [-d*.47,d*.47]:
   pipe((x-w*.46,y+.9,z+zz),(x+w*.46,y+.9,z+zz),.07)
  for off in [-.4,-.2,.2,.4]:
   for zz in [-d*.47,d*.47]:tube((x+off*w,y+.2,z+zz),(x+off*w,y+.95,z+zz),.06,steel,6)
  for xx in [-w*.47,w*.47]:
   pipe((x+xx,y+.9,z-d*.46),(x+xx,y+.9,z+d*.46),.07)
 for i in range(4):
  zz=z-d*.28+i*d*.18
  box((x,y+.344,zz),(w*.73,.01,.025),black)
 box((x,y+.36,z),(3,.018,.17),orange);box((x,y+.36,z),(.17,.018,2.2),orange)
 for sx in [-1,1]:
  for sz in [-1,1]:
   c=Vector((x+sx*w*.43,y-.1,z+sz*d*.43));box(c,(3,3,3),steel);box(c+Y*1.6,(1.5,.15,1.5),ivory[1]);flood(c+Y*1.75)
 return (x,y+.40,z)

def ring():
 port=dock_hub(41,36,29)
 torus(57,18,19,0,64)
 for k in range(4):
  n=Vector((math.cos(k*math.pi/2),math.sin(k*math.pi/2),0));cylinder(n*18,n*48,3.9,12,4)
  for r in [20,44,47]:tube(n*(r-.6),n*(r+.6),5.6,steel,16)
 for i in range(32):
  a=i*math.tau/32;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0));c=n*57+Z*10
  if i%4==0:machinery(c,6,12,Z,t,i)
  else:
   edge_trunk(n*50+Z*10,n*64+Z*10,Z,1.2)
   window_band(n*52.5+Z*10.3,4,.35,Z,t)
 for rad in [49.1,64.8]:
  for i in range(64):
   a=i*math.tau/64;b=(i+1)*math.tau/64;pipe((rad*math.cos(a),rad*math.sin(a),10),(rad*math.cos(b),rad*math.sin(b),10),.17)
 return dict(port=port,axis='z',rotation=True)

def drum():
 info=old_drum()
 # Broad end ring bevel and longitudinal access trunks.
 for i in range(32):
  a=i*math.tau/32;b=(i+1)*math.tau/32
  plate([(r*math.cos(t),r*math.sin(t),z) for r,z,t in [(30,46,a),(35,42,a),(35,42,b),(30,46,b)]],steel,Z,.12)
 for k in range(8):
  a=k*math.tau/8;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0))
  for off in [-1.1,0,1.1]:pipe(n*35.9+t*off-Z*47,n*35.9+t*off+Z*38,.25)
  for zz in [-40,-20,10,30]:machinery(n*36.2+Z*zz,5.5,8,n,t,k)
  if k%2==0:edge_trunk(n*13+Z*46,n*29+Z*46,Z,3.0)
  if k%2==1:window_band(n*18+Z*47,4,.35,Z,t)
 for z in [-48,-5,40]:
  for i in range(16):
   a=i*math.tau/16;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0));q=n*37.5+Z*z
   box(q,(4,3,1.3),steel,(t,Z,n));box(q+n*.8,(2.7,1.8,.25),ivory[1],(t,Z,n))
 frame((0,0,47),18,10.5,2,1.8);frame((0,0,48),20.6,13.1,.8,.4,alloy)
 return dict(port=(0,0,48.5),axis='z',rotation=True)

def assembly():
 info=old_assembly()
 cylinder((57,0,-2),(64,0,-2),7.2,8,2)
 truss((-26,19,-2),(-10,19,-15),2);truss((-26,-14,-2),(-12,-14,-15),2)
 for y in [-51,56]:
  for x in [10,15,20]:box((x,y+4,-16.8),(3.8,8,.4),steel)
 return info

def wheel():
 # Existing frame, larger octagonal pressure hub and pronounced spokes.
 info=old_wheel();port=info['port']
 for k in range(4):
  n=Vector((math.cos(k*math.pi/2),math.sin(k*math.pi/2),0));t=Vector((-math.sin(k*math.pi/2),math.cos(k*math.pi/2),0))
  edge_trunk(n*16+Z*10,n*76+Z*10,Z,2.6)
  for r in [20,40,60]:machinery(n*r+Z*10.5,3.7,6,Z,t,k)
 for i in range(36):
  a=i*math.tau/36;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0));c=n*81+Z*12.5
  if i%3==0:machinery(c,5,4,Z,t,i)
  else:edge_trunk(n*78+Z*12.5,n*84+Z*12.5,Z,.8)
 for sx in [-1,1]:
  for sy in [-1,1]:
   c=Vector((sx*12,sy*12,0));prism([c,c+X*sx*5,c+X*sx*5+Z*-9,c+Z*-12],Y*sy,.3,ivory[2])
 return dict(port=port,axis='z',rotation=True)

def derrick():
 info=old_derrick()
 for x in [-9,9]:
  for z in [-8,8]:
   pipe((x,-4,z),(x,-2,z-3),.28);pipe((x,-2,z-3),(x*.3,-2,z-3),.28)
   pipe((x+5,-21,z),(x+5,-4,z),.22)
 for z in [-13,13]:
  box((0,-5,z),(27,.3,1.2),steel)
  pipe((-13,-3.5,z),(13,-3.5,z),.08)
  for x in range(-12,13,3):tube((x,-5,z),(x,-3.5,z),.07,alloy,6)
 for x in [-4,4]:edge_trunk((x,-20,5),(x,19,5),Z,1)
 return info

def buoy():
 info=old_buoy()
 # Front service hatch, dark armour uprights and machinery skirt.
 surface_frame((0,-2,17.5),11,10,Z,X,.9)
 box((0,-2,17.9),(10,9,.6),steel);box((0,-2,18.3),(8.7,7.5,.2),blue[1]);surface_frame((0,-2,18.4),8.7,7.5,Z,X,.25)
 for x in [-12,12]:
  n=Vector((x/17,0,math.sqrt(1-(x/17)**2)));edge_trunk(n*17.5-Y*13,n*17.5+Y*8,n,2.4)
 for a in range(8):
  n=Vector((math.sin(a*math.pi/4),0,math.cos(a*math.pi/4)));machinery(n*17.6-Y*11,7,4,n,Vector((n.z,0,-n.x)),a)
 # One upright rear fin makes the silhouette asymmetric like the target.
 vertical_radiator(-9,19,-21,8,11)
 return info

def rig():
 info=old_rig()
 cylinder((14,14,-7),(14,20,-7),8,12,2)
 plated_box((14,21,-7),(10,4,10),steel)
 for x in [11,14,17]:mast(x,23,-7,4)
 for a in range(8):
  n=Vector((math.sin(a*math.pi/4),0,math.cos(a*math.pi/4)));t=Vector((n.z,0,-n.x))
  for y in [-16,-3,10]:machinery(Vector((14,y,-7))+n*11.4,5,7,n,t,a)
 for z in [-2,12]:
  a=Vector((-28,10,z));b=Vector((11,-15,z-6));d=(b-a).normalized();u=d.cross(Z).normalized()
  for j in range(7):
   c=a.lerp(b,(j+.5)/7);plate([c+d*dd+u*uu+Z*.35 for dd,uu in [(-3,-1),(3,-1),(3,1),(-3,1)]],ivory[1],Z,.25)
 for side in [-1,1]:
  a=Vector((14+side*4,-27,-7));b=Vector((14+side*9,-33,-7));c=Vector((14+side*7,-38,-7))
  tube(a,b,2,steel,6);tube(b,c,1.6,ivory[1],6)
  pipe(a+Z*1.8,b+Z*1.8,.35)
 return info

def cluster():
 info=old_cluster()
 surface_frame((0,-7,14.2),10,7,Z,X,.9)
 box((0,-7,14.5),(9.6,6.6,.5),steel);box((0,-7,14.9),(8.4,5.5,.4),blue[1]);surface_frame((0,-7,15.2),8,5,Z,X,.35)
 plated_box((0,-19,13),(9,5,6),ivory[1]);machinery((0,-19,16.4),6,2.8)
 for x in [-11,11]:edge_trunk((x,-16,14.6),(x,3,14.6),Z,1.4)
 for side in [-1,1]:edge_trunk((side*14.6,-17,-10),(side*14.6,3,-10),X*side,1.4)
 return info

def salvage():
 info=old_salvage()
 # Layered salvaged beams and repaired equipment break the large box faces.
 for x in [-13,13]:edge_trunk((x,-18,7.8),(x,17,7.8),Z,2.0)
 for y in [-11,12,16]:edge_trunk((-13,y,7.8),(13,y,7.8),Z,2.0)
 for x in [-10,10]:
  for y in [-9,0,9]:box((x,y,7.1),(2.0,2.3,1.8),steel);lamp(x,y,8.2)
 for c,w,h in [((-23,4,4),10,9),((-18,-18,3),8,12),((18,-13,4),9,10),((-9,20,0),7,9)]:machinery(c,w,h,Z,X,2)
 # Pipe risers wrap around the pad instead of crossing it.
 for x in [-15,15]:
  for off in [0,.5,1]:pipe((x+off,-16,7),(x+off,15,7),.18)
 for y in [-16,16]:pipe((-15,y,7),(15,y,7),.25)
 for a in range(8):
  t=a*math.pi/4;n=Vector((math.cos(t),0,math.sin(t)));machinery(Vector((-1,24,-7))+n*6.4,2.7,10,n,Vector((n.z,0,-n.x)),a)
 for x in [-5,0,5]:
  pipe((x,-34,1),(x,-20,1),.40);cylinder((x,-32,-1),(x,-23,-1),1.4,10,3)
 # Framed, inset-looking cockpit windows on the salvaged bow.
 for x in [27,30,33]:
  box((x,9,3.5),(2.7,2.2,.55),steel);box((x,9,3.83),(2.15,1.45,.1),glass)
 for x in [19,23,27,31]:
  vent((x,3,4.5),2.5,3)
  box((x,5,4.5),(3.5,.8,.18),ivory[1])
 return info

exec((OUT/'final_shapes.py').read_text(),globals())

def export(name,info):
 root=bpy.data.objects.new('station-'+name,None);bpy.context.collection.objects.link(root)
 root['design']=name;root['author']='Codex';root['metres_per_author_unit']=10
 root['docking_kind']='slot' if name in ['ring','drum','assembly','wheel'] else 'pad'
 root['spin_axis']=info['axis'];root['prototype']=True
 for key,(verts,faces,uvs) in BATCH.items():
  mesh=bpy.data.meshes.new(key);mesh.from_pydata([tuple(Vector(v)*10) for v in verts],[],faces);mesh.materials.append(MATS[GROUP_MAT[key]]);mesh.update()
  uv=mesh.uv_layers.new(name='surface-metres')
  for face,coords in zip(mesh.polygons,uvs):
   for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=xy
  bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
  ob=bpy.data.objects.new(key,mesh);bpy.context.collection.objects.link(ob);ob.parent=root
  if '/cladding-' in key:
   mod=ob.modifiers.new('plate-edge-radius','BEVEL');mod.width=.24;mod.segments=1
   mod=ob.modifiers.new('weighted-normals','WEIGHTED_NORMAL');mod.keep_sharp=True
 datum=bpy.data.objects.new('docking-centre',None);bpy.context.collection.objects.link(datum);datum.parent=root;datum.location=Vector(info['port'])*10;datum['axis']=info['axis']
 bpy.context.preferences.filepaths.save_version=0;bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(name+'.blend')))
 glb=OUT/(name+'.glb');bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=False,export_apply=True,export_materials='EXPORT',export_extras=True)
 data=glb.read_bytes();jl=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+jl])
 for m in doc['materials']:
  if 'baseColorTexture' in m.get('pbrMetallicRoughness',{}):m['pbrMetallicRoughness']['baseColorFactor']=list(MATS[m['name']].diffuse_color)
 enc=json.dumps(doc,separators=(',',':')).encode();enc+=b' '*((-len(enc))%4);tail=data[20+jl:]
 glb.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(enc)+len(tail))+struct.pack('<II',len(enc),0x4E4F534A)+enc+tail)
 print('EXPORTED',name,glb.stat().st_size,flush=True)

wanted=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
for name,fn in [('ring',ring),('drum',drum),('assembly',assembly),('wheel',wheel),('derrick',derrick),('buoy',buoy),('rig',rig),('cluster',cluster),('salvage',salvage)]:
 if wanted and name not in wanted:continue
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);BATCH.clear();GROUP_MAT.clear();random.seed(810)
 print('BUILDING',name,flush=True);export(name,fn())
