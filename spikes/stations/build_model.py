"""Nine approved station studies. Blender authoring, 10 m per unit, Y up.
Source geometry and generated Coriolis texture are retained in each .blend.
Run Blender --background --python build_model.py -- [station ...].
"""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from geometry import *
import geometry as G

rust=material('salvaged-red',(.38,.14,.09),.42,.72)
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
  box(c+u*(-w/2+.55+i*1.25)+n*.23,(.50,h,.12),white if i%4 else warm,(u,v,n))

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
 # End domes made from bevelled stepped shoulders, seated into body.
 for q,sign in [(a,-1),(b,1)]:
  tube(q-d*.05*sign,q+d*.7*sign,r*.97,ivory[1],segments)
  tube(q+d*.65*sign,q+d*1.4*sign,r*.80,steel,segments)
  tube(q+d*1.3*sign,q+d*1.8*sign,r*.68,ivory[2],segments)
  tube(q+d*1.7*sign,q+d*2*sign,r*.29,steel,segments)

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
 fw=6;fh=3.5
 for i in range(16):
  a=i*math.tau/16;b=(i+1)*math.tau/16
  def inner(t):
   s=min(fw/max(abs(math.cos(t)),1e-7),fh/max(abs(math.sin(t)),1e-7))
   return Vector((s*math.cos(t),s*math.sin(t),45))
  p=Vector((r*math.cos(a),r*math.sin(a),45));q=Vector((r*math.cos(b),r*math.sin(b),45))
  plate([inner(a),p,q,inner(b)],random.choice(ivory),Z,.18)
 frame((0,0,46),12,7,2,1.2)
 for z in [44,38,30]:frame((0,0,z),12,7,.3,.2)
 for x in [-8,8]:
  for y in [-2,0,2]:lamp(x,y,47)
 fascia((0,0,45.4),55,55)
 for a in range(8):
  t=a*math.tau/8;n=Vector((math.cos(t),math.sin(t),0));vent(n*26+Z*45.5,9,8,Z,Vector((-math.sin(t),math.cos(t),0)))
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
 port=dock_hub(20,20,34)
 torus(81,7,8,8,72,False)
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
   beam((-4,y,z),(4,y+7,z),.32,alloy);beam((4,y,z),(-4,y+7,z),.32,alloy)
  for x in [-4.5,4.5]:beam((x,y,-4),(x,y+7,4),.32,alloy)
 for y in range(-17,18,4):lamp(0,y,3.4)
 return dict(port=port,axis='y',rotation=False)

def buoy():
 cylinder((0,-16,0),(0,9,0),17,20,5)
 port=pad(0,11,0,35,33)
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
  cylinder((side*13,-2,0),(side*20,-2,0),2.7,12,2)
 cylinder((-24,-11,0),(-24,9,0),5,12,4,True)
 cylinder((20,-2,0),(31,-2,0),5,12,3,True)
 cylinder((13,-12,8),(22,-12,8),2.7,12,2)
 cylinder((26,-20,8),(26,-2,8),5,12,4,True)
 truss((0,-35,-10),(0,29,-10),1.5)
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
