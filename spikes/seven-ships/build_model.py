"""Seven approved ship studies, Codex. Metres, Y up, +Z forward.
Blender --background --python build_model.py -- <role>
Shared geometry/material machinery derived from the approved Porter study.
"""
import sys
from pathlib import Path
exec(compile((Path(__file__).parent/'geometry.py').read_text(), 'geometry.py', 'exec'))
ROLE=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'interceptor'
DEST=OUT/ROLE;DEST.mkdir(exist_ok=True)
random.seed(827+sum(map(ord,ROLE)))
red=[material('salvage-red-'+str(i),(.24+i*.035,.095+i*.009,.065+i*.01),.45,.58) for i in range(3)]
grey=[material('armour-'+str(i),(.115+i*.018,.13+i*.018,.14+i*.018),.55,.5) for i in range(4)]
gold=[material('ochre-'+str(i),(.57+i*.025,.32+i*.02,.085+i*.014),.4,.55) for i in range(3)]
PAINT=ivory+blue+red+grey+gold
deck=material('flight-deck',(.028,.035,.041),.35,.65)

def ring(z,r,width,mat,inner=None,x=0,y=0,segments=64):
 inner=inner if inner is not None else r-width*.7
 rr=[(z-width/2,r),(z+width/2,r),(z+width/2,inner),(z-width/2,inner)]
 for a,b in zip(rr,rr[1:]+rr[:1]):
  for i in range(segments):
   t=i*math.tau/segments;u=(i+1)*math.tau/segments
   poly([(x+a[1]*math.cos(t),y+a[1]*math.sin(t),a[0]),(x+a[1]*math.cos(u),y+a[1]*math.sin(u),a[0]),(x+b[1]*math.cos(u),y+b[1]*math.sin(u),b[0]),(x+b[1]*math.cos(t),y+b[1]*math.sin(t),b[0])],mat)

def body(name,x,z,length,w,h,colors=ivory,y=0,nose=.75):
 steps=max(4,round(length/4))
 rows=[]
 for i in range(steps+1):
  f=i/steps; fac=.82 if i==0 else nose if i==steps else 1
  rows.append((z-length/2+f*length,w*fac,y+h*fac,y-h*fac,min(w,h)*.30))
 hull(name,x,rows,colors)
 # Panel bays, roof access, rails and ribbed flank heat exchangers.
 for zz in [z-length*.28,z,z+length*.28]:
  if length<10 and zz!=z:continue
  hatch(x,y+h+.15,zz,min(3,w*.95),min(3.4,length*.18))
  for side in [-1,1]:
   xx=x+side*(w+.15)
   box((xx,y,zz),(.17,h*1.10,min(3,length*.17)),steel)
   for j in range(9):box((xx+side*.12,y-h*.45+j*h*.112,zz),(.13,.085,min(2.7,length*.16)),alloy)
   for yy in [y-h*.69,y+h*.69]:
    cable([(xx,yy,zz-1.4),(xx+side*.3,yy,zz-1.15),(xx+side*.3,yy,zz+1.15),(xx,yy,zz+1.4)],.09,alloy)
 for side in [-1,1]:
  cable([(x+side*w*.87,y+h*.6,z-length*.38),(x+side*(w+.3),y+h*.65,z-length*.25),(x+side*(w+.3),y+h*.65,z+length*.25)],.15,alloy)

def engine(x,y,z,length=15,r=3.5,colors=ivory):
 # Profiled nacelle: barrel, rounded shoulder, recessed inset cap. Deliberate
 # colour regions rather than independently randomized square roof panels.
 rows=[]
 for t,f in [(-.5,.78),(-.42,.98),(-.30,1),(-.12,1),(.10,1),(.28,.98),(.40,.90),(.5,.70)]:
  rows.append((z+t*length,r*f,y+r*f,y-r*f,r*f*.45))
 hull('profiled-drive',x,rows,[colors[0]])
 nozzle(x,y,z-length/2-1,r*1.04)
 # Dark intake/exchanger face with a thick frame, matching the approved target.
 zz=z+length/2+.15
 box((x,y,zz),(r*1.05,r*1.15,.28),black)
 for j in range(12):box((x-r*.44+j*r*.08,y,zz+.18),(.10,r*.93,.12),steel)
 for side in [-1,1]:
  box((x+side*r*.61,y,zz-.06),(.26,r*1.30,.65),alloy)
  box((x,y+side*r*.64,zz-.06),(r*1.35,.26,.65),steel)
 # Shoulder service troughs have framed vents, wrapped pipes and long pressure
 # cylinders; the large side skin is left intact between service bays.
 for side in [-1,1]:
  xx=x+side*r*1.01
  box((xx,y,z-length*.12),(.35,r*.95,length*.27),steel)
  for k in range(12):box((xx+side*.23,y-r*.36+k*r*.063,z-length*.12),(.16,.07,length*.22),alloy)
  for yy in [y+r*.65,y-r*.65]:
   cable([(xx-side*.2,yy,z-length*.36),(xx+side*.25,yy,z-length*.28),(xx+side*.25,yy,z+length*.18)],.12,alloy)
  for dz in [-.31,.20]:
   box((xx+side*.1,y,z+length*dz),(.28,r*.9,length*.1),colors[-1])
   box((xx+side*.28,y-r*.45,z+length*dz),(.12,.20,.7),warm)
  tube((x+side*r*.72,y-r*.82,z-length*.33),(x+side*r*.72,y-r*.82,z+length*.22),.26,alloy,16)
 for side in [-1,1]:
  box((x+side*r*.78,y,zz),(.36,r*.96,.27),steel)
  box((x+side*r*.78,y,zz+.18),(.13,r*.75,.06),warm)
 for dz in [-length*.26,length*.24]:
  # Broad desaturated identification bands run around nacelle shoulders.
  for side in [-1,1]:box((x+side*(r+.08),y,z+dz),(.12,r*1.35,1.2),colors[-1] if colors!=ivory else blue[1])
  radiator(x,y+r+.14,z+dz,r*.95,2.3)
 hatch(x,y+r+.17,z,r*.85,2.5)

def cabin(z,length=14,w=4.2,h=3.5,colors=ivory,x=0,y=0):
 rows=[(z-length/2,w*.9,y+h*.68,y-h,.8),(z-length*.25,w,y+h,y-h,1),(z+length*.15,w*.95,y+h*.82,y-h,1),(z+length/2,w*.57,y+h*.02,y-h*.7,.6)]
 hull('command-pressure-shell',x,rows,colors)
 # Fully sealed cockpit: dark glazing lies on an enclosed roof, framed by metal.
 za=z-length*.12;zb=z+length*.23;ya=y+h+.9;yb=y+h*.65+.6
 pts=[(x-w*.62,ya,za),(x+w*.62,ya,za),(x+w*.46,yb,zb),(x-w*.46,yb,zb)]
 prism(pts,(0,.8,.3),.10,glass)
 for a,b in zip(pts,pts[1:]+pts[:1]):tube(a,b,.19,steel,10)
 tube((x,ya+.06,za),(x,yb+.06,zb),.12,alloy,10)
 l=Vector(pts[0]).lerp(Vector(pts[3]),.58);r_=Vector(pts[1]).lerp(Vector(pts[2]),.58)
 tube(l,r_,.11,steel,10)
 poly([(x-w*.62,ya,za),(x+w*.62,ya,za),(x+w*.84,y+h*.5,za),(x-w*.84,y+h*.5,za)],colors[0])
 # Rear enclosure and narrow side windows.
 for side in [-1,1]:
  a=(x+side*w*.62,ya,za);b=(x+side*w*.46,yb,zb);c=(x+side*w*.72,y+h*.58,zb);d=(x+side*w*.84,y+h*.65,za)
  prism([a,b,c,d],(side,.3,0),.06,glass)
  for aa,bb in [(a,d),(d,c),(c,b)]:tube(aa,bb,.14,steel,8)
  box((x+side*w*.77,y-h*.2,z+length*.37),(.35,.7,.3),steel)
  box((x+side*w*.77,y-h*.2,z+length*.39),(.15,.35,.08),warm)
 hatch(x,y+h*.74+.2,z-length*.36,w*.8,2)
 radiator(x,y+h*.10+.15,z+length*.43,w*.53,1.2)
 # Raised cheek housings, layered sills and recessed service bays.
 for side in [-1,1]:
  xx=x+side*w*.94
  box((xx,y-.4,z-length*.17),(.5,h*1.1,length*.35),steel)
  box((xx+side*.3,y-.4,z-length*.17),(.18,h*.86,length*.29),colors[0])
  for k in range(8):box((xx+side*.43,y-h*.4+k*h*.105,z-length*.2),(.1,.08,length*.19),alloy)
  box((xx+side*.47,y-h*.52,z-length*.25),(.10,.22,.8),warm)
  cable([(x+side*w*.9,y+h*.3,z-length*.37),(x+side*(w+1),y+h*.2,z-length*.25),(x+side*(w+1),y+h*.2,z+length*.08)],.23,alloy)
  for dz in [-.28,-.08]:
   zz=z+length*dz
   tube((x+side*(w+.8),y-.3,zz),(x+side*(w+.8),y+1.5,zz),.32,steel,12)
  # Human-scale forward lamps, armored eyebrows and layered forehead.
  lamp(x+side*w*.43,y-h*.36,z+length*.50)
 for dz in [-.39,-.25]:
  hatch(x,y+h+.18,z+length*dz,w*.72,1.0)

def spine(a,b,r=2.6):
 tube((0,0,a),(0,0,b),r,steel,16)
 # Pressure conduit has panelled armour sections and independent service trenches.
 for zz in range(round(a)+2,round(b)-1,6):
  for sector in range(8):
   ta=sector*math.tau/8+.025;tb=(sector+1)*math.tau/8-.025
   if sector in [0,4]:continue
   pts=[(r*math.cos(ta),r*math.sin(ta),zz-1.8),(r*math.cos(tb),r*math.sin(tb),zz-1.8),(r*math.cos(tb),r*math.sin(tb),min(zz+2.9,b)),(r*math.cos(ta),r*math.sin(ta),min(zz+2.9,b))]
   plate(pts,ivory[sector%3],(math.cos((ta+tb)/2),math.sin((ta+tb)/2),0),.12)
  for side in [-1,1]:
   x=side*(r+.55)
   box((x,0,zz),(.85,2.6,3.7),steel)
   box((x+side*.48,0,zz),(.16,2.05,2.8),steel)
   for yy in [-.65,.65]:tube((x+side*.7,yy,zz-1.5),(x+side*.7,yy,zz+1.5),.24,alloy,12)
   for dz in [-1.1,1.1]:tube((x+side*.7,-.9,zz+dz),(x+side*.7,.9,zz+dz),.13,orange,10)
   for yy in [-1.4,1.4]:
    tube((x,yy,zz-2),(x,yy,zz+2),.20,alloy,12)
   box((x+side*.7,.7,zz+1),(.12,.2,.7),warm)
 for z in range(round(a)+2,round(b)-1,5):
  ring(z,r+.45,.75,alloy,inner=r-.1,segments=32)
  for angle in [math.pi*.25,math.pi*.75,math.pi*1.25,math.pi*1.75]:
   x,y=math.cos(angle)*(r+.7),math.sin(angle)*(r+.7)
   tube((x,y,z-2),(x,y,min(z+3,b)),.23,orange if angle<1 else alloy,12)
  if z%2:
   box((0,r+.35,z),(2.3,.6,2),steel);radiator(0,r+.7,z,1.8,1.3)
  else:
   tube((-.8,r+.25,z-1),(.8,r+.25,z-1),.35,alloy,12)
  for side in [-1,1]:lamp(side*(r+.5),0,z)

def mount(a,b,r=.8):
 tube(a,b,r,steel,8)
 d=(Vector(b)-Vector(a));
 for t in [.2,.8]:
  p=Vector(a)+d*t;tube(p-d.normalized()*.3,p+d.normalized()*.3,r*1.22,alloy,8)

def gun(x,y,z,s=1):
 box((x,y,z),(1.5*s,1.3*s,3.4*s),steel)
 box((x,y+.45*s,z-.3*s),(1.6*s,1*s,2.6*s),grey[2])
 for dx in [-.38,.38]:
  tube((x+dx*s,y,z+.8*s),(x+dx*s,y,z+4*s),.20*s,alloy,12)
  ring(z+3.9*s,.28*s,.35*s,steel,.14*s,x+dx*s,y,24)
 box((x,y+.8*s,z),(1.25*s,.12*s,1.2*s),ivory[0])
 for side in [-1,1]:
  tube((x+side*.5*s,y+.3*s,z-s),(x+side*.5*s,y+.3*s,z+1.6*s),.27*s,alloy,12)
  box((x+side*.72*s,y+.35*s,z),( .18*s,.65*s,1.5*s),grey[1])

def dish(x,y,z,r=4):
 mount((x,0,z),(x,y,z),.6)
 # Shallow upward-facing bowl with a full ribbed support beneath.
 for j in range(48):
  t=j*math.tau/48;u=(j+1)*math.tau/48
  for k in range(6):
   ra=r*k/6;rb=r*(k+1)/6
   def v(a,b):return (x+a*math.cos(b),y+.045*a*a,z+a*math.sin(b))
   poly([v(ra,t),v(rb,t),v(rb,u),v(ra,u)],ivory[j%3])
  if j%4==0:
   mount((x,y-.3,z),(x+r*math.cos(t),y+.045*r*r-.16,z+r*math.sin(t)),.10)
 for j in range(3):
  t=j*math.tau/3;mount((x+r*.85*math.cos(t),y+.045*r*r,z+r*.85*math.sin(t)),(x,y+r*.9,z),.10)
 tube((x,y+r*.7,z),(x,y+r,z),.3,alloy,12)

def small_ship(role):
 if role=='interceptor':
  spine(-18,16,3.1);cabin(23,16,5.0,4.0)
  for x,y in [(8,0),(-8,0),(0,8),(0,-8)]:
   mount((0,0,-18),(x,y,-18),1.5);engine(x,y,-21,17,3.6)
  for side in [-1,1]:gun(side*4.3,.2,17,.65)
 elif role in ['patrol','raider']:
  pirate=role=='raider';c=grey+red+[ivory[0]] if pirate else ivory
  hull('armoured-central-hull',0,[(-26,5.5,2.2,-2,1.4),(-20,7.2,3.2,-3.2,1.7),(-12,7.4,3.5,-3.4,1.7),(-4,7,3.8,-3.4,1.7),(4,6.5,3.4,-3.2,1.6),(12,5.7,3.4,-3.2,1.5),(22,4.2,1.8,-2.8,1.2),(28,2.8,.8,-2.3,1.0)],c)
  # Tiered central pressure hull, separate shoulder armor and machinery valleys.
  hull('raised-keel',0,[(-22,3.7,4.7,2.7,1),(-16,4.2,5.2,2.7,1),(-9,4.2,5.2,2.7,1),(-2,3.8,5.0,2.6,1),(6,3.4,4.8,2.3,1),(12,3.2,4.3,2.1,.8)],c)
  for side in [-1,1]:
   mount((side*6,0,-10),(side*12.5,0,-12),1.2)
   engine(side*12.5,0,-14,23,4,red+grey if pirate else [ivory[0],ivory[1],blue[1]])
   gun(side*5.8,6.0,3,1.45 if pirate else 1.10)
   hull('shoulder-fairing',side*6,[(-10,1.4,4.3,1.0,.6),(-4,1.7,4.8,1.0,.7),(3,1.65,4.8,.8,.7),(10,1.3,3.8,.8,.6)],c)
   for zz in [-17,-9,-1]:
    tube((side*9,1.7,zz-2),(side*9,1.7,zz+2),.65,alloy,16)
    for yy in [.7,2.7]:tube((side*8.3,yy,zz-2.5),(side*8.3,yy,zz+2.5),.22,steel,12)
    for dz in [-1.3,1.3]:ring(zz+dz,.85,.4,steel,.65,side*9,1.7,24)
   cable([(side*7,2,-22),(side*9,3.3,-12),(side*7,3.5,11)],.38,alloy)
   # Armoured cheek pod is an independent major volume on either side of bridge.
   hull('forward-cheek',side*5.9,[(4,1.5,3.6,-1.8,.6),(9,1.9,3.5,-1.7,.8),(15,1.7,2.8,-1.4,.7),(20,1.3,1.7,-1.2,.6)],[red[0]] if pirate else [ivory[1]])
   for zz in [7,12,17]:
    box((side*7.5,.4,zz),(.4,2.2,2),steel)
    for k in range(6):box((side*7.77,-.45+k*.3,zz),(.18,.12,1.5),alloy)
   lamp(side*3.2,-1.1,27.4)
  cabin(15,15,3.8,3.2,c,x=.45 if pirate else 0,y=1.1)
  for z in [-18,-10,-2]:hatch(0,5.3,z,3.4,3.3)
  if pirate:
   # Offset ram is a single substantial armoured prow rather than decorative spikes.
   hull('offset-ram',-1.4,[(15,1.5,1.3,-2.8,.5),(23,1.4,.7,-2.6,.5),(28,1.4,.5,-2.4,.4),(29,1.2,.2,-2.2,.4)],red)
  else:
   for zz in [-10,-2]:
    for side in [-1,1]:radiator(side*5,4.9,zz,1.7,3)
   for side in [-1,1]:
    # Deliberate blue identity stripe across shoulder plates, not random recolor.
    for zz in [-5,-2,1]:box((side*6.6,4.83,zz),(1.6,.09,2.5),blue[1])
   # Faceted sensor radome with an equatorial cyan band.
   for i in range(3):
    z=-4+i*.01
   sphere('sensor', (0,6.4,-7), (2.3,1.5,2.3),alloy)
   ring_axis_y((0,6.15,-7),2.3,.18,cyan)
 elif role=='prospector':
  spine(-20,17,2.9);cabin(22,15,4.4,3.6,[gold[1],ivory[0]])
  for side in [-1,1]:
   engine(side*6.2,0,-23,15,3.4,[ivory[0],gold[0],gold[1]])
   mount((0,0,-4),(side*6,0,-4),.9)
   body('sample-pannier',side*6,-4,12,3,3,gold+ivory)
   for zz in [-7,-3,1]:box((side*9.15,0,zz),(.3,1.4,1.6),alloy)
  mount((0,-2,18),(0,-5.1,20),1.1)
  tube((0,-5.1,18),(0,-5.1,30),1.65,steel,24)
  for z in [19,23,27,30]:ring(z,1.9,.65,alloy,1.5,0,-5.1,32)
  tube((0,-5.1,30),(0,-5.1,34),.8,alloy,24)
  for i in range(32):
   a=i*.5;b=(i+1)*.5;z=29+i*.15
   mount((math.cos(a)*1.1,-5.1+math.sin(a)*1.1,z),(math.cos(b)*1.1,-5.1+math.sin(b)*1.1,z+.15),.14)
  # Conical stepped drill bit, segmented collar, independent opposing clamp jaws.
  for i in range(7):
   z=30+i*.65;r=1.5-i*.19
   tube((0,-5.1,z),(0,-5.1,z+.4),r,alloy,24)
   for j in range(8):
    a=j*math.tau/8+i*.25
    box((r*math.cos(a),-5.1+r*math.sin(a),z),(.25,.25,.35),steel)
  for side in [-1,1]:
   prism([(side*1.5,-7,25),(side*2.8,-7,26),(side*2.8,-7,31),(side*1.8,-7,33),(side*1.5,-7,32),(side*2.1,-7,30)],(0,1,0),.7,alloy)
  for side in [-1,1]:
   cable([(side*2,-5.1,19),(side*2.8,-5.1,29),(side*2,-5.1,32)],.35,gold[0])
   cable([(side*2,-1,15),(side*2,-4,17),(side*1.7,-5,19)],.22,rubber)
  mount((0,3,18),(0,7,18),.22);box((0,7.1,18),(1.4,1.8,1),steel);box((0,7.1,18.6),(.8,.8,.15),cyan)

def sphere(name,c,size,mat):
 for j in range(12):
  a=-math.pi/2+j*math.pi/12;b=a+math.pi/12
  for i in range(24):
   t=i*math.tau/24;u=t+math.tau/24
   def p(v,w):return(c[0]+size[0]*math.cos(v)*math.cos(w),c[1]+size[1]*math.sin(v),c[2]+size[2]*math.cos(v)*math.sin(w))
   poly([p(a,t),p(a,u),p(b,u),p(b,t)],mat)

def ring_axis_y(c,r,width,mat):
 for i in range(48):
  a=i*math.tau/48;b=(i+1)*math.tau/48
  poly([(c[0]+r*math.cos(a),c[1]-width/2,c[2]+r*math.sin(a)),(c[0]+r*math.cos(b),c[1]-width/2,c[2]+r*math.sin(b)),(c[0]+r*math.cos(b),c[1]+width/2,c[2]+r*math.sin(b)),(c[0]+r*math.cos(a),c[1]+width/2,c[2]+r*math.sin(a))],mat)

def explorer():
 global PREFIX
 spine(-23,21,2.5);cabin(29,14,4.1,3.5,ivory+gold)
 for side in [-1,1]:
  engine(side*7,0,-28,16,3.6,[ivory[0],ivory[1],gold[0]])
  mount((0,0,-25),(side*7,0,-25),1.1)
  sphere('tank',(side*4.2,1,-19),(1.6,1.6,3),steel)
 dish(0,9,-19,5)
 PREFIX='rotor:'
 # The floor is at radius 40 m. Shell extends 36..42 m, with a faceted 6 m tube.
 # Geometry is exactly concentric about the longitudinal Z axis.
 N=96;cross=[(39+3*math.cos(k*math.tau/16),3*math.sin(k*math.tau/16)) for k in range(16)]
 for j in range(N):
  a=j*math.tau/N;b=(j+1)*math.tau/N
  for k in range(len(cross)):
   ra,za=cross[k];rb,zb=cross[(k+1)%len(cross)]
   pts=[(ra*math.cos(a),ra*math.sin(a),za),(ra*math.cos(b),ra*math.sin(b),za),(rb*math.cos(b),rb*math.sin(b),zb),(rb*math.cos(a),rb*math.sin(a),zb)]
   norm=(Vector(pts[1])-Vector(pts[0])).cross(Vector(pts[3])-Vector(pts[0])).normalized()
   # Outward from tube cross-section centre.
   mid=sum((Vector(p) for p in pts),Vector())/4;centre=Vector((39*math.cos((a+b)/2),39*math.sin((a+b)/2),0))
   if norm.dot(mid-centre)<0:norm=-norm
   poly(pts,black)
   plate(pts,gold[(j//8)%3] if j%24 in range(3,7) else ivory[j%3],norm,.08,bolts=j%2==0)
  # Window and luminaire on forward outer face, at human scale.
  t=(a+b)/2;u=Vector((-math.sin(t),math.cos(t),0));v=Vector((math.cos(t),math.sin(t),0));n=Vector((0,0,1))
  c=Vector((39.8*math.cos(t),39.8*math.sin(t),2.99))
  if j%2==0:
   box(c,(.85,.55,.12),steel,(u,v,n));box(c+n*.09,(.65,.35,.07),glass,(u,v,n))
  if j%4==0:box(c-v*1.6,(.7,.18,.10),warm,(u,v,n))
  if j%12==0:
   for r in [36.1,41.9]:tube((r*math.cos(t),r*math.sin(t),-2),(r*math.cos(t),r*math.sin(t),2),.22,steel,10)
   # Circumferential mechanical clamps create eight distinct sectors.
   for k in range(len(cross)):
    r,z=cross[k];rr,zz=cross[(k+1)%len(cross)]
    tube((r*math.cos(t),r*math.sin(t),z),(rr*math.cos(t),rr*math.sin(t),zz),.30,steel,10)
    for dt in [-.018,.018]:tube((r*math.cos(t+dt),r*math.sin(t+dt),z),(rr*math.cos(t+dt),rr*math.sin(t+dt),zz),.15,alloy,8)
  if j%12 in [2,3,4]:
   c=Vector((39*math.cos(t),39*math.sin(t),3.03))
   box(c,(2.2,2.9,.16),steel,(u,v,n))
   for l in range(10):box(c+v*(-1.2+l*.26)+n*.12,(1.9,.10,.10),alloy,(u,v,n))
 ring(0,4.1,4,alloy,3.1);ring(2.2,4.45,.5,steel,3.5)
 for i in range(16):
  t=i*math.tau/16
  x,y=4*math.cos(t),4*math.sin(t)
  box((x,y,2.7),(.45,.45,.35),alloy);box((x,y,2.91),(.18,.18,.07),warm)
 for i in range(4):
  t=math.pi/4+i*math.pi/2;u=Vector((math.cos(t),math.sin(t),0));v=Vector((-math.sin(t),math.cos(t),0))
  mount(u*4,u*36,1.1)
  for s in [-1,1]:
   tube(u*4+v*s*.9+Vector((0,0,1.2)),u*36+v*s*.9+Vector((0,0,1.2)),.24,alloy,10)
  for r in [7,12,17,22,27,32]:
   for s in [-1,1]:mount(u*r+v*s*.9+Vector((0,0,1.2)),u*(r+4)-v*s*.9+Vector((0,0,1.2)),.16)
   c=u*r+Vector((0,0,1.35));box(c,(1.9,2.1,.35),steel,(v,u,Vector((0,0,1))))
   box(c+Vector((0,0,.22)),(.22,1.4,.07),warm,(v,u,Vector((0,0,1))))
 PREFIX=''

def naval_bridge(x,z,y,palette):
 for level,(width,depth,height) in enumerate([(4.4,9,2.2),(3.5,6.8,1.8),(4.1,4.2,1.4)]):
  base=y+level*1.8
  hull('command-tier',x,[(z-depth/2,width*.8,base+height,base,.5),(z+depth/3,width,base+height,base,.6),(z+depth/2,width*.75,base+height*.85,base,.4)],palette)
  if level==2:
   for dx in [-2.5,-1.5,-.5,.5,1.5,2.5]:
    box((x+dx,base+.85,z+depth/2+.04),(.7,.35,.12),glass)
 for dx in [-2,2]:
  mount((x+dx,y+5,z-1),(x+dx,y+10,z-1),.16)
  mount((x+dx-1,y+8,z-1),(x+dx+1,y+8,z-1),.10)
 dish(x,y+7,z-3,1.5)

def capital(role):
 # Author at 1/4 full size for shared detail primitives, then scale to metres.
 iscarrier=role=='carrier';length=88 if iscarrier else 94;w=14 if iscarrier else 12;h=10 if iscarrier else 10.4
 c=ivory if iscarrier else grey
 zmin=-length/2;zmax=length/2
 # Lofted armour sides leave the carrier mouth open; its interior is real geometry.
 if iscarrier:
  rows=[(zmin,11,8,-8,2),(-36,w,h,-h,2.7),(34,w,h,-h,2.7),(zmax,12.2,8.4,-8.4,2.3)]
  # Subdivide longitudinally for panelwork.
  for zz in range(-30,34,5):rows.append((zz,w,h,-h,2.7))
  rows.sort()
  rings=[section(0,*r) for r in rows]
  for a,b in zip(rings,rings[1:]):
   for j in range(8):
    k=(j+1)%8;pts=[a[j],a[k],b[k],b[j]];n=(Vector(a[k])-Vector(a[j])).cross(Vector(b[j])-Vector(a[j])).normalized();mid=sum(pts,Vector())/4
    if n.dot(Vector((mid.x,mid.y,0)))<0:n=-n
    for q in range(4):plate([a[j].lerp(a[k],q/4),a[j].lerp(a[k],(q+1)/4),b[j].lerp(b[k],(q+1)/4),b[j].lerp(b[k],q/4)],c[0],n,.10)
  # Deep bow hangar: floor, ceiling, side walls and rear wall, no fake flat black aperture.
  for y in [-7.3,7.3]:box((0,y,32),(23,.6,25),steel)
  for x in [-11.5,11.5]:box((x,0,32),(.7,14.6,25),grey[0])
  box((0,0,19),(23,14.6,.5),grey[0])
  for zz in [23,29,35,41]:
   for xx in [-10.7,10.7]:box((xx,0,zz),(.55,14,1),alloy);box((xx*.97,4,zz+.6),(.18,1.7,.13),warm)
   box((0,7,zz),(22,.6,.6),gold[0]);box((0,-6.92,zz),(20,.08,.15),gold[0])
  for xx in [-9.8,9.8]:
   box((xx,-1,31),(2,.35,24),alloy)
   for zz in range(22,44,3):mount((xx,-1,zz),(xx,1.3,zz),.09)
   tube((xx,1.3,21),(xx,1.3,43),.09,orange)
  for x in [-6,6]:
   box((x,-6.85,34),(.13,.05,18),warm)
  # Structural mouth coaming.
  a=section(0,zmax+.15,12.6,8.8,-8.8,2.4)
  for p,q in zip(a,a[1:]+a[:1]):tube(p,q,.60,steel,8)
  for p,q in zip(a,a[1:]+a[:1]):tube(p+Vector((0,0,.5)),q+Vector((0,0,.5)),.24,gold[0],8)
  # Continuous full length deck and low command island.
  box((0,10.5,-2),(23,.8,76),steel)
  for zz in range(-36,36,4):
   for xx in [-8,-4,0,4,8]:plate([(xx-1.96,10.94,zz),(xx+1.96,10.94,zz),(xx+1.96,10.94,zz+3.92),(xx-1.96,10.94,zz+3.92)],deck,(0,1,0),.03,False)
  for xx in [-9,9]:box((xx,11.02,-2),(.10,.04,73),gold[0])
  for zz in range(-32,33,8):box((0,11.04,zz),(.18,.05,2.5),ivory[0])
  naval_bridge(5,2,12,ivory)
  for x in [3.8,5,6.2]:mount((x,13,5),(x,19-(x-4)*.6,5),.08)
  # Keep the working deck clear; command glazing belongs on the bridge.
  # Lower island terraces and flight-deck service equipment.
  hull('island-base',5,[(-2,4.3,13.1,10.9,.8),(2,4.3,13.1,10.9,.8),(9,3.8,12.7,10.9,.8),(13,2.4,11.8,10.9,.5)],ivory)
  for zz in range(-32,35,11):
   for side in [-1,1]:
    xx=side*10.9
    box((xx,11.3,zz),(1.3,.9,2),steel);box((xx,11.85,zz),(1.1,.2,1.7),ivory[1])
    lamp(xx,11.4,zz+1.1)
    mount((xx,11.6,zz-1),(xx,13.0,zz-1),.09);mount((xx,13.0,zz-1),(xx-1.3*side,13.0,zz-1),.09)
  # Hangar wall bays, overhead girders, suspended crane and stacked lockers.
  for zz in [23,29,35,41]:
   for side in [-1,1]:
    xx=side*11.0
    box((xx,2.8,zz),( .5,3.2,3.9),ivory[1]);box((xx,-4.6,zz),(.5,3.6,4),grey[2])
    for y in [-5.8,-4.6,-3.4]:box((xx-side*.35,y,zz),(.18,.25,2.7),alloy)
    box((xx-side*.35,4.7,zz),(.2,.20,2.4),warm)
   box((0,6.2,zz),(21,.4,.4),alloy)
   for xx in range(-9,10,3):mount((xx,6.2,zz),(xx+2,7.2,zz),.10)
  for zz in [27,37]:
   for xx in [-7,0,7]:box((xx,-6.7,zz),(2.2,.35,3),grey[2])
  box((2,4.6,35),(12,.55,.6),gold[0]);mount((7,4.5,35),(7,2,35),.14)
 else:
  rows=[]
  for i in range(19):
   z=zmin+i*length/18;f=.8 if i==0 else .65 if i==18 else .85 if i==17 else 1
   rows.append((z,w*f,h*f,-h*f,2.4))
  # Separate citadel sections with deep mechanical seams.
  for start,end in [(-47,-34),(-32,-20),(-18,-6),(-4,8),(10,22),(24,35),(37,47)]:
   f=.72 if start==37 else 1
   hull('citadel-section',0,[(start,w*f*.94,h*f*.94,-h*f*.94,2.4),(start+1.2,w*f,h*f,-h*f,2.4),(end-1.2,w*f,h*f,-h*f,2.4),(end,w*f*.94,h*f*.94,-h*f*.94,2.4)],[grey[0]])
  body('citadel-core',0,0,80,9,8,[steel])
  # Spinal weapon muzzle: nested rings and a deep bore along the ship axis.
  for z,r in [(zmax+.2,4.2),(zmax+.9,3.7),(zmax+1.6,3.0)]:ring(z,r,1,alloy if r==3.7 else steel,r-.6)
  tube((0,0,zmax-6),(0,0,zmax-5.9),2.3,black,48)
  for i in range(48):
   t=i*math.tau/48;u=(i+1)*math.tau/48
   poly([(2.3*math.cos(t),2.3*math.sin(t),zmax-6),(2.3*math.cos(u),2.3*math.sin(u),zmax-6),(2.4*math.cos(u),2.4*math.sin(u),zmax+2),(2.4*math.cos(t),2.4*math.sin(t),zmax+2)],alloy)
  for side in [-1,1]:
   box((side*3.4,5.5,32),(2,2,22),steel)
   for zz in [24,30,36,42]:box((side*3.4,6.6,zz),(1.6,.35,4.8),grey[2]);tube((side*3.4,7,zz-2),(side*3.4,7,zz+2),.22,alloy,12)
  naval_bridge(0,-16,13,grey)
  for zz in [-30,-18,-6,8,20]:
   for side in [-1,1]:
    box((side*6.8,11,zz),(5.4,1.4,5.8),steel)
    gun(side*6.8,12,zz,1.5)
  # Raised segmented armour arches, with sunken turret wells between them.
  for zz in [-36,-24,-12,0,12,24]:
   for side in [-1,1]:
    pts=[(side*11.6,8.0,zz-1),(side*10.5,12.5,zz-1),(side*7.5,14.0,zz-1),(side*2.2,14,zz-1),(side*2.2,12.8,zz-1),(side*7,12.8,zz-1),(side*9.2,11.8,zz-1),(side*10.2,8,zz-1)]
    prism(pts,(0,0,1),2,grey[1])
    for dz in [-1.1,1.1]:
     tube((side*10.5,12.3,zz+dz),(side*7.4,13.8,zz+dz),.17,alloy,10)
    box((side*9.1,12.9,zz+1.15),(1.0,.35,.15),warm)
  hull('bridge-terrace',0,[(-12,3.5,13.2,10.3,.8),(-8,3.5,13.2,10.3,.8),(-1,3,12.4,10.3,.8),(3,2.2,11.6,10.3,.5)],grey)
  # Axial nose barrel guard rails surround a metallic bore with depth.
  for i in range(8):
   t=i*math.tau/8;u=Vector((math.cos(t),math.sin(t),0));v=Vector((-math.sin(t),math.cos(t),0))
   centre=u*4.9+Vector((0,0,zmax+.4));box(centre,(1.7,1.5,4),grey[1],(u,v,Vector((0,0,1))))
   tube(u*4.0+Vector((0,0,zmax-5)),u*4.0+Vector((0,0,zmax+1)),.25,alloy,12)
  for xx in [-1,1]:mount((xx,12,-7),(xx,16,-7),.10)
 # Both capitals have large transverse armour ribs and deep service trenches.
 for zz in range(-34,35,9):
  for side in [-1,1]:
   x=side*(w+.15)
   box((x,0,zz),(1,16,1.2),steel)
   mount((side*(w-2),h,zz),(side*(w+.3),h-2.2,zz),.55)
   mount((side*(w+.3),-h+2.2,zz),(side*(w-2),-h,zz),.55)
   for yy in [-6.5,5.2]:
    box((x+side*.58,yy,zz),( .25,1.5,1.6),gold[0] if iscarrier else red[1])
   for dz in [-3,3]:
    box((x,1,zz+dz),(.25,3,2.1),steel)
    for k in range(10):box((x+side*.2,-.3+k*.27,zz+dz),(.16,.10,1.85),alloy)
    for yy in [-3.5,-2.8]:box((x+side*.12,yy,zz+dz),(.08,.18,1.3),warm)
   cable([(x+side*.3,0,zz-3.8),(x+side*.8,0,zz-3),(x+side*.8,0,zz+3),(x+side*.3,0,zz+3.8)],.22,alloy)
   # Broad structural straps and raised side-service blocks, not thin poles.
   box((x+side*.3,0,zz),(1.4,14,1.4),steel)
   for yy in [-5,4.5]:box((x+side*1.05,yy,zz),(.25,2.4,1.1),grey[2])
   for dz in [-3,3]:
    box((x+side*.2,-4.5,zz+dz),(.9,2.7,3.2),steel)
    box((x+side*.75,-4.5,zz+dz),(.22,2.15,2.65),c[1])
    for yy in [-5.1,-4.5,-3.9]:box((x+side*.9,yy,zz+dz),(.15,.16,1.9),alloy)
 for x,y in [(-8,4),(8,4),(-8,-4),(8,-4)]:
  engine(x,y,zmin-3,14,3.7,[ivory[0],gold[0]] if iscarrier else grey+red)
 for zz in [-28,-14,0,14,28]:
  for side in [-1,1]:radiator(side*7,-h-.2,zz,3,5)

if ROLE in ['interceptor','patrol','raider','prospector']:small_ship(ROLE)
elif ROLE=='explorer':explorer()
elif ROLE in ['carrier','dreadnought']:capital(ROLE)
else:raise ValueError(ROLE)

SCALE=4 if ROLE in ['carrier','dreadnought'] else 1
objects=[];rotor=None
if ROLE=='explorer':
 rotor=bpy.data.objects.new('habitat-rotor',None);bpy.context.collection.objects.link(rotor)
 rotor['floorRadiusMetres']=40;rotor['rotationRPM']=3;rotor['gravityG']=(math.tau*3/60)**2*40/9.80665
for name,(verts,faces,uvs) in BATCH.items():
 mesh=bpy.data.meshes.new(name);mesh.from_pydata([tuple(c*SCALE for c in v) for v in verts],[],faces);mesh.materials.append(MATS[GROUP_MAT[name]]);mesh.update()
 uv=mesh.uv_layers.new(name='surface-metres')
 for face,coords in zip(mesh.polygons,uvs):
  for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=xy
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
 for face in mesh.polygons:face.use_smooth=True
 ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);objects.append(ob)
 if name.startswith('rotor:'):ob.parent=rotor
 if GROUP_MAT[name] in PAINT:
  bevel=ob.modifiers.new('machined-panel-edges','BEVEL');bevel.width=.10*SCALE;bevel.segments=2
 normal=ob.modifiers.new('weighted-normals','WEIGHTED_NORMAL');normal.keep_sharp=True
bpy.context.scene['author']='Codex';bpy.context.scene['shipRole']=ROLE
bpy.context.scene['units']='metres; Y up; +Z forward';bpy.context.scene.unit_settings.system='METRIC'
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(DEST/'model.blend'))
glb=DEST/'model.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=False,export_apply=True,export_materials='EXPORT',export_extras=True)
data=glb.read_bytes();jl=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+jl])
for m in doc['materials']:
 if 'baseColorTexture' in m.get('pbrMetallicRoughness',{}):m['pbrMetallicRoughness']['baseColorFactor']=list(MATS[m['name']].diffuse_color)
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);tail=data[20+jl:]
glb.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+tail)
positions=[doc['accessors'][p['attributes']['POSITION']] for m in doc['meshes'] for p in m['primitives']]
lo=[min(a['min'][i] for a in positions) for i in range(3)];hi=[max(a['max'][i] for a in positions) for i in range(3)]
triangles=sum(doc['accessors'][p['indices']]['count']//3 for m in doc['meshes'] for p in m['primitives'])
report=dict(role=ROLE,author='Codex',boundsMetres=[b-a for a,b in zip(lo,hi)],min=lo,max=hi,triangles=triangles,meshes=len(doc['meshes']),bytes=glb.stat().st_size)
if rotor:report.update(floorRadiusMetres=40,rotationRPM=3,gravityG=rotor['gravityG'])
(DEST/'model-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('SHIP_EXPORTED',json.dumps(report))
