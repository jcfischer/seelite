"""Structural revision: rounded pressure shells and distinct station silhouettes.
Executed in build_model.py's authoring namespace before export.
"""
round2_hub=dock_hub
round2_drum=drum
round2_wheel=wheel
round2_derrick=derrick
round2_rig=rig
round2_cluster=cluster

def torus(radius=61,width=12,depth=12,z=0,segments=64,rounded=True):
 # Twelve-sided superellipse creates rounded shoulders, not a flat washer.
 profile=[]
 for j in range(16):
  a=j*math.tau/16;c=math.cos(a);s=math.sin(a)
  profile.append((width/2*math.copysign(abs(c)**.65,c),depth/2*math.copysign(abs(s)**.65,s)))
 for i in range(segments):
  a=i*math.tau/segments;b=(i+1)*math.tau/segments;mid=(a+b)/2
  n=Vector((math.cos(mid),math.sin(mid),0));t=Vector((-math.sin(mid),math.cos(mid),0))
  def p(aa,r,zz):return Vector(((radius+r)*math.cos(aa),(radius+r)*math.sin(aa),z+zz))
  for j,(r,zz) in enumerate(profile):
   rr,zzz=profile[(j+1)%16];normal=(n*(zzz-zz)-Z*(rr-r)).normalized()
   mat=steel if i%8==0 else orange if i%24==5 and j in [1,2,3,4,5,6] else ivory[(i+j)%4]
   plate([p(a,r,zz),p(b,r,zz),p(b,rr,zzz),p(a,rr,zzz)],mat,normal,.12)
  c=n*radius+Z*(z+depth/2+.12);span=math.tau*radius/segments
  box(c,(span*.98,width*.18,.30),black,(t,n,Z))
  if i%8 not in [0,1,5]:window_band(c+Z*.24,span*.72,.45,Z,t)
  else:vent(c+Z*.24,span*.72,width*.17,Z,t)
  for side in [-1,1]:tube(p(a,side*width*.13,depth/2+.3),p(b,side*width*.13,depth/2+.3),.16,alloy,8)
  if i%8==0:
   edge_trunk(n*(radius-width*.43)+Z*(z+depth*.36),n*(radius+width*.43)+Z*(z+depth*.36),Z,2.3)
   machinery(c+Z*.6,span*.8,width*.52,Z,t,i)
  if i%8==4:
   vent(n*(radius-width*.31)+Z*(z+depth*.46),span*.72,width*.24,Z,t)

def dock_hub(w=32,h=28,length=32,z=0):
 port=round2_hub(w,h,length,z);front=z+length/2
 # Two deeply seated perimeter collars and an equipment crown.
 for zz in [front-3,front-8,z-length/2+3]:
  b=min(w,h)*(.08 if name=='ring' else .22)
  rim=[(-w/2+b,-h/2),(w/2-b,-h/2),(w/2,-h/2+b),(w/2,h/2-b),(w/2-b,h/2),(-w/2+b,h/2),(-w/2,h/2-b),(-w/2,-h/2+b)]
  for i,(x,y) in enumerate(rim):
   xx,yy=rim[(i+1)%8];tube((x,y,zz),(xx,yy,zz),.9,steel,6)
   tube((x,y,zz+.65),(xx,yy,zz+.65),.16,alloy,8)
 for x in [-w*.32,0,w*.32]:
  machinery((x,h/2+.2,z),w*.20,length*.45,Y,X,2)
 for sign in [-1,1]:
  box((sign*10.2,0,front+1.5),(.24,9.5,.25),warm)
  box((0,sign*6.55,front+1.5),(16,.20,.25),warm)
  for xx in [-4,-2,0,2,4]:box((xx,sign*4.25,front+.5),(.9,.38,.2),orange)
 return port

def ring():
 port=dock_hub(41,36,31)
 torus(57,19,24,0,64)
 for k in range(4):
  n=Vector((math.cos(k*math.pi/2),math.sin(k*math.pi/2),0));cylinder(n*18,n*47,4.1,12,4)
  for r in [20,22,44,46]:
   tube(n*(r-.45),n*(r+.45),6.0,steel,20)
   for i in range(12):
    u=Z*math.cos(i*math.tau/12)+n.cross(Z)*math.sin(i*math.tau/12)
    box(n*r+u*6,(.4,.8,.4),warm if i%3==0 else alloy)
 return dict(port=port,axis='z',rotation=True)

def drum():
 info=round2_drum()
 # Nested light-painted end shoulder with a dark inner service trench.
 for i in range(48):
  a=i*math.tau/48;b=(i+1)*math.tau/48
  for r1,z1,r2,z2 in [(28,47,31,48),(31,48,35,44),(35,44,37,41)]:
   pts=[(r*math.cos(t),r*math.sin(t),zz) for r,zz,t in [(r1,z1,a),(r1,z1,b),(r2,z2,b),(r2,z2,a)]]
   plate(pts,steel,Z,.12)
 for k in range(8):
  a=k*math.tau/8;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0))
  for side in [-1,1]:
   edge_trunk(n*36+t*side*4-Z*45,n*36+t*side*4+Z*38,n,1.6)
  for zz in [-30,0,27]:window_band(n*36.6+Z*zz,5,.5,n,t)
 for sign in [-1,1]:
  box((sign*10.2,0,49),(.3,9.5,.3),warm);box((0,sign*6.55,49),(16,.25,.3),warm)
 return info

def assembly():
 port=dock_hub(35,32,36)
 truss((0,-62,-18),(0,66,-18),3)
 for yy in [-45,-27,29,48]:
  plated_box((0,yy,-16),(3.5,4,2.5),steel);lamp(0,yy,-14.5)
 for y,side in [(-48,1),(53,-1)]:
  truss((0,y,-18),(side*22,y,-18),2)
  for x in [side*10,side*14,side*18,side*22]:vertical_radiator(x,y+4,-18,3.7,11)
 cylinder((-18,0,-2),(-29,0,-2),3.3,12,2)
 for lo,hi in [(-24,-5),(4,25)]:cylinder((-30,lo,-2),(-30,hi,-2),6,16,3,True)
 cylinder((-27,17,-10),(-16,17,-10),3,12,2)
 truss((-30,17,-2),(-12,17,-15),3)
 cylinder((22,-25,-4),(28,-25,-4),2.7,12,2)
 truss((43,-25,-4),(43,-18,-2),2)
 truss((0,-25,-18),(43,-25,-4),2)
 for y in [-17,17]:truss((-29,y,-2),(-13,y,-15),2)
 cylinder((17,0,-2),(30,0,-2),4,12,3,True)
 cylinder((31,0,-2),(46,0,-2),4.8,16,3)
 tube((46,0,-2),(59,0,-2),3.3,steel,12)
 for x in [48,51,54,57]:tube((x-.2,0,-2),(x+.2,0,-2),4,alloy,12)
 faceted_pod(59,75,0,-2,7.8)
 cylinder((43,-22,-2),(43,-9,-2),5,12,3,True)
 tube((43,-9,-2),(43,0,-2),1.5,steel,12)
 truss((34,-8,-2),(34,19,-2),1.4);vertical_radiator(34,21,-2,14,7)
 return dict(port=port,axis='z',rotation=True)

def wheel():
 info=round2_wheel()
 for sx in [-1,1]:
  for sy in [-1,1]:
   c=Vector((sx*17,sy*15,-2));pts=[c,c+X*sx*9+Y*sy*8,c+X*sx*9+Y*sy*8-Z*9,c-Z*9]
   plate(pts,ivory[1],Z,.3)
   for j in range(5):tube(c+X*sx*j*1.8+Y*sy*j*1.6,c+X*sx*j*1.8+Y*sy*j*1.6-Z*9,.12,steel,6)
 return info

def buoy():
 # Squat armored body; upper cap sits fully below the flight deck.
 cylinder((0,-13,0),(0,2,0),17,24,4)
 port=pad(0,12,0,35,33)
 surface_frame((0,-1,18),12,12,Z,X,1.1)
 box((0,-1,18.2),(11,11,.6),ivory[1]);box((0,-1,18.7),(7.8,8,.5),blue[1])
 for sign in [-1,1]:
  box((sign*6,-1,19),(.2,6,.2),warm);box((0,-1+sign*6,19),(6,.2,.2),warm)
  c=Vector((sign*12,-1,12));plated_box(c,(4.5,24,4.5),steel)
  for y in [-9,7]:machinery(c+Z*2.4,3,4,Z,X,1)
 for a in range(8):
  n=Vector((math.sin(a*math.pi/4),0,math.cos(a*math.pi/4)));t=Vector((n.z,0,-n.x))
  machinery(n*17.6-Y*10,8,4,n,t,a)
 vertical_radiator(-9,20,-21,9,12)
 radiator(23,-1,0,13,11);truss((15,-2,0),(23,-2,0),2)
 # Lower frontal fin, deliberately below the hatch.
 vertical_radiator(0,-21,12,9,8)
 plated_box((-16,-2,10),(5,9,5),steel)
 return dict(port=port,axis='y',rotation=False)

def rig():
 info=round2_rig()
 # Deep bridge and tall narrow service crown.
 plated_box((14,21,-7),(15,10,15),ivory[1])
 plated_box((0,13,-2),(29,7,9),ivory[2])
 for x in [3,8]:machinery((x,17,-2),4,6,Y,X,2)
 for x in [10,14,18]:tube((x,26,-7),(x,29,-7),.8,alloy,12)
 for z in [-2,12]:
  for a,b in [((-28,10,z),(11,-15,z-6)),((-28,10,z),(11,10,z-6)),((-25,7,z),(10,-17,z-6))]:
   a,b=Vector(a),Vector(b);d=(b-a).normalized();u=d.cross(Z).normalized()
   box((a+b)/2,((b-a).length,2,2.2),steel,(d,u,Z))
   for j in range(5):
    c=a.lerp(b,(j+.5)/5);plate([c+d*dd+u*uu+Z*1.2 for dd,uu in [(-3,-.7),(3,-.7),(3,.7),(-3,.7)]],ivory[1],Z,.1)
 cylinder((14,-34,-7),(14,-25,-7),6.2,16,3)
 for side in [-1,1]:
  a=Vector((14+side*5,-28,-7));b=Vector((14+side*10,-36,-7));c=Vector((14+side*6,-43,-7))
  for aa,bb in [(a,b),(b,c)]:
   d=(bb-aa).normalized();u=d.cross(Z).normalized();box((aa+bb)/2,((bb-aa).length,3.4,4),steel,(d,u,Z))
   plate([aa+u*1.5+Z*2.1,bb+u*1.2+Z*2.1,bb-u*1.2+Z*2.1,aa-u*1.5+Z*2.1],ivory[2],Z,.15)
  for q in [a,b]:tube(q-Z*2.4,q+Z*2.4,2.6,alloy,16);tube(q+Z*2.4,q+Z*2.7,1.4,steel,16)
 for j in range(7):tube((14,-35-j,-7),(14,-35.5-j,-7),2.5-j*.30,alloy,12)
 return info

def cluster():
 return round2_cluster()

def salvage():
 plated_box((0,-2,-5),(29,33,21),step=6)
 box((0,0,7),(20,18,1.7),deckpaint);frame((0,0,7.3),20,18,1.2,1.2)
 for side in [-1,1]:
  box((side*8.6,0,7.88),(.55,15,.02),orange);box((0,side*7.5,7.88),(17.5,.55,.02),orange)
  edge_trunk((side*13,-18,7.8),(side*13,16,7.8),Z,2.1)
  for y in [-9,9]:
   box((side*6,y,8.1),(3,.25,.3),warm)
   machinery((side*11,y,8),2.8,4,Z,X,2)
 # Stand-off salvaged cargo units linked by visible lattice.
 for c,size in [((-30,4,-6),(10,12,13)),((-10,21,-7),(10,10,13)),((20,-13,-6),(10,12,13))]:
  plated_box(c,size,ivory[1]);truss(c,(0,c[1],-6),3.4)
  cx,cy,cz=c
  for yy in [-size[1]*.3,size[1]*.2]:box((cx,cy+yy,cz+size[2]/2+.18),(size[0]*.9,1.4,.2),rust)
  machinery((cx,cy,cz+size[2]/2+.4),size[0]*.7,size[1]*.5,Z,X,1)
 # Eight-facet ship bow with integral sloping glazing and a faded side stripe.
 sections=[(14,9,7),(23,9,7),(31,5,5),(37,1.7,2)]
 loops=[]
 for x,h,w in sections:
  loops.append([Vector((x,6+yy*h,-3+zz*w)) for yy,zz in [(1,-.65),(.65,-1),(-.65,-1),(-1,-.65),(-1,.65),(-.65,1),(.65,1),(1,.65)]])
 for k,(aa,bb) in enumerate(zip(loops,loops[1:])):
  for i in range(8):
   pts=[aa[i],bb[i],bb[(i+1)%8],aa[(i+1)%8]];n=(pts[1]-pts[0]).cross(pts[2]-pts[0]).normalized()
   plate(pts,ivory[(i+k)%4],n,.12)
   center=sum(pts,Vector())/4
   if k==1 and i in [0,6,7]:
    inset=[center+(q-center)*.72+n*.20 for q in pts];prism(inset,n,.05,black)
    plate([center+(q-center)*.61+n*.29 for q in pts],glass,n,.04,False)
    for frac in [.36,.68]:
     a=center+(pts[0].lerp(pts[1],frac)-center)*.61+n*.40
     b=center+(pts[3].lerp(pts[2],frac)-center)*.61+n*.40
     tube(a,b,.075,alloy,8)
   if i in [1,5]:
    for j in range(3):
     p0=aa[i].lerp(aa[(i+1)%8],.43);p1=aa[i].lerp(aa[(i+1)%8],.59);q0=bb[i].lerp(bb[(i+1)%8],.43);q1=bb[i].lerp(bb[(i+1)%8],.59)
     plate([p0,q0,q1,p1],rust,n,.18,False)
 # Seal both ends of the salvaged bow loft, including its exposed nose.
 for loop,n in [(loops[0],-X),(loops[-1],X)]:
  prism(loop,n,.18,steel)
  plate([q+n*.18 for q in loop],ivory[1],n,.14)
 # Tapered asymmetric keel rather than rectangular bottom block.
 for c,size in [((0,-23,-7),(15,10,15)),((2,-31,-7),(11,9,12)),((5,-38,-6),(6,7,8))]:
  plated_box(c,size,ivory[1]);machinery(Vector(c)+Z*(size[2]/2+.2),size[0]*.65,size[1]*.7,Z,X,2)
 for x in [-7,7]:pipe((x,-19,2),(x*.7,-35,1),.45)
 cylinder((12,-27,-6),(12,-18,-6),3,12,2)
 # Recessed tower end skins retain the raised annular rim without a through-hole.
 tube((-1,18,-7),(-1,18.35,-7),6,steel,20)
 tube((-1,28.6,-7),(-1,29,-7),6,steel,20)
 plate([(-1+5.8*math.cos(i*math.tau/20),29.02,-7+5.8*math.sin(i*math.tau/20)) for i in range(20)],ivory[1],Y,.15)
 # Radial wall strips and narrow annular rims.
 for i in range(20):
  a=i*math.tau/20;b=(i+1)*math.tau/20;n=Vector((math.cos((a+b)/2),0,math.sin((a+b)/2)))
  for y in [18,24]:
   pts=[(-1+6*math.cos(t),yy,-7+6*math.sin(t)) for t,yy in [(a,y),(b,y),(b,y+6),(a,y+6)]];plate(pts,ivory[i%4],n,.2)
  for y in [18,24,30]:tube((-1+6*math.cos(a),y,-7+6*math.sin(a)),(-1+6*math.cos(b),y,-7+6*math.sin(b)),.45,steel,8)
 for side in [-1,1]:truss((side*11,15,-7),(side*5,27,-7),2.5)
 for x in [-12,12]:
  for y in [-16,16]:machinery((x,y,7.7),3,4,Z,X,2)
 # Circular salvaged dish behind the open stack.
 for i in range(24):
  a=i*math.tau/24;b=(i+1)*math.tau/24
  prism([(7,22,-13),(4+5*math.cos(a),23+5*math.sin(a),-16),(4+5*math.cos(b),23+5*math.sin(b),-16)],Z,.15,alloy)
 return dict(port=(0,0,7.9),axis='z',rotation=False)

# Final manufacturing pass: structure wraps surfaces; flight areas stay clear.
base_pad=pad
base_hub=dock_hub
base_ring=ring
base_drum=drum
base_wheel=wheel
base_derrick=derrick
base_buoy=buoy
base_rig=rig
base_cluster=cluster
base_salvage=salvage

def pad(x=0,y=0,z=0,w=35,d=31):
 port=base_pad(x,y,z,w,d)
 for side in [-1,1]:
  for off in [-.45,0,.45]:
   xx=x+w*off;c=Vector((xx,y-2.7,z+side*(d/2+.6)))
   plated_box(c,(3.5,5,2),steel);vent(c+Z*side*1.1,2.7,3.4,Z*side,X)
  for sx in [-1,1]:
   c=Vector((x+sx*w*.44,y-3,z+side*d*.43));plated_box(c,(4.4,5.8,4.4),steel)
   pipe(c+Y*2+X*.8,c-Y*2+X*.8,.21)
 # Door and aerials make the cabin an industrial control room.
 box((x+1,y+1.8,z-d/2+3.85),(1.5,2.5,.25),steel)
 for xx in [-2,0,3]:mast(x+xx,y+4,z-d/2+1.3,5+xx*.8)
 return port

def dock_hub(w=32,h=28,length=32,z=0):
 port=base_hub(w,h,length,z);f=z+length/2
 # Deep machinery frame around the larger opening.
 frame((0,0,f+1),20.5,13,2.8,1.3,steel)
 frame((0,0,f+2.3),19.2,11.8,.65,.3,alloy)
 for side in [-1,1]:
  for y in [-5.1,0,5.1]:
   c=Vector((side*11.3,y,f+2.6));box(c,(1.7,2.5,1),steel)
   box(c+Z*.6,(.3,1.2,.2),warm)
  for y in [-h*.44,h*.44]:
   edge_trunk((-w*.30,y,f+.8),(w*.30,y,f+.8),Z,1.8)
  edge_trunk((side*w*.43,-h*.29,f+.8),(side*w*.43,h*.29,f+.8),Z,2)
 # The entry walls are readable panels rather than an unlit void.
 for zz in [f-2,f-5,f-8,f-11]:
  for side in [-1,1]:
   box((side*8.9,0,zz),(.10,9,2.4),alloy)
   box((side*8.8,-3.8,zz),(.11,.18,1.5),warm)
   box((0,side*5.15,zz),(17.5,.1,2.4),alloy)
 return port

def ring():
 info=base_ring()
 # Structural bands are nested raised hoops following the rounded section.
 for k in range(8):
  a=k*math.tau/8;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0))
  for off in [-1.3,1.3]:
   pts=[]
   for j in range(17):
    q=j*math.tau/16;c=math.cos(q);s=math.sin(q)
    pts.append(n*(57+9.8*math.copysign(abs(c)**.65,c))+Z*(12.3*math.copysign(abs(s)**.65,s))+t*off)
   for aa,bb in zip(pts,pts[1:]):tube(aa,bb,.26,alloy,8)
 return info

def drum():
 info=base_drum()
 frame((0,0,49),20,13,2.4,1.2,steel)
 for k in range(8):
  a=k*math.tau/8;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0))
  for side in [-1,1]:
   for zz in [-30,-12,7,26]:
    c=n*36.7+t*side*2+Z*zz;tube(c-Z*5,c+Z*5,.8,alloy,12)
    tube(c-Z*5,c-Z*4.5,1.05,steel,12);tube(c+Z*4.5,c+Z*5,1.05,steel,12)
  if k%2==0:
   for r in [17,25]:machinery(n*r+Z*47,5,5,Z,t,2)
 for zz in [43,39,35]:
  for side in [-1,1]:
   box((side*8.9,0,zz),(.1,10.4,3),alloy);box((0,side*5.2,zz),(17.8,.1,3),alloy)
 return info

def wheel():
 info=base_wheel()
 for i in range(8):
  a=i*math.tau/8;b=(i+1)*math.tau/8
  tube((18*math.cos(a),18*math.sin(a),-8),(18*math.cos(b),18*math.sin(b),-8),1.8,steel,8)
 for i in range(12):
  a=i*math.tau/12;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0))
  machinery(n*81-Z*4,5,3,Z,t,2)
 return info

def derrick():
 info=base_derrick()
 for x in [-9,9]:
  for z in [-8,8]:
   tube((x,-2.1,z),(x,-.4,z),1.4,steel,16);tube((x,-.5,z),(x,-.2,z),1.9,alloy,16)
   pipe((x,-.2,z),(x,1,z),.42);pipe((x,1,z),(x*.30,1,z),.42);pipe((x*.3,1,z),(x*.3,-2,z),.42)
   for side in [-1,1]:
    pipe((x+side*3,-1,z-2),(x+side*3,-1,z+2),.075)
    for zz in [-2,2]:tube((x+side*3,-3,z+zz),(x+side*3,-1,z+zz),.07,orange,6)
 for side in [-1,1]:
  edge_trunk((-14,-24,side*14.5),(14,-24,side*14.5),Z*side,3)
  for x in [-13,0,13]:machinery((x,-24,side*15),4,3,Z*side,X,2)
 for y in [-14,-4,7]:
  box((2,y,4.8),(.25,4,.25),warm);machinery((-1,y,4.5),3,5,Z,X,1)
 return info

def ribbed_panel(c,w,h,n):
 c=Vector(c);n=Vector(n).normalized();u=X;v=n.cross(u).normalized()
 box(c,(w,h,.9),steel,(u,v,n));box(c+n*.5,(w-.6,h-.6,.12),black,(u,v,n))
 for j in range(int(h/.35)):
  box(c+n*.68+v*(-h/2+.3+j*.35),(w-.8,.12,.20),alloy,(u,v,n))
 for side in [-1,1]:box(c+u*side*(w/2-.2),( .4,h,1),alloy,(u,v,n))
 return c,v

def buoy():
 # Suppress old vertically framed yellow-block panels, replace with hinged fins.
 global vertical_radiator
 save=vertical_radiator;vertical_radiator=lambda *args:None
 info=base_buoy();vertical_radiator=save
 for c,w,h,n,root in [((-9,19,-15),9,12,(0,.35,1),(-9,12,-13)),((0,-20,15),9,8,(0,-.6,1),(0,-13,12))]:
  center,v=ribbed_panel(c,w,h,n)
  for side in [-1,1]:
   anchor=Vector(root)+X*side*w*.38;end=center-v*h*.42+X*side*w*.38
   tube(anchor,end,.45,steel,12);tube(anchor-Z*.4,center+X*side*w*.38,.20,alloy,8)
 for side in [-1,1]:
  c=Vector((side*9,-10,16));tube(c-X*3,c+X*3,1.6,ivory[1],12)
  for xx in [-2.5,2.5]:tube(c+X*(xx-.2),c+X*(xx+.2),1.75,steel,12)
  a=Vector((side*15,11,13));b=Vector((side*12,4,12));tube(a,b,1.4,steel,6)
  pipe((side*13,8,14),(side*13,-3,14),.45);pipe((side*13,-3,14),(side*10,-3,17),.45)
 return info

def rig():
 info=base_rig()
 # Wrap the upright housing and bridge in dark flanged frames and stepped equipment.
 for x in [7,21]:
  edge_trunk((x,17,1),(x,25,1),Z,2)
 for y in [17,25]:edge_trunk((7,y,1),(21,y,1),Z,2)
 machinery((14,21,1.2),10,6,Z,X,2)
 for x in [-8,0,6]:machinery((x,13,3),5,5,Z,X,1)
 for y in [-17,-3,10]:
  for k in range(12):
   a=k*math.tau/12;n=Vector((math.sin(a),0,math.cos(a)));t=Vector((n.z,0,-n.x));c=Vector((14,y,-7))+n*11.6
   box(c,(5,2.3,.8),steel,(t,Y,n));window_band(c+n*.6,3,.35,n,t)
 for y in [-14,-5]:plated_box((26,y,-7),(5,6,9),ivory[1]);machinery((29,y,-7),7,4,X,Z,2)
 return info

def cluster():
 info=base_cluster()
 for x in [-13,13]:edge_trunk((x,-18,14.6),(x,4,14.6),Z,2)
 for y in [-17,3]:edge_trunk((-12,y,14.6),(12,y,14.6),Z,1.8)
 machinery((-8,-5,15),4,7,Z,X,1)
 for y in [-11,-2]:box((5,y,15.3),(.2,2.3,.2),warm)
 return info

def salvage():
 info=base_salvage()
 for y in [-17,16]:
  box((0,y,7.8),(28,2.5,2.5),steel)
  for x in [-10,-5,0,5,10]:box((x,y,9.2),(3.5,.6,.2),alloy)
 for x in [-11,11]:
  for y in [-14,-7,0,7,14]:
   box((x,y,8.6),(2.8,4.7,1.8),steel);box((x,y,9.6),(1.6,3,.3),ivory[1])
 # Equipment covers and winding service pipes surround the central flight plate.
 for y in [-14,14]:
  for off in [0,.5,1]:pipe((-11,y+off,9),(11,y+off,9),.20)
 for x in [16,19]:
  pipe((x,-17,2),(x,8,2),.45);pipe((x,-17,2),(6,-17,4),.45)
 for xx in [-5,0,5]:
  vent((xx,24,-.6),2,10,Z,X)
  tube((xx,18,0),(xx,30,0),.17,alloy,8)
 for c,w,h in [((-30,4,1),7,8),((20,-13,1),7,8),((-10,21,0),7,6)]:
  surface_frame(c,w,h,Z,X,.6)
 # Sloped left keel plate and layered right service tanks.
 plate([(-9,-18,1),(-7,-28,1),(3,-40,0),(0,-22,2)],ivory[1],Z,.4)
 for y in [-22,-29]:machinery((0,y,2),4,5,Z,X,2)
 for x in [7,10]:cylinder((x,-33,0),(x,-22,0),1.2,10,2)
 for x in [18,23,28]:vent((x,5,4.6),2.2,3.8,Z,X)
 return info

def faceted_pod(start,end,y,z,r):
 rows=[]
 for xx,rr in [(start,r*.72),(start+2,r),(end-2,r),(end,r*.72)]:
  rows.append([Vector((xx,y+rr*math.cos(i*math.tau/8+math.pi/8),z+rr*math.sin(i*math.tau/8+math.pi/8))) for i in range(8)])
 for a,b in zip(rows,rows[1:]):
  for i in range(8):
   n=(a[i]+a[(i+1)%8])/2-Vector((a[i].x,y,z));plate([a[i],b[i],b[(i+1)%8],a[(i+1)%8]],ivory[i%4],n,.12)
 poly(rows[-1],steel);poly(rows[0],steel)
 for xx in [start+2,end-2]:
  for i in range(8):
   a=i*math.tau/8+math.pi/8;b=(i+1)*math.tau/8+math.pi/8;tube((xx,y+r*math.cos(a),z+r*math.sin(a)),(xx,y+r*math.cos(b),z+r*math.sin(b)),.3,steel,8)

r4_drum=drum
r4_wheel=wheel
r4_buoy=buoy
r4_rig=rig
r4_cluster=cluster
r4_salvage=salvage

def drum():
 info=r4_drum()
 # Continuous chamber, deep enough to preserve the approach test volume.
 for side in [-1,1]:
  box((side*9.3,0,31),(.6,11.2,36),alloy)
  box((0,side*5.6,31),(18,.6,36),alloy)
  for zz in [22,28,34,40,46]:
   box((side*8.94,0,zz),(.1,9.7,.15),steel)
   box((side*8.8,3.8,zz),(.15,1,.5),warm)
 box((0,0,12.5),(18,10.5,.5),steel)
 for i in range(12):
  a=i*math.tau/12;b=(i+1)*math.tau/12
  for r1,z1,r2,z2 in [(30,48.7,37,46),(37,46,39,41)]:
   plate([(r*math.cos(t),r*math.sin(t),zz) for r,zz,t in [(r1,z1,a),(r1,z1,b),(r2,z2,b),(r2,z2,a)]],steel,Z,.25)
 return info

def wheel():
 info=r4_wheel()
 for zz in [-4,-9]:
  for i in range(12):
   a=i*math.tau/12;b=(i+1)*math.tau/12
   plate([(r*math.cos(t),r*math.sin(t),zz) for r,t in [(17,a),(20,a),(20,b),(17,b)]],ivory[i%4],Z,.5)
 for i in range(12):
  a=i*math.tau/12;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0));c=n*81+Z*13.8
  box(c,(3.3,11.5,1.5),steel,(t,n,Z));box(c+Z*.9,(2.4,9,.35),ivory[1],(t,n,Z))
 return info

def buoy():
 info=r4_buoy()
 # Break long luminous hatch strips with real corner clamps.
 for side in [-1,1]:
  for yy in [-4,2]:
   plated_box((side*6.2,yy,19.3),(1.8,2.3,1.4),steel)
  pipe((-5,-1+side*6.6,19.5),(5,-1+side*6.6,19.5),.3)
  a=Vector((side*16,10,13));b=Vector((side*11,2,14));d=(b-a).normalized();u=d.cross(Z).normalized()
  box((a+b)/2,((b-a).length,2.8,2.5),steel,(d,u,Z))
  plate([a+u*1.2+Z*1.4,b+u*1.2+Z*1.4,b-u*1.2+Z*1.4,a-u*1.2+Z*1.4],ivory[1],Z,.15)
 surface_frame((0,-10,18.3),7,5,Z,X,.8);box((0,-10,18.5),(5.8,3.8,.5),blue[1])
 for z in [-5.5,5.5]:pipe((17,-.1,z),(30,-.1,z),.25)
 for x in [17,30]:pipe((x,-.1,-5.5),(x,-.1,5.5),.25)
 return info

def rig():
 info=r4_rig()
 # Correct primary proportions as a connected assembly, not detached decorations.
 def move(v):
  x,y,z=v
  f=1+.18*max(0,min(1,(18-y)/6))
  x=14+(x-14)*f if x>=0 else 14-14*f+x*.85
  z=-7+(z+7)*(1+(f-1)*.67)
  if y>=-24:y=-24+(y+24)*.78 if y<=14 else y-8.36
  return (x,y,z)
 for vertices,_,_ in BATCH.values():
  for i,v in enumerate(vertices):vertices[i]=move(v)
 info['port']=move(info['port'])
 # Long stepped drill and inward hooked terminal jaws.
 for j,(r,lo,hi) in enumerate([(4,-38,-34),(3.2,-42,-38),(2.4,-45,-42),(1.6,-48,-45),(.7,-51,-48)]):
  tube((14,lo,-7),(14,hi,-7),r,alloy,16)
  tube((14,hi-.4,-7),(14,hi,-7),r*1.18,steel,16)
 for side in [-1,1]:
  a=Vector((14+side*6,-42,-7));b=Vector((14+side*9,-47,-7));c=Vector((14+side*4,-49,-7))
  for aa,bb in [(a,b),(b,c)]:
   d=(bb-aa).normalized();u=d.cross(Z).normalized();box((aa+bb)/2,((bb-aa).length,2.5,3),steel,(d,u,Z))
   plate([aa+u+Z*1.6,bb+u+Z*1.6,bb-u+Z*1.6,aa-u+Z*1.6],ivory[1],Z,.1)
  tube(b-Z*1.8,b+Z*1.8,1.9,alloy,16)
 # Sloping bridge shoulder, facing up and forward.
 for x in [3,9]:
  pts=[(x-2,6,0),(x+2,6,0),(x+2,13,-6),(x-2,13,-6)];n=Vector((0,.65,.76))
  plate(pts,steel,n,.6);vent(Vector((x,9.5,-3))+n*.7,3,6,n,X)
 return info

def cluster():
 info=r4_cluster()
 cylinder((-34,-2,7),(-26,-2,0),2.7,12,2)
 for x in [-28,28,31]:tube((x-.4,-2,0),(x+.4,-2,0),4.5,steel,16)
 for side in [-1,1]:
  for z in [-13,13]:
   pipe((-13,7.6,z),(13,7.6,z),.1)
   for x in [-13,-7,7,13]:tube((x,6.4,z),(x,7.6,z),.08,steel,6)
 for x in [-.65,0,.65]:
  tube((x,29,-10),(x,34+abs(x)*2,-10),.08,alloy,8)
  tube((x,34+abs(x)*2,-10),(x,34.3+abs(x)*2,-10),.12,warm,8)
 plated_box((-5,7,-10),(5,3,4),steel)
 for y in [12,19,26]:box((0,y,-8.8),(1.4,.45,.35),warm)
 return info

def salvage():
 info=r4_salvage()
 # Feet fully bridge the tower-to-roof gap; both are visible from the hero.
 for x in [-5,3]:
  plated_box((x,16,-3),(3,5,4),steel)
  a=Vector((x*2,15,-1));b=Vector((x,25,-3));tube(a,b,.8,steel,8)
  pipe(a+Z*.9,b+Z*.9,.2)
 # Raised bevelled landing lip, mechanically seated in its thick frame.
 for side in [-1,1]:
  box((side*10.4,0,8.2),(.8,18.5,1.7),alloy)
  box((0,side*9.4,8.2),(21.5,.8,1.7),alloy)
  for y in [-7,7]:plated_box((side*10.4,y,9),(2.2,2.2,1),steel)
 # Paint loss is localized on markings, with broad muted scuffs across deck.
 for i in range(32):
  x=random.uniform(-9,9);y=random.choice([-7.5,7.5]);box((x,y,7.902),(random.uniform(.1,.8),.6,.01),deckpaint)
 for c,size in [((-4,4,7.905),(4,1.1,.008)),((3,-3,7.905),(3,1.8,.008))]:box(c,size,blue[3])
 truss((-26,1,-3),(-14,1,-3),7)
 # Cockpit window mullions and a raised roof housing.
 
 plated_box((20,15,-3),(7,1.6,7),steel);machinery((20,16,-3),5,5,Y,X,2)
 # Curved service route and asymmetric underside block.
 plated_box((-3,-28,-1),(5,6,6),steel)
 for x in [7,10]:
  pipe((x,-33,1),(x,-35,1),.45);pipe((x,-35,1),(x-4,-35,3),.45)
 return info

r5_drum=drum
r5_assembly=assembly
r5_wheel=wheel

def drum():
 info=r5_drum()
 for k in range(4):
  a=k*math.pi/2;n=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0))
  c=n*22+Z*45.7;box(c,(5.5,18,.9),steel,(t,n,Z))
  for off in [-1.6,0,1.6]:pipe(n*13+t*off+Z*46.5,n*31+t*off+Z*46.5,.22 if off else .42)
  for r in [14,21,29]:box(n*r+Z*47,(6,.7,.6),alloy,(t,n,Z))
 return info

def assembly():
 info=r5_assembly()
 for k in range(8):
  a=k*math.tau/8+math.pi/8;n=Vector((0,math.cos(a),math.sin(a)));t=X.cross(n)
  c=Vector((67,0,-2))+n*7.5
  if k%2==0:machinery(c,7,3.5,n,X,2)
  else:window_band(c,7,.5,n,X)
  pipe(Vector((61,0,-2))+n*7.8,Vector((73,0,-2))+n*7.8,.20)
 return info

def wheel():
 info=r5_wheel()
 for zz in [-8,-13]:
  for i in range(12):
   a=i*math.tau/12;b=(i+1)*math.tau/12
   plate([(r*math.cos(t),r*math.sin(t),zz) for r,t in [(20,a),(23,a),(23,b),(20,b)]],steel if i%3==0 else ivory[1],Z,.4)
 return info

# Retain round-six Drum: the replacement shell regressed under independent review.
r6_assembly=assembly
r6_buoy=buoy
r6_rig=rig
r6_salvage=salvage

def narrow_fins(x,y,z,w,h):
 count=4 if w>8 else 1
 for j in range(count):
  xx=x-w/2+(j+.5)*w/count;ww=w/count*.87
  box((xx,y,z),(ww,h,.5),black)
  for yy in range(int(h/.3)):
   box((xx,y-h/2+.2+yy*.3,z+.35),(ww-.18,.10,.12),alloy)
  for side in [-1,1]:box((xx+side*ww/2,y,z+.1),(.12,h,.7),orange)
  for side in [-1,1]:box((xx,y+side*h/2,z),(ww,.15,.6),steel)

def assembly():
 global vertical_radiator
 save=vertical_radiator;vertical_radiator=narrow_fins
 info=r6_assembly();vertical_radiator=save
 for side in [-1,1]:
  box((side*9.3,0,4),(.6,11.2,28),alloy);box((0,side*5.6,4),(18,.6,28),alloy)
 box((0,0,-10),(18,10.5,.4),steel)
 # Terminal end cross and flanged octagonal circumference.
 for i in range(8):
  a=i*math.tau/8+math.pi/8;b=(i+1)*math.tau/8+math.pi/8
  tube((73,7.8*math.cos(a),-2+7.8*math.sin(a)),(73,7.8*math.cos(b),-2+7.8*math.sin(b)),.45,steel,8)
 box((75.4,0,-2),(.5,10,1.1),steel);box((75.4,0,-2),(.5,1.1,10),steel)
 for yy in [-3,3]:box((75.7,yy,-2),(.2,.6,.7),warm)
 for yy in [-45,-27,29,48]:
  for side in [-1,1]:box((side*1.7,yy,-14.4),(.2,1.8,.3),warm)
 return info

def buoy():
 info=r6_buoy()
 # Continuous low structural machinery belt with four deep equipment compartments.
 for i in range(16):
  a=i*math.tau/16;b=(i+1)*math.tau/16
  n=Vector((math.sin((a+b)/2),0,math.cos((a+b)/2)));t=Vector((n.z,0,-n.x))
  pts=[(17.8*math.sin(aa),yy,17.8*math.cos(aa)) for aa,yy in [(a,-15),(b,-15),(b,-11),(a,-11)]]
  plate(pts,steel,n,.6)
  if i%4==0:machinery(n*18.4-Y*12.7,6,3,n,t,2)
  else:pipe(n*18.3+t*-2-Y*13,n*18.3+t*2-Y*13,.3)
 for side in [-1,1]:
  c=Vector((side*14,4,12.8));plated_box(c,(4.5,12,4),steel)
  # Broad continuous diagonal gusset from pad corner to pier.
  pts=[(side*17,10,15),(side*13,10,15),(side*10,2,15),(side*13,2,15)]
  plate(pts,ivory[1],Z,.6)
 return info

def rig():
 info=r6_rig()
 # Seated end sockets absorb diagonal tips and present a clear load path.
 for z in [-2,12]:
  plated_box((-12,3,z),(7,4,4),steel);plated_box((8,-16,z-6),(5,6,4),steel)
 for side in [-1,1]:
  for x,y in [(14+side*9,-47),(14+side*6,-42)]:
   tube((x,y,-4.9),(x,y,-4.5),1.75,alloy,16);tube((x,y,-4.5),(x,y,-4.2),1.15,steel,16)
  # Tapered steel terminal teeth point inward.
  a=Vector((14+side*4,-49,-7));b=Vector((14+side*1.8,-50.8,-7))
  prism([a+Y*.9,a-Y*.9,b],Z,2.1,alloy)
 for j in range(5):tube((14,-51-j*.5,-7),(14,-51.5-j*.5,-7),max(.1,.7-j*.14),alloy,12)
 return info

def salvage():
 info=r6_salvage()
 # Unequal lower attachment and bent plumbing replace the straight stack rhythm.
 plated_box((-6,-26,-3),(7,7,8),steel)
 cylinder((-8,-33,-3),(-8,-27,-3),2,12,2)
 for z in [1,2]:
  pipe((-8,-33,z),(-3,-36,z),.4);pipe((-3,-36,z),(5,-36,z),.4)
 # Fitted left support and dark mechanical shoulder below the open tower.
 a=Vector((-10,15,-2));b=Vector((-5,25,-3));tube(a,b,.6,steel,8)
 machinery((-1,16,-.5),7,2.8,Z,X,2)
 return info
