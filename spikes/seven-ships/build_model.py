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
 hull('profiled-drive',x,rows,[colors[0]],roof=[colors[0]])
 nozzle(x,y,z-length/2-1,r*1.04)
 hull('armoured-drive-cap',x,[(z+length*.38,r*.93,y+r*.93,y-r*.93,r*.40),(z+length*.48,r*.82,y+r*.82,y-r*.82,r*.36),(z+length*.56,r*.64,y+r*.64,y-r*.64,r*.28)],[steel])
 for offset in [-.37,.26]:
  ring(z+length*offset,r*1.04,.38,steel,r*.88,x,y,8)
 # Dark intake/exchanger face with a thick frame, matching the approved target.
 zz=z+length*.56+.15
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
 za=z+length*.13;zb=z+length*.39;ya=y+h*.84+.45;yb=y+h*.28+.45
 pts=[(x-w*.32,ya,za),(x+w*.32,ya,za),(x+w*.24,yb,zb),(x-w*.24,yb,zb)]
 prism(pts,(0,.8,.3),.10,glass)
 for a,b in zip(pts,pts[1:]+pts[:1]):tube(a,b,.19,steel,10)
 tube((x,ya+.06,za),(x,yb+.06,zb),.12,alloy,10)
 l=Vector(pts[0]).lerp(Vector(pts[3]),.58);r_=Vector(pts[1]).lerp(Vector(pts[2]),.58)
 tube(l,r_,.11,steel,10)
 poly([(x-w*.32,ya,za),(x+w*.32,ya,za),(x+w*.40,ya-.55,za),(x-w*.40,ya-.55,za)],colors[0])
 # Rear enclosure and narrow side windows.
 for side in [-1,1]:
  a=(x+side*w*.32,ya,za);b=(x+side*w*.24,yb,zb);c=(x+side*w*.31,yb-.35,zb);d=(x+side*w*.40,ya-.55,za)
  prism([a,b,c,d],(side,.3,0),.06,glass)
  for aa,bb in [(a,d),(d,c),(c,b)]:tube(aa,bb,.14,steel,8)
  box((x+side*w*.77,y-h*.2,z+length*.37),(.35,.7,.3),steel)
  box((x+side*w*.77,y-h*.2,z+length*.39),(.15,.35,.08),warm)
 hatch(x,y+h*.74+.2,z-length*.36,w*.8,2)
 nose_z=z+length*.43
 nose_y=y+h*.18
 box((x,nose_y+.10,nose_z),(w*.56,.42,1.4),steel)
 radiator(x,nose_y+.28,nose_z,w*.53,1.2)
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
  box((x,y+h*.87,z+length*dz),(w*.78,h*.44,1.2),steel)
  hatch(x,y+h*1.07,z+length*dz,w*.72,1.0)

def spine(a,b,r=3.8):
 # Three substantial pressure modules with recessed mechanical gaps and broad bearings.
 tube((0,0,a),(0,0,b),r*.86,steel,32)
 pitch=(b-a)/3
 for i in range(3):
  start=a+i*pitch+.9;end=a+(i+1)*pitch-1.0
  for sector in range(12):
   ta=sector*math.tau/12+.018;tb=(sector+1)*math.tau/12-.018
   if sector in [0,5,6,11]:continue
   for zz,ze in [(start,(start+end)/2),((start+end)/2,end)]:
    pts=[(r*math.cos(ta),r*math.sin(ta),zz),(r*math.cos(tb),r*math.sin(tb),zz),(r*math.cos(tb),r*math.sin(tb),ze),(r*math.cos(ta),r*math.sin(ta),ze)]
    plate(pts,ivory[i%3],(math.cos((ta+tb)/2),math.sin((ta+tb)/2),0),.14)
  for z in [start-.4,end+.35]:
   ring(z,r+.6,.8,steel,r-.15,segments=48)
   for dz in [-.43,.43]:ring(z+dz,r+.64,.12,alloy,r+.35,segments=48)
   for j in range(8):
    t=j*math.tau/8
    box(((r+.62)*math.cos(t),(r+.62)*math.sin(t),z),(.55,.55,.75),steel)
  for side in [-1,1]:
   for yy in [-r*.48,r*.48]:
    xx=side*r*.9
    tube((xx,yy,start),(xx,yy,end),.30,alloy,16)
    for zz in [start+.8,end-.8]:
     tube((xx,yy,zz-.18),(xx,yy,zz+.18),.40,steel,16)
   mid=(start+end)/2
   box((side*(r+.05),0,mid),(1.0,2.25,2.3),steel)
   box((side*(r+.63),0,mid),(.22,1.95,1.9),ivory[1])
   for yy in [-.8,.8]:box((side*(r+.78),yy,mid),(.09,.13,1.4),alloy)
   box((side*(r+.82),-.45,mid+.15),(.10,.23,.85),warm)
   for yy in [-r*.68,r*.68]:
    cable([(side*r*.67,yy,start),(side*r*.8,yy,start+.5),(side*r*.8,yy,end-.5)],.19,orange)
  # Axial actuator rails and irregular equipment packages above each pressure segment.
  for side in [-1,1]:
   xx=side*r*.55;yy=r*.90
   tube((xx,yy,start+.3),(xx,yy,end-.3),.24,alloy,16)
   for zz in [start+1,end-1]:
    box((xx,yy+.15,zz),(.9,.65,1.5),steel)
    box((xx,yy+.52,zz),(.7,.13,1.2),ivory[1])
   for off in [-2,2]:
    zz=(start+end)/2+off
    box((side*(r+.12),.15,zz),(.5,1.9,1.4),steel)
    for yy in [-.45,0,.45]:
     tube((side*(r+.45),yy,zz-.5),(side*(r+.45),yy,zz+.5),.14,alloy,12)
  hatch(0,r+.2,(start+end)/2,2.0,1.9)

def mount(a,b,r=.8):
 tube(a,b,r,steel,8)
 d=(Vector(b)-Vector(a));
 for t in [.2,.8]:
  p=Vector(a)+d*t;tube(p-d.normalized()*.3,p+d.normalized()*.3,r*1.22,alloy,8)

def gun(x,y,z,s=1):
 box((x,y,z),(1.5*s,1.3*s,3.4*s),steel)
 box((x,y+.45*s,z-.3*s),(1.6*s,1*s,2.6*s),grey[2])
 for dx in [-.38,.38]:
  tube((x+dx*s,y+.30*s,z+.8*s),(x+dx*s,y+.30*s,z+5.6*s),.20*s,alloy,12)
  ring(z+5.5*s,.28*s,.35*s,steel,.14*s,x+dx*s,y+.30*s,24)
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
  spine(-17,13,4.0);cabin(22,18,5.3,4.5)
  for x,y in [(8,0),(-8,0),(0,8),(0,-8)]:
   mount((0,0,-18),(x,y,-18),1.5);engine(x,y,-20,19,4.1)
  for side in [-1,1]:gun(side*5.5,1.2,21,1.0)
 elif role in ['patrol','raider']:
  pirate=role=='raider';c=grey+red+[ivory[0]] if pirate else ivory
  hull('armoured-central-hull',0,[(-26,5.5,2.2,-2,1.4),(-20,7.2,3.2,-3.2,1.7),(-12,7.4,3.5,-3.4,1.7),(-4,7,3.8,-3.4,1.7),(4,6.5,3.4,-3.2,1.6),(12,5.7,3.4,-3.2,1.5),(22,4.2,1.8,-2.8,1.2),(28,2.8,.8,-2.3,1.0)],c)
  # Tiered central pressure hull, separate shoulder armor and machinery valleys.
  hull('raised-keel',0,[(-22,3.7,4.7,2.7,1),(-16,4.2,5.2,2.7,1),(-9,4.2,5.2,2.7,1),(-2,3.8,5.0,2.6,1),(6,3.4,4.8,2.3,1),(12,3.2,4.3,2.1,.8)],c)
  for side in [-1,1]:
   mount((side*6,0,-10),(side*12.5,0,-12),1.2)
   engine(side*12.5,0,-14,23,4,red+grey if pirate else [ivory[0],ivory[1],blue[1]])
   # Bearing pedestal penetrates the shoulder roof; the gun base sits on it.
   gs=1.45 if pirate else 1.10
   box((side*5.8,4.65,3),(2.8,1.1,5.8),steel)
   box((side*5.8,5.16,3),(2.55,.28,5.35),c[0])
   gun(side*5.8,5.15+.65*gs,3,gs)
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
  for z in [-18,-10,-2]:
   box((0,4.85,z),(3.55,1.0,3.5),steel)
   hatch(0,5.30,z,3.4,3.3)
  for side in [-1,1]:
   box((side*2.6,5.32,-10),(1.35,.16,18),black)
   for xx in [-.32,.32]:
    tube((side*2.6+xx,5.6,-18),(side*2.6+xx,5.6,-2),.18,alloy,12)
   for zz in [-16,-8,0]:
    box((side*2.6,5.75,zz),(1.15,.55,1.35),steel)
    box((side*2.6,6.06,zz),(.85,.12,1.10),c[0])

  if pirate:
   # Offset ram is a single substantial armoured prow rather than decorative spikes.
   hull('offset-ram',-1.4,[(15,1.5,1.3,-2.8,.5),(23,1.4,.7,-2.6,.5),(28,1.4,.5,-2.4,.4),(29,1.2,.2,-2.2,.4)],red)
  else:
   for zz in [-5,0]:
    for side in [-1,1]:
     box((side*6,4.65,zz),(1.85,.55,2.7),steel)
     radiator(side*6,4.90,zz,1.7,2.5)
   for side in [-1,1]:
    # Deliberate blue identity stripe across shoulder plates, not random recolor.
    for zz in [-5,-2,1]:box((side*6.6,4.83,zz),(1.6,.09,2.5),blue[1])
   # Faceted sensor radome with an equatorial cyan band.
   for i in range(3):
    z=-4+i*.01
   sphere('sensor', (0,6.4,-7), (2.3,1.5,2.3),alloy)
   ring_axis_y((0,6.15,-7),2.3,.18,cyan)
 elif role=='prospector':
  spine(-20,17,3.8);cabin(22,15,5.1,4.0,[ivory[1],gold[0]])
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
 spine(-23,21,3.7);cabin(29,14,5.0,4.2,[ivory[0],ivory[1],gold[0]])
 for side in [-1,1]:
  engine(side*7,0,-28,16,3.6,[ivory[0],ivory[1],gold[0]])
  mount((0,0,-25),(side*7,0,-25),1.1)
  sphere('tank',(side*4.2,1,-19),(1.6,1.6,3),steel)
 dish(0,9,-19,5)
 PREFIX='rotor:'
 # The floor is at radius 40 m. Shell extends 36..42 m, with a faceted 6 m tube.
 # Geometry is exactly concentric about the longitudinal Z axis.
 N=96;cross=[(39+3*math.cos(k*math.tau/16),4.3*math.sin(k*math.tau/16)) for k in range(16)]
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
  c=Vector((39.8*math.cos(t),39.8*math.sin(t),4.28))
  if j%2==0:
   box(c,(.85,.55,.12),steel,(u,v,n));box(c+n*.09,(.65,.35,.07),glass,(u,v,n))
  if j%4==0:box(c-v*1.6,(.7,.18,.10),warm,(u,v,n))
  if j%12==0:
   for r in [36.1,41.9]:tube((r*math.cos(t),r*math.sin(t),-3.3),(r*math.cos(t),r*math.sin(t),3.3),.22,steel,10)
   # Circumferential mechanical clamps create eight distinct sectors.
   for k in range(len(cross)):
    r,z=cross[k];rr,zz=cross[(k+1)%len(cross)]
    tube((r*math.cos(t),r*math.sin(t),z),(rr*math.cos(t),rr*math.sin(t),zz),.30,steel,10)
    for dt in [-.018,.018]:tube((r*math.cos(t+dt),r*math.sin(t+dt),z),(rr*math.cos(t+dt),rr*math.sin(t+dt),zz),.15,alloy,8)
  if j%12 in [2,3,4]:
   c=Vector((39*math.cos(t),39*math.sin(t),4.33))
   box(c,(2.2,2.9,.16),steel,(u,v,n))
   for l in range(10):box(c+v*(-1.2+l*.26)+n*.12,(1.9,.10,.10),alloy,(u,v,n))
 ring(0,5.2,5,steel,3.7);ring(2.8,5.5,.65,alloy,4.1);ring(3.4,5.3,.5,gold[0],4.3)
 for i in range(16):
  t=i*math.tau/16
  x,y=4*math.cos(t),4*math.sin(t)
  box((x,y,2.7),(.45,.45,.35),alloy);box((x,y,2.91),(.18,.18,.07),warm)
 for i in range(4):
  t=math.pi/4+i*math.pi/2;u=Vector((math.cos(t),math.sin(t),0));v=Vector((-math.sin(t),math.cos(t),0))
  mount(u*4,u*36,1.3)
  for r in [5,11,17,23,29,34]:
   box(u*r,(3.1,1.2,3.3),steel,(v,u,Vector((0,0,1))))
   box(u*r+Vector((0,0,1.8)),(2.6,1.0,.35),ivory[1],(v,u,Vector((0,0,1))))
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

def capital_habitat(iscarrier):
 global PREFIX
 z0=-27
 # Fixed bearing housing outside all rectangular hull corners.
 ring(z0,19.2,2.0,steel,18.7,segments=96)
 for side in [-1,1]:
  for sy in [-1,1]:
   mount((side*13,sy*8,z0),(side*15.7,sy*10.7,z0),.55)
 PREFIX='rotor:'
 # Inner radius 78.4 m, outside fixed bearing radius 76.8 m: 1.6 m gap.
 ring(z0,20.1,1.4,alloy,19.6,segments=96)
 ring(z0+.8,20.2,.25,steel,19.6,segments=96)
 N=96
 cross=[(21.8+1.8*math.cos(k*math.tau/16),z0+2.8*math.sin(k*math.tau/16)) for k in range(16)]
 palette=ivory if iscarrier else grey
 accent=gold[0] if iscarrier else red[1]
 for j in range(N):
  a=j*math.tau/N;b=(j+1)*math.tau/N;t=(a+b)/2
  for k in range(16):
   r,z=cross[k];rr,zz=cross[(k+1)%16]
   pts=[(r*math.cos(a),r*math.sin(a),z),(r*math.cos(b),r*math.sin(b),z),(rr*math.cos(b),rr*math.sin(b),zz),(rr*math.cos(a),rr*math.sin(a),zz)]
   mid=sum((Vector(p) for p in pts),Vector())/4
   n=mid-Vector((21.8*math.cos(t),21.8*math.sin(t),z0));n.normalize()
   mat=steel if j%12 in [0,1] else accent if j%24 in [4,5,6] else palette[(j//12)%len(palette)]
   plate(pts,mat,n,.025,bolts=False)
  u=Vector((-math.sin(t),math.cos(t),0));v=Vector((math.cos(t),math.sin(t),0));n=Vector((0,0,1))
  if j%2==0:
   c=Vector((22.5*math.cos(t),22.5*math.sin(t),z0+2.67))
   box(c,(.40,.23,.09),steel,(u,v,n));box(c+n*.06,(.29,.13,.035),glass,(u,v,n))
   box(c-v*.45,(.27,.10,.06),warm,(u,v,n))
  if j%12==0:
   for k in range(16):
    r,z=cross[k];rr,zz=cross[(k+1)%16]
    tube((r*math.cos(t),r*math.sin(t),z),(rr*math.cos(t),rr*math.sin(t),zz),.10,alloy,8)
  if j%12 in [3,4,5,6,7,8]:
   c=Vector((22.0*math.cos(t),22.0*math.sin(t),z0+2.86))
   box(c,(1.3,.7,.10),steel,(u,v,n))
   for q in range(6):box(c+v*(-.28+q*.11)+n*.08,(1.15,.045,.045),alloy,(u,v,n))
 for j in range(8):
  a=j*math.tau/8;u=Vector((math.cos(a),math.sin(a),0));v=Vector((-math.sin(a),math.cos(a),0));o=Vector((0,0,z0))
  for dz in [-.6,.6]:
   for side in [-1,1]:tube(o+u*20+v*side*.30+Vector((0,0,dz)),o+u*21.2+v*side*.30+Vector((0,0,dz)),.13,steel,8)
  box(o+u*20.75,(.95,1.0,1.6),steel,(v,u,Vector((0,0,1))))
  box(o+u*20.75+Vector((0,0,.85)),(.45,.65,.16),accent,(v,u,Vector((0,0,1))))
 PREFIX=''

def capital(role):
 # Author at 1/4 full size for shared detail primitives, then scale to metres.
 iscarrier=role=='carrier';length=88 if iscarrier else 94;w=14 if iscarrier else 12;h=10 if iscarrier else 10.4
 c=ivory if iscarrier else grey
 zmin=-length/2;zmax=length/2
 # Lofted armour sides leave the carrier mouth open; its interior is real geometry.
 if iscarrier:
  # Individually housed pressure bays with recessed structural expansion joints.
  # Each shell has a broad shoulder, inset side field and stepped end collars.
  for start,end in [(-44,-35.2),(-32.8,-26.2),(-23.8,-17.2),(-14.8,-8.2),(-5.8,.8),(3.2,9.8),(12.2,18.8),(21.2,27.8),(30.2,36.5),(38,44)]:
   rows=[(start,13.3,9.5,-9.5,2.7),(start+.65,14,10,-10,2.7),(end-.65,14,10,-10,2.7),(end,13.3,9.5,-9.5,2.7)]
   rings=[section(0,*r) for r in rows]
   for a,b in zip(rings,rings[1:]):
    for j in range(8):
     k=(j+1)%8;normal=Vector(((a[j].x+a[k].x)/2,(a[j].y+a[k].y)/2,0)).normalized()
     parts=2 if j in [1,3,5,7] else 3
     for q in range(parts):
      plate([a[j].lerp(a[k],q/parts),a[j].lerp(a[k],(q+1)/parts),b[j].lerp(b[k],(q+1)/parts),b[j].lerp(b[k],q/parts)],ivory[0],normal,.10)
   # Flush shoulder exchanger, embedded in a canted armoured housing.
   zz=(start+end)/2
   for side in [-1,1]:
    u=Vector((side*.707,-.707,0));v=Vector((0,0,1));n=Vector((side*.707,.707,0))
    center=Vector((side*12.7,8.7,zz))
    box(center,(2.3,end-start-1.4,.35),gold[0],(u,v,n))
    box(center+n*.24,(1.95,end-start-1.8,.18),steel,(u,v,n))
    for k in range(10):box(center+n*.37+v*((k-4.5)*(end-start-2)/10),(1.7,.07,.09),alloy,(u,v,n))
  # Dark continuous pressure liner is exposed only in the assembly joints.
  rings=[section(0,z,13.15,9.2,-9.2,2.7) for z in [-44,44]]
  for j in range(8):poly([rings[0][j],rings[0][(j+1)%8],rings[1][(j+1)%8],rings[1][j]],steel)
  # Seal the aft pressure shell behind the drive mounts. The forward bay stays
  # open; this closed prism spans the complete chamfered stern cross-section.
  prism(section(0,zmin,13.35,9.55,-9.55,2.7),(0,0,-1),.55,ivory[0],'bastion-aft-bulkhead')
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
  # Deep, stepped bow collar: inner sill, armoured outer flange and corner guards.
  for z,ww,hh,ch,depth in [(43.5,14.35,10.3,2.9,1.2),(44.5,13.9,9.8,2.8,.75),(45.2,12.6,8.6,2.3,.45)]:
   outer=section(0,z,ww,hh,-hh,ch);inner=section(0,z,11.1,7.1,-7.1,1.8)
   for j in range(8):
    k=(j+1)%8
    plate([outer[j],outer[k],inner[k],inner[j]],gold[0] if j in [1,3,5,7] and z==43.5 else ivory[0] if z==43.5 else steel,(0,0,1),depth)
  for side in [-1,1]:
   for yy in [-4.6,4.6]:
    box((side*11.7,yy,45.8),(.6,2.1,.45),steel)
    box((side*11.7,yy,46.05),(.18,1.5,.08),warm)
  for xx in [-7,0,7]:
   box((xx,8.9,45),(3.3,.65,.5),black)
   for j in range(9):box((xx-1.3+j*.32,8.9,45.3),(.10,.43,.13),alloy)
  # Continuous full length deck and low command island.
  box((0,10.5,-2),(23,.8,76),steel)
  for zz in range(-36,36,4):
   for xx in [-8,-4,0,4,8]:plate([(xx-1.96,10.94,zz),(xx+1.96,10.94,zz),(xx+1.96,10.94,zz+3.92),(xx-1.96,10.94,zz+3.92)],deck,(0,1,0),.03,False)
  for xx in [-9,9]:box((xx,11.02,-2),(.10,.04,73),gold[0])
  for zz in range(-32,33,8):box((0,11.04,zz),(.18,.05,2.5),ivory[0])
  # Low elongated bridge pressure house with recessed continuous glazing.
  hull('bastion-bridge-base',5,[(-7,3.5,12.3,10.9,.7),(-5,3.7,12.6,10.9,.7),(8,3.4,12.6,10.9,.7),(13,2.3,11.7,10.9,.6)],ivory)
  hull('bastion-bridge-house',5,[(-4,2.9,14.6,12.1,.5),(2,2.9,14.6,12.1,.5),(7,2.5,14.0,12.1,.5),(9,1.9,12.6,12.1,.4)],ivory)
  for side in [-1,1]:
   pts=[(5+side*3.08,13.4,-2),(5+side*3.08,14.05,-2),(5+side*2.80,13.65,6),(5+side*2.80,13.05,6)]
   prism(pts,(side,0,0),.07,glass)
   for aa,bb in zip(pts,pts[1:]+pts[:1]):tube(aa,bb,.10,steel)
   for zz in [0,2,4]:tube((5+side*(3.08-(zz+2)*.035),13.2,zz),(5+side*(3.08-(zz+2)*.035),14.0,zz),.07,steel)
  pts=[(2.8,14.29,6),(7.2,14.29,6),(6.6,13.32,8.15),(3.4,13.32,8.15)]
  prism(pts,(0,.7,.7),.10,glass)
  for aa,bb in zip(pts,pts[1:]+pts[:1]):tube(aa,bb,.10,steel)
  for xx in [4,5,6]:tube((xx,14.34,6),(xx,13.37,8.15),.065,steel)
  radiator(5,14.75,-2,3.8,2.4)
  sphere('bridge-radome',(3.4,15,-3.4),(.5,.55,.5),ivory[0])
  for xx,hh in [(5.8,17),(6.6,16.4)]:mount((xx,14.3,-3),(xx,hh,-3),.055)
  # Keep the working deck clear; command glazing belongs on the bridge.
  for zz in [-28,-14,0,14,28]:
   for xx in [-5,5]:
    for dx in [-2.0,2.0]:box((xx+dx,11.08,zz),(.06,.025,4.4),gold[0])
    for dz in [-2.2,2.2]:box((xx,11.08,zz+dz),(4,.025,.06),gold[0])
  for side in [-1,1]:
   xx=side*10.7
   tube((xx,11.8,-36),(xx,11.8,35),.055,alloy,8)
   for zz in range(-36,36,3):tube((xx,11.0,zz),(xx,11.8,zz),.055,alloy,8)
  for zz in [-20,18,31]:
   box((6,11.6,zz),(1.8,1.15,2.4),gold[0]);box((6,12.22,zz),(1.65,.12,2.2),steel)
  # Deck service equipment.
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
  # Shipyard-derived internal work frame: rails, braced arches and rooted booms.
  for zz in [22,28,34,40]:
   for side in [-1,1]:
    xx=side*10.9
    box((xx,0,zz),(1.2,14.4,1.0),steel)
    box((xx-side*.7,2.0,zz),(.65,5.1,.75),gold[0])
    mount((xx,-5.8,zz),(xx-side*2.2,-1.2,zz),.22)
    mount((xx,6.5,zz),(xx-side*2.0,4.7,zz),.22)
   box((0,6.45,zz),(22,.8,1.1),steel)
   for xx in range(-9,9,3):
    mount((xx,5.95,zz),(xx+3,6.9,zz),.10)
  # Purpose-built rear bulkhead: segmented central pressure door, asymmetric
  # pump plant and a mezzanine service gallery instead of repeated HVAC squares.
  box((0,-1,19.9),(8.2,11.8,.8),steel)
  for side in [-1,1]:
   for yy in [-4,-1,2]:
    box((side*1.9,yy,20.5),(3.65,2.8,.5),ivory[0])
    box((side*1.9,yy+1.15,20.8),(3.3,.16,.12),alloy)
   box((side*4.25,-1,20.6),(.5,12,.65),gold[0])
   box((side*4.25,3.5,21),(.16,1.1,.12),warm)
  box((0,5.2,20.5),(9.5,.75,1),steel)
  for xx in [-6.3,-8.3]:
   tube((xx,-5.9,21),(xx,3.5,21),.64,alloy,16)
   for yy in [-5.4,-1,3]:tube((xx,yy-.17,21),(xx,yy+.17,21),.76,steel,16)
   cable([(xx,3.5,21),(xx,4.3,21),(xx+1.1,4.3,21),(xx+1.1,4.3,23)],.20,gold[0])
  for yy in [-4.6,-1.4,2.1]:
   box((7,yy,20.6),(4,2.5,1.3),grey[2])
   for xx in [5.6,6.8,8]:
    box((xx,yy,21.35),(.9,1.9,.2),steel)
    box((xx,yy+.5,21.49),(.5,.3,.06),cyan)
    for dy in [-.5,-.2]:box((xx,yy+dy,21.5),(.6,.08,.08),alloy)
  box((0,4.5,22),(19,.4,2),steel)
  for xx in range(-9,10,2):tube((xx,4.7,23),(xx,5.7,23),.065,gold[0])
  tube((-9,5.6,23),(9,5.6,23),.065,gold[0])
  # Two raised service galleries with safety rails and grated deck strips.
  for side in [-1,1]:
   xx=side*9.25
   box((xx,-.95,31),(3.3,.55,25),steel)
   for z in range(20,44):
    box((xx,-.63,z),(2.95,.08,.30),alloy)
   for yy in [.0,.8]:tube((side*7.8,yy,19),(side*7.8,yy,43),.075,gold[0],8)
   for z in range(19,44,2):tube((side*7.8,-.8,z),(side*7.8,1.0,z),.075,gold[0],8)
   # Fixed ladder and wall-mounted servicing manipulators.
   for z in [24,36]:
    for dx in [-.48,.48]:tube((xx+dx,-6.8,z),(xx+dx,-.6,z),.085,alloy,8)
    for y in [-6,-5,-4,-3,-2,-1]:tube((xx-.48,y,z),(xx+.48,y,z),.065,alloy,8)
   for z in [26,38]:
    root=(side*10.4,2.5,z);elbow=(side*8.6,2.8,z-1);tip=(side*6.4,1.8,z+1)
    mount(root,elbow,.30);mount(elbow,tip,.23)
    for point in [root,elbow,tip]:sphere('service-joint',point,(.43,.43,.43),steel)
    tube((side*9.8,2.65,z),(side*8.3,3,z-.6),.13,alloy,12)
    box(tip,(.6,.75,.65),gold[0])
  # Traveling bridge crane is carried by the ceiling's longitudinal rails.
  for xx in [-8.5,8.5]:box((xx,5.4,31),(.7,.7,25),gold[0])
  for z in [31.5,33]:
   box((0,4.8,z),(18,.55,.45),gold[0])
   for xx in range(-8,8,2):mount((xx,4.55,z),(xx+2,5.4,z),.11)
  box((3,4.55,32.2),(2,.65,2.5),steel)
  tube((3,4.2,32.2),(3,1.5,32.2),.10,alloy,12);box((3,1.45,32.2),(.7,.5,.8),gold[0])
  # Equipment racks and visible floor service channels behind the clear lane.
  for xx in [-8.2,8.2]:
   for z in [22,29,38]:
    box((xx,-5.2,z),(2.3,3,2.8),steel)
    box((xx,-5.2,z+1.45),(1.9,2.5,.18),gold[0])
    for yy in [-5.9,-5.1,-4.3]:box((xx,yy,z+1.59),(1.45,.4,.12),alloy)
  for z in range(21,44,3):
   for xx in [-4,0,4]:plate([(xx-1.8,-6.87,z),(xx+1.8,-6.87,z),(xx+1.8,-6.87,z+2.8),(xx-1.8,-6.87,z+2.8)],deck,(0,1,0),.035,False)
  for xx in [-5.8,5.8]:box((xx,-6.75,32),(.10,.07,23),gold[0])

 else:
  rows=[]
  for i in range(19):
   z=zmin+i*length/18;f=.8 if i==0 else .65 if i==18 else .85 if i==17 else 1
   rows.append((z,w*f,h*f,-h*f,2.4))
  # Separate citadel sections with deep mechanical seams.
  for start,end in [(-47,-34),(-32,-20),(-18,-6),(-4,8),(10,22),(24,35)]:
   f=.72 if start==37 else 1
   hull('citadel-section',0,[(start,w*f*.94,h*f*.94,-h*f*.94,2.4),(start+1.2,w*f,h*f,-h*f,2.4),(end-1.2,w*f,h*f,-h*f,2.4),(end,w*f*.94,h*f*.94,-h*f*.94,2.4)],[grey[1]],roof=[steel])
  body('citadel-core',0,0,72,9,8,[steel])
  hull('integrated-bow',0,[(34,12,10.4,-10.4,2.4),(39,11.6,9.7,-9.7,2.8),(44,10,8,-8,2.6),(47,8.2,6.8,-6.8,2.3)],[grey[0],grey[1]])
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
    gun(side*6.8,12,zz,1.9)
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
 # Thick continuous structural hoops connect roof, shoulder, side and belly.
 for zz in ([-34,-25,-16,-7,2,11,20,29,37] if iscarrier else range(-34,35,9)):
  outline=section(0,zz,w+.7,h+.45,-h-.45,2.8)
  for j in range(8):
   k=(j+1)%8;aa=outline[j];bb=outline[k]
   pts=[aa+Vector((0,0,-.7)),bb+Vector((0,0,-.7)),bb+Vector((0,0,.7)),aa+Vector((0,0,.7))]
   norm=Vector(((aa.x+bb.x)/2,(aa.y+bb.y)/2,0)).normalized()
   plate(pts,steel,norm,.40)
   for dz in [-.74,.74]:tube(aa+Vector((0,0,dz)),bb+Vector((0,0,dz)),.09,alloy,8)
 # Long side utility channel with layered pressure pipes and connector junctions.
 for side in [-1,1]:
  for yy in [-2.6,-1.5,0]:
   xx=side*(w+.75)
   tube((xx,yy,-34),(xx,yy,33),.28,alloy if yy else orange,12)
   for zz in range(-30,33,9):
    tube((xx,yy,zz-.35),(xx,yy,zz+.35),.40,steel,12)
  for zz in [-29,-11,7,25]:
   box((side*(w+1.1),-1,zz),(1.1,3.2,2.2),steel)
   box((side*(w+1.72),-1,zz),(.22,2.6,1.8),gold[0] if iscarrier else grey[1])
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
elif ROLE in ['carrier','dreadnought']:
 capital(ROLE);capital_habitat(ROLE=='carrier')
else:raise ValueError(ROLE)

SCALE=4 if ROLE in ['carrier','dreadnought'] else 1
objects=[];rotor=None
if ROLE in ['explorer','carrier','dreadnought']:
 rotor=bpy.data.objects.new('habitat-rotor',None);bpy.context.collection.objects.link(rotor)
 rotor['floorRadiusMetres']=40 if ROLE=='explorer' else 90
 rotor['rotationRPM']=3 if ROLE=='explorer' else 2.5
 rotor['gravityG']=(math.tau*rotor['rotationRPM']/60)**2*rotor['floorRadiusMetres']/9.80665
for name,(verts,faces,uvs) in BATCH.items():
 mesh=bpy.data.meshes.new(name);mesh.from_pydata([tuple(c*SCALE for c in v) for v in verts],[],faces);mesh.materials.append(MATS[GROUP_MAT[name]]);mesh.update()
 uv=mesh.uv_layers.new(name='surface-metres')
 for face,coords in zip(mesh.polygons,uvs):
  for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=xy
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
 for face in mesh.polygons:face.use_smooth=True
 ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);objects.append(ob)
 if name.startswith('rotor:'):ob.parent=rotor
 if GROUP_MAT[name] in PAINT+[steel]:
  bevel=ob.modifiers.new('machined-panel-edges','BEVEL');bevel.width=(.07 if GROUP_MAT[name] in PAINT else .035)*SCALE;bevel.segments=2 if GROUP_MAT[name] in PAINT else 1;bevel.limit_method='ANGLE';bevel.angle_limit=.70
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
if rotor:report.update(floorRadiusMetres=rotor['floorRadiusMetres'],rotationRPM=rotor['rotationRPM'],gravityG=rotor['gravityG'])
if ROLE in ['carrier','dreadnought']:
 # Authored vertex gap diagnostic only. Exported triangle surfaces are
 # independently checked by model.test.ts, including inward chord distance.
 rotating=[v for name,(vs,_,_) in BATCH.items() if name.startswith('rotor:') for v in vs]
 zlo=min(v[2] for v in rotating);zhi=max(v[2] for v in rotating)
 static=[vs[i] for name,(vs,faces,_) in BATCH.items() if not name.startswith('rotor:') for face in faces if min(vs[i][2] for i in face)<=zhi and max(vs[i][2] for i in face)>=zlo for i in face]
 clearance=(min(math.hypot(v[0],v[1]) for v in rotating)-max(math.hypot(v[0],v[1]) for v in static))*SCALE
 report['authoredVertexGapMetres']=clearance
 assert clearance>.5, f'Habitat authored vertex gap {clearance} m insufficient'
(DEST/'model-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('SHIP_EXPORTED',json.dumps(report))
