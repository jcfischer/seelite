"""Three industrial shipyard studies. Blender --background --python this_file.py.
Metres, Y up, +Z forward. Material-batched authored geometry; seeded detail.
"""
import bpy, bmesh, math, random, json, struct
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent
random.seed(798)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
MATS={}; BATCH={}; GROUP_MAT={}; RIG={}; OWNER="static"

def material(name,color,metal=.55,rough=.5,emission=0,texture=True,alpha=1):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,alpha)
 p=m.node_tree.nodes.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*color,alpha);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 p.inputs['Alpha'].default_value=alpha
 if alpha<1:m.surface_render_method='DITHERED'
 if emission:
  p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
 if texture and not emission:
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(OUT/'coriolis-industrial-surface.png'),check_existing=True)
  mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(*color,1)
  m.node_tree.links.new(t.outputs['Color'],mix.inputs[1]);m.node_tree.links.new(mix.outputs[0],p.inputs['Base Color'])
 MATS[name]=m;return name

blue=[material('blue-grey-'+str(i),(.10+i*.012,.12+i*.012,.125+i*.012),.75,.43) for i in range(4)]
ivory=[material('pale-steel-'+str(i),(.42+i*.055,.43+i*.05,.40+i*.045),.45,.66) for i in range(3)]
steel=material('dark-structure',(.10,.12,.125),.75,.43)
black=material('recess-black',(.023,.032,.035),.65,.52)
alloy=material('machined-alloy',(.25,.28,.27),.83,.36)
rubber=material('hose-rubber',(.023,.027,.029),.08,.78)
orange=material('service-ochre',(.68,.38,.07),.25,.65)
warm=material('amber-lamp',(1,.43,.105),.15,.32,4,False)
cyan=material('cyan-display',(.025,.55,.66),.15,.32,1.7,False)
glass=material('canopy-glass',(.010,.028,.034),.28,.18,0,False,.91)

def poly(points,mat,group=None,uv=None):
 key=OWNER+"/"+(group or mat)
 if key not in BATCH:BATCH[key]=[[],[],[]];GROUP_MAT[key]=mat
 verts,faces,uvs=BATCH[key];pts=[Vector(p) for p in points];offset=len(verts)
 verts.extend([tuple(p) for p in pts]);faces.append(tuple(range(offset,offset+len(pts))))
 if uv is None:
  n=(pts[1]-pts[0]).cross(pts[2]-pts[0]);axis=max(range(3),key=lambda i:abs(n[i]));ij=[i for i in range(3) if i!=axis]
  uv=[(p[ij[0]]/14.5,p[ij[1]]/14.5) for p in pts]
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
 pts=[c+(p-c)*.982 for p in pts];prism(pts,n,depth,mat,group="cladding-"+mat)
 if bolts:
  for i,p in enumerate(pts):
   q=pts[(i+1)%len(pts)];length=(q-p).length;count=max(1,int(length/4.5))
   for j in range(count+1):
    a=p.lerp(q,j/count)*.975+c*.025+n*(depth+.025)
    tube(a-n*.005,a+n*.025,.115,steel,4)
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

# Shipyard authoring units: 10 metres, exported as metres. Y up, +Z docking approach.
# Separate material batches for static structure and rotating life capsule.
white=material("work-flood",(1,.83,.53),.1,.3,3,False)


X=Vector((1,0,0));Y=Vector((0,1,0));Z=Vector((0,0,1))
def beam(a,b,width=.5,mat=steel):tube(a,b,width,mat,4)
def annulus(c,z,ri,ro,depth,mat,n=32,phase=0):
 for i in range(n):
  a=math.tau*i/n+phase;b=math.tau*(i+1)/n+phase
  prism([(c[0]+r*math.cos(t),c[1]+r*math.sin(t),z) for r,t in [(ri,a),(ro,a),(ro,b),(ri,b)]],Z,depth,mat)
def plated_box(c,size,mat=None,step=5):
 c=Vector(c);sx,sy,sz=size
 box(c,size,steel)
 for u,v,n,wu,wv,dist in [(X,Z,Y,sx,sz,sy/2),(X,Z,-Y,sx,sz,sy/2),(X,Y,Z,sx,sy,sz/2),(X,Y,-Z,sx,sy,sz/2),(Z,Y,X,sz,sy,sx/2),(Z,Y,-X,sz,sy,sx/2)]:
  nu=max(1,round(wu/step));nv=max(1,round(wv/step));ctr=c+n*(dist+.015)
  for i in range(nu):
   for j in range(nv):
    a=-wu/2+i*wu/nu;b=-wv/2+j*wv/nv
    pts=[ctr+u*x+v*y for x,y in [(a,b),(a+wu/nu,b),(a+wu/nu,b+wv/nv),(a,b+wv/nv)]]
    plate(pts,mat or random.choice(ivory),n,.10,True)
def girder(a,b,w=3,h=4,skin=False):
 a,b=Vector(a),Vector(b);d=(b-a).normalized();v=Y;u=v.cross(d).normalized();L=(b-a).length
 for sx in [-1,1]:
  for sy in [-1,1]:beam(a+u*w*sx/2+v*h*sy/2,b+u*w*sx/2+v*h*sy/2,.42)
 count=max(1,round(L/7))
 for i in range(count):
  aa=a.lerp(b,i/count);bb=a.lerp(b,(i+1)/count)
  for sx in [-1,1]:
   beam(aa+u*w*sx/2-v*h/2,bb+u*w*sx/2+v*h/2,.21,alloy)
   beam(aa+u*w*sx/2+v*h/2,bb+u*w*sx/2-v*h/2,.20)
   beam(aa+u*w*sx/2-v*h/2,aa+u*w*sx/2+v*h/2,.32)
  if skin:
   ctr=aa.lerp(bb,.5)+Y*(h/2+.06)
   plate([ctr+u*x+d*z for x,z in [(-w/2,-L/count/2),(w/2,-L/count/2),(w/2,L/count/2),(-w/2,L/count/2)]],random.choice(ivory),Y,.1)
def tanks(x,y,z,count=3,along="z",r=1.6,height=8):
 for i in range(count):
  p=Vector((x,y,z))+Vector((i*(r*2.45) if along=="x" else 0,0,i*(r*2.45) if along=="z" else 0))
  tube(p,p+Y*height,r,alloy,16)
  for yy in [.4,height*.3,height*.76,height-.4]:tube(p+Y*yy,p+Y*(yy+.38),r*1.08,steel,16)
  tube(p+Y*height,p+Y*(height+.7),r*.72,ivory[1],12)
  tube(p+Y*(height+.7),p+Y*(height+1.25),r*.28,steel,10)
  box(p+Y*height*.50+Z*r,(r*1.0,height*.4,.16),orange)
  cable([p+Z*(r+.5)+Y*.5,p+Z*(r+.5)+Y*(height*.9),p+Y*(height+.7)],.14)
def vertical_radiator(x,y,z,w,h):
 box((x,y,z),(w,h,.55),steel);box((x,y,z+.31),(w-.5,h-.5,.14),black)
 for i in range(int(w/.35)):
  box((x-w/2+.3+i*.35,y,z+.5),(.11,h-.8,.25),alloy)
 for i in range(int(w/.45)):
  box((x-w/2+.3+i*.45,y,z-.45),(.16,h-.8,.4),alloy)
 for yy in [-h/2+.4,h/2-.4]:
  for dz in [-.67,.67]:tube((x-w/2,y+yy,z+dz),(x+w/2,y+yy,z+dz),.19,steel)
 # Fin banks are serviceable modules, separated by pressure headers and frames.
 for dx in [-w/2+.2,-w/6,w/6,w/2-.2]:
  for dz in [-.85,.85]:box((x+dx,y,z+dz),(.48,h,.55),steel)
 for yy in [-h/2+.1,0,h/2-.1]:
  for dz in [-.95,.95]:
   tube((x-w/2,y+yy,z+dz),(x+w/2,y+yy,z+dz),.34,alloy,10)
 for dx in [-w/6,w/6]:box((x+dx,y,z+1.25),(1.2,2,.8),orange)
def mast(x,y,z,height=8):
 box((x,y,z),(2,1.4,2),ivory[1]);tube((x,y,z),(x,y+height,z),.14,alloy)
 for off in [-.9,.9]:tube((x+off,y,z),(x+off,y+height*.55,z),.06,alloy)
 tube((x,y+height,z),(x,y+height+.4,z),.20,warm)
def flood(c,normal=Y):
 c=Vector(c);n=Vector(normal);u=X if abs(n.x)<.5 else Z;v=n.cross(u)
 box(c,(1.6,.6,.6),steel,(u,v,n));box(c+n*.36,(1.18,.32,.12),white,(u,v,n))
def deck_tile(x,y,z,w,d):
 plate([(x-w/2,y,z-d/2),(x+w/2,y,z-d/2),(x+w/2,y,z+d/2),(x-w/2,y,z+d/2)],random.choice(blue),Y,.10)
def microship(c,length=12,carrier=False):
 c=Vector(c);w=length*.22
 plated_box(c,(w*1.5,w*.6,length),blue[1],4)
 if carrier:
  for z in [-length*.32,0,length*.32]:plated_box(c+Vector((-w*1.45,w*.23,z)),(w*1.5,w*1.2,length*.29),ivory[1],3)
 else:plated_box(c+Vector((0,w*.55,length*.22)),(w*.9,w*.38,length*.3),ivory[1],3)
 for side in [-1,1]:
  tube(c+Vector((side*w*.7,-w*.1,-length*.50)),c+Vector((side*w*.7,-w*.1,-length*.57)),w*.20,steel,12)
  tube(c+Vector((side*w*.7,-w*.1,-length*.571)),c+Vector((side*w*.7,-w*.1,-length*.59)),w*.12,cyan,12)
 box(c+Vector((0,w*.72,length*.29)),(w*.7,.12,length*.10),glass)
def industrial_pods(x,y,z,count=5):
 for i in range(count):
  zz=z+i*12
  plated_box((x,y,zz),(7,4.8,9),ivory[i%3],4)
  radiator(x,y+2.7,zz,4.6,6)
  for ss in [-1,1]:tube((x+ss*4,y-1,zz-4),(x+ss*4,y-1,zz+4),.28,alloy)
  lamp(x,y,zz+4.7)


# Round 2: chamfered manufactured housings, layered plates, denser machinery.
def plated_box(c,size,mat=None,step=5):
 c=Vector(c);sx,sy,sz=size;half=[s/2 for s in size];bevel=min(size)*.065;step=max(step,7.5)
 if mat in ivory and random.random()<.13:mat=random.choice(blue)
 # Six inset flat faces and their independently seated plates.
 for u,v,n,wu,wv,dist in [(X,Z,Y,sx,sz,sy/2),(X,Z,-Y,sx,sz,sy/2),(X,Y,Z,sx,sy,sz/2),(X,Y,-Z,sx,sy,sz/2),(Z,Y,X,sz,sy,sx/2),(Z,Y,-X,sz,sy,sx/2)]:
  wu-=2*bevel;wv-=2*bevel;ctr=c+n*dist
  poly([ctr+u*x+v*y for x,y in [(-wu/2,-wv/2),(wu/2,-wv/2),(wu/2,wv/2),(-wu/2,wv/2)]],steel)
  nu=max(1,round(wu/step));nv=max(1,round(wv/step))
  for i in range(nu):
   for j in range(nv):
    a=-wu/2+i*wu/nu;b=-wv/2+j*wv/nv
    pts=[ctr+u*x+v*y for x,y in [(a,b),(a+wu/nu,b),(a+wu/nu,b+wv/nv),(a,b+wv/nv)]]
    plate(pts,mat or random.choice(ivory),n,.1)
 # Twelve beveled long edges, split along length into replaceable plates.
 for a,b,k in [(0,1,2),(0,2,1),(1,2,0)]:
  for sa in [-1,1]:
   for sb in [-1,1]:
    nn=Vector((0,0,0));nn[a]=sa;nn[b]=sb
    length=2*(half[k]-bevel);count=max(1,round(length/step))
    for j in range(count):
     lo=-half[k]+bevel+j*length/count;hi=lo+length/count
     points=[]
     for aa,bb,kk in [(half[a],half[b]-bevel,lo),(half[a]-bevel,half[b],lo),(half[a]-bevel,half[b],hi),(half[a],half[b]-bevel,hi)]:
      p=Vector(c);p[a]+=aa*sa;p[b]+=bb*sb;p[k]+=kk;points.append(p)
     plate(points,steel,nn,.08,False)
 for xx in [-1,1]:
  for yy in [-1,1]:
   for zz in [-1,1]:
    corner=Vector((half[0]*xx,half[1]*yy,half[2]*zz))
    points=[c+corner-Vector((bevel*xx,bevel*yy,0)),c+corner-Vector((bevel*xx,0,bevel*zz)),c+corner-Vector((0,bevel*yy,bevel*zz))]
    poly(points,steel)

def microship(c,length=12,carrier=False):
 c=Vector(c);w=length*.13
 rows=[]
 for z,ww,hh in [(-.5,.62,.28),(-.41,1,.40),(-.05,1,.40),(.22,.8,.34),(.50,.40,.12)]:
  rows.append([c+Vector((xx*w*ww,yy*w*hh,z*length)) for xx,yy in [(-.7,1),(-1,.5),(-1,-.5),(-.7,-1),(.7,-1),(1,-.5),(1,.5),(.7,1)]])
 for ra,rb in zip(rows,rows[1:]):
  for j in range(8):
   pts=[ra[j],ra[(j+1)%8],rb[(j+1)%8],rb[j]]
   n=(pts[0]+pts[1])/2-c;n.z=0
   plate(pts,random.choice(blue),n,.09)
 poly(rows[0],steel);poly(rows[-1],ivory[1])
 if carrier:
  for z in [-length*.25,0,length*.25]:
   for side in [-1,1]:
    plated_box(c+Vector((side*w*1.25,w*.2,z)),(w*.85,w*.9,length*.20),ivory[1],3)
 for z in [-length*.25,0,length*.24]:
  radiator(c.x,c.y+w*.5,c.z+z,w*.8,length*.12)
 for side in [-1,1]:
  p=c+Vector((side*w*.65,0,-length*.47))
  tube(p,p-Z*length*.07,w*.36,alloy,12)
  tube(p-Z*length*.071,p-Z*length*.08,w*.25,cyan,12)
 box(c+Vector((0,w*.40,length*.29)),(w*.75,.12,length*.08),glass)
 for side in [-1,1]:lamp(c.x+side*w*.7,c.y+w*.4,c.z+length*.15)

def pipeline(a,b,r=.38):
 a,b=Vector(a),Vector(b);d=(b-a).normalized();L=(b-a).length
 tube(a,b,r,alloy,12)
 for i in range(max(2,int(L/5))):
  p=a.lerp(b,i/max(1,int(L/5)-1));tube(p-d*.18,p+d*.18,r*1.40,steel,12)
  box(p-Y*(r+.2),(r*2.7,.3,r*2.7),steel)
def corner_hardware(c):
 c=Vector(c);plated_box(c,(2.2,2.4,2),steel,3)
 tube(c-Z*1.1,c+Z*1.2,.75,alloy,12)
 tube(c+Z*1.2,c+Z*1.35,.37,steel,8)
def front_frame(cx,cy,z,w,h,b=2.8,mat=None):
 # Thick clipped-corner octagonal rectangular frame, open central void.
 outer=[(-w/2+b,-h/2),(w/2-b,-h/2),(w/2,-h/2+b),(w/2,h/2-b),(w/2-b,h/2),(-w/2+b,h/2),(-w/2,h/2-b),(-w/2,-h/2+b)]
 inner=[(-w/2+b+.9,-h/2+1.4),(w/2-b-.9,-h/2+1.4),(w/2-1.4,-h/2+b+.9),(w/2-1.4,h/2-b-.9),(w/2-b-.9,h/2-1.4),(-w/2+b+.9,h/2-1.4),(-w/2+1.4,h/2-b-.9),(-w/2+1.4,-h/2+b+.9)]
 for j in range(8):
  k=(j+1)%8
  pts=[(cx+inner[j][0],cy+inner[j][1],z),(cx+outer[j][0],cy+outer[j][1],z),(cx+outer[k][0],cy+outer[k][1],z),(cx+inner[k][0],cy+inner[k][1],z)]
  plate(pts,mat or (ivory[1] if j%3 else blue[1]),Z,.45)
  mid=Vector((cx+(outer[j][0]+outer[k][0])/2,cy+(outer[j][1]+outer[k][1])/2,z+.6))
  if j%2:corner_hardware(mid)


def capsule(origin):
 global OWNER
 OWNER="capsule";r=22;zf=9;zb=-9;n=8;phase=math.pi/8
 def ring(z,rad):return [Vector((rad*math.cos(phase+i*math.tau/n),rad*math.sin(phase+i*math.tau/n),z)) for i in range(n)]
 # Broad rounded octagonal drum, three longitudinal rings of panels.
 rows=[ring(-9,19.8),ring(-7.5,22),ring(6.7,22),ring(9,19.8)]
 for ra,rb in zip(rows,rows[1:]):
  for j in range(n):
   k=(j+1)%n
   for ix in range(3):
    pts=[ra[j].lerp(ra[k],ix/3),ra[j].lerp(ra[k],(ix+1)/3),rb[j].lerp(rb[k],(ix+1)/3),rb[j].lerp(rb[k],ix/3)]
    nn=(pts[0]+pts[1])/2;nn.z=0
    plate(pts,ivory[(j+ix)%3],nn,.12)
 for zz,rr in [(-7.2,22.25),(6.5,22.25)]:annulus((0,0),zz,rr-.42,rr,.55,steel,8,phase)
 # End-cap is a genuine ring around a rectangular aperture. No filled disk.
 outer=ring(zf,19.8)
 inner=[]
 for p in outer:
  f=min(5.1/max(abs(p.x),1e-6),3.3/max(abs(p.y),1e-6));inner.append(Vector((p.x*f,p.y*f,zf)))
 for j in range(n):
  k=(j+1)%n
  pts=[inner[j],outer[j],outer[k],inner[k]];plate(pts,ivory[j%3],Z,.2)
  a=inner[j].lerp(outer[j],.14);b=inner[j].lerp(outer[j],.91)
  tube(a+Z*.3,b+Z*.3,.23,steel,4)
 # Portal jambs, inner throat walls and a recessed rear wall.
 for x in [-5.4,5.4]:
  box((x,0,9.35),(.75,7.45,.9),steel)
  box((x,0,9.88),(.13,5.9,.15),warm)
 for y in [-3.6,3.6]:
  box((0,y,9.35),(11.6,.65,.9),steel)
  box((0,y,9.89),(9.7,.13,.15),warm)
 for x in [-5.12,5.12]:box((x,0,3.2),(.2,6.6,11.6),steel,group="throat-walls")
 for y in [-3.31,3.31]:box((0,y,3.2),(10.4,.2,11.6),steel,group="throat-walls")
 box((0,0,-2.7),(10.4,6.6,.25),black,group="throat-back")
 for z in [-1,2,5,8]:
  for x in [-4.95,4.95]:box((x,-2.7,z),(.14,.13,1.0),warm)
  for y in [-3.15,3.15]:box((0,y,z),(9.5,.15,.18),alloy)
 for j in range(n):
  a=phase+(j+.5)*math.tau/n;nn=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0));ctr=nn*20.45+Z*9.25
  box(ctr,(1.7,.48,.4),steel,(t,nn,Z));box(ctr+Z*.26,(.9,.22,.13),warm,(t,nn,Z))
  # Thin rows of habitation windows, solid mount housing, side vents.
  ctr=nn*22.1
  box(ctr,(7,.3,2),steel,(t,nn,Z))
  for ii in range(7):box(ctr+t*(ii-3)*.85+nn*.2,(.43,.12,.6),warm,(t,nn,Z))
  for zz in [-4.7,4.1]:
   cc=ctr+Z*zz;box(cc,(4,.4,2.0),steel,(t,nn,Z))
   for ii in range(7):box(cc+t*(ii-3)*.48+nn*.27,(.15,.17,1.65),alloy,(t,nn,Z))
 # Rear cap sealed; bearing has its own stationary root.
 annulus((0,0),-9.2,3.0,19.8,.2,steel,32)
 OWNER="static"
 ox,oy,oz=origin
 for dz,ri,ro in [(-10.7,15,21.5),(-12.3,13,20.6),(-14.2,8,17.7)]:annulus((ox,oy),oz+dz,ri,ro,.9,alloy if dz==-12.3 else steel,32)
 for j in range(16):
  a=j*math.tau/16
  box((ox+21*math.cos(a),oy+21*math.sin(a),oz-11),(1.5,1.5,2),orange if j%4==0 else ivory[0])
 return {"origin":origin,"portLocal":[0,0,9.6],"bearing":[ox,oy,oz-13.3],"radius":22.6,"frontZ":oz+9.6}

def gantry():
 # An assembly floor held between tall box-truss booms, with three bridge cranes.
 for x in [-38,38]:
  girder((x,-5,-75),(x,-5,61),10,15,True)
  industrial_pods(x,5.5,-68,11)
  for zz in [-65,-38,-10,18,48]:
   plated_box((x,2,zz),(11,9,7),ivory[1],4)
   mast(x,7,zz,5 if zz%2 else 8)
  for zz in [-52,-15,22]:
   tanks(x+(-9 if x<0 else 9),-6,zz,3,r=1.8,height=12)
  for zz in [-37,0,37]:
   # Radiator panels hang below the booms.
   for dz in [-9,-3,3,9]:vertical_radiator(x,-19,zz+dz,8,20)
 for z in [-73,-42,-10,22,57]:girder((-38,-8,z),(38,-8,z),4,6)
 for z in range(-68,59,9):
  for x in range(-27,30,9):deck_tile(x,-2.7,z,8.8,8.8)
 for x in [-27,27]:
  tube((x,-2.35,-70),(x,-2.35,61),.22,orange)
  for z in range(-67,60,10):box((x,-2.02,z),(1.0,.08,3.6),ivory[1])
 for z in [-43,-4,34]:
  for side in [-1,1]:
   x=side*29
   plated_box((x,12,z),(3.4,29,3.6),orange,5)
   tube((x-side*.8,0,z+2.1),(x-side*.8,24,z+2.1),.24,alloy)
   girder((x-side*3,-1,z-5),(x,19,z),2,2)
  plated_box((0,25,z),(60,4.8,4.8),ivory[1],5)
  girder((-28,22,z),(28,22,z),3.8,2)
  box((-10,21,z),(8,2.8,5),orange)
  for x in [-12,-8]:guided_actuator((x,20,z),(x,6,z),.5)
  box((-10,6,z),(5,1.2,2),steel)
  for x in [-23,0,23]:flood((x,22,z+2.6),(0,-.5,1))
 # Freighter under construction and rack of components.
 for z in [-32,-20,-8,4,16]:
  for x in [-7,7]:girder((x,-1.7,z),(x,3,z),1,2)
 # Detailed work vessel loaded from the Porter study by the viewer.
 for z in [30,42,53]:
  for x in [-18,-6,7,19]:plated_box((x,-.3,z),(6,4,7),blue[(int(z)+int(x))%4],4)
 girder((-34,0,63),(0,0,68),5,7)
 girder((34,0,63),(0,0,68),5,7)
 plated_box((0,0,69),(19,16,5),steel,5)
 info=capsule((0,0,85))
 microship((-60,1,40),5)
 microship((16,1,23),4)
 return info

def hangar():
 # Two deep open halls; pitched octagonal roof shoulders, articulated machinery wings.
 for x in [-47,0,47]:
  plated_box((x,11,-8),(7,35,87),ivory[1],6)
  for z in [-40,-12,16,31]:
   plated_box((x,12,z),(8.3,36.5,3.0),steel,4)
 for x in [-23.5,23.5]:
  # floor and rear bulkhead; empty hall inside.
  plated_box((x,-7,-8),(40,5,88),blue[1],6)
  plated_box((x,11,-49),(41,35,4),ivory[0],6)
  plated_box((x,31,-8),(35,5,86),ivory[1],5)
  for side in [-1,1]:
   xx=x+side*18.5
   pts=[(xx-side*2,33.6,-51),(xx+side*4,26,-51),(xx+side*4,26,35),(xx-side*2,33.6,35)]
   plate(pts,ivory[1],(side*.7,.7,0),.25)
  # Front opening bevels define deep rectangular halls.
  for side in [-1,1]:
   xx=x+side*20.8
   plated_box((xx,10,36),(3.3,31,4.6),ivory[1],4)
   for yy in [-1,7,15,23]:box((xx-side*1.8,yy,38.5),(.28,1.8,.2),white)
  for y in [-5.8,27]:plated_box((x,y,36),(40,3,5),steel,5)
  for z in [-40,-17,7,28]:
   for xx in [x-15,x+15]:
    beam((xx,-3,z),(xx,26,z),.38,orange)
    flood((xx,23,z),(0,-.7,1))
   girder((x-17,24,z),(x+17,24,z),2.2,3.3)
   box((x,21.6,z),(7,2,3),orange)
   for dx in [-2,2]:guided_actuator((x+dx,21,z),(x+dx,11,z),.45)
  for zz in range(-40,32,8):
   for xx in [x-12,x,x+12]:deck_tile(xx,-4.4,zz,11.5,7.7)
  for xx in [x-13,x+13]:box((xx,-4.18,-7),(.28,.1,77),orange)
  radiator(x,34,-35,16,11);radiator(x+7,34,0,9,14)
  for zz in [-36,-18,0,18]:hatch(x-7,34,zz,6,8)
 # Work vessel supplied by viewer.
 for xx in [-32,-15]:
  for zz in [-6,7]:girder((xx,-3,zz),(xx,2,zz),2,2)
 for side in [-1,1]:
  x=side*58
  girder((x,8,-44),(x,8,30),12,18,True)
  industrial_pods(x,20,-38,6)
  for z in [-31,-5,22]:tanks(x+side*8,3,z,3,r=1.6,height=10)
  for z in [-27,4,26]:vertical_radiator(x,7,z,9,16)
  for z in [-40,29]:plated_box((x,10,z),(15,23,8),ivory[1],5)
 tanks(-36,35,-40,5,"x",2,13)
 for x in [0,16,32]:vertical_radiator(x,42,-46,12,16)
 plated_box((42,41,-40),(8,21,8),ivory[0],4);mast(42,52,-40,10)
 # Static dogleg descends behind the drum, then terminates in the rear bearing.
 girder((0,-9,7),(0,-29,7),6,6)
 plated_box((0,-34,7),(9,10,9),steel,4)
 girder((0,-37,7),(0,-37,24),7,7)
 info=capsule((0,-37,39))
 microship((-85,-22,22),5)
 microship((72,-16,54),4)
 return info

def slipway():
 # Horseshoe in the XZ plane: broad plated upper arc over an open truss depth.
 R=62;segments=18;start=math.radians(42);end=math.radians(318)
 # theta=0 is front +Z, gap faces forward.
 def point(a,r,y):return Vector((math.sin(a)*r,y,math.cos(a)*r))
 for i in range(segments):
  a=start+(end-start)*i/segments;b=start+(end-start)*(i+1)/segments
  mid=(a+b)/2
  for rr in [R-7,R+7]:
   for yy in [-6,6]:beam(point(a,rr,yy),point(b,rr,yy),.6)
   beam(point(a,rr,-6),point(b,rr,6),.4,alloy)
   beam(point(a,rr,6),point(b,rr,-6),.36)
   beam(point(a,rr,-6),point(a,rr,6),.6)
  for yy in [-6,6]:beam(point(a,R-7,yy),point(a,R+7,yy),.6)
  # Clad outer shoulder and roof; separate panels give scale.
  for j in range(3):
   aa=a+(b-a)*j/3;bb=a+(b-a)*(j+1)/3
   plate([point(aa,R-7,6.4),point(bb,R-7,6.4),point(bb,R+7,6.4),point(aa,R+7,6.4)],random.choice(ivory),Y,.15)
   for yy in [-3,1]:
    nn=point((aa+bb)/2,1,0)
    plate([point(aa,R+7.1,yy),point(bb,R+7.1,yy),point(bb,R+7.1,yy+3.8),point(aa,R+7.1,yy+3.8)],random.choice(ivory),nn,.1)
  if i%2==0:
   c=point(mid,R,7);radiator(c.x,c.y,c.z,4,5)
   c=point(mid,R-7,-2);flood(c,point(mid,-1,.2))
  if i%3==0:
   c=point(mid,R,8);mast(c.x,c.y,c.z,7)
  # Interior work clamps and cranes.
  if i%2==0:
   aa=point(mid,R-6,1);bb=point(mid,R-23,1)
   beam(aa,bb,.65,orange);beam(aa-Y*3,bb-Y*3,.45)
   for t in [.2,.6,1]:beam(aa.lerp(bb,t)-Y*3,aa.lerp(bb,t)+Y*.5,.28,alloy)
   box(bb,(3,3,4),orange)
   beam(bb,bb+Y*8,.55,orange)
   cc=point(mid,R-29,9);beam(bb+Y*8,cc,.55,orange)
   guided_actuator(cc,cc-Y*6,.4);flood(cc-Y*.6,(0,-1,0))
 # Tips extend forward as twin repair fingers.
 for side in [-1,1]:
  xx=side*math.sin(start)*R;zz=math.cos(start)*R
  girder((xx,0,zz),(xx,0,zz+48),13,12,True)
  for z in [zz+12,zz+29,zz+45]:plated_box((xx,2,z),(14,9,5),ivory[1],4)
  for z in [zz+5,zz+22,zz+39]:
   tube((xx-side*7.2,5,z-7),(xx-side*7.2,5,z+7),.32,orange)
   beam((xx-side*7,3,z),(xx-side*17,3,z),.48,orange)
   box((xx-side*17,3,z),(3,2,4),steel)
   flood((xx-side*6,5,z),(0,-.5,1))
  mast(xx,7,zz+44,8)
 # Outer plant attached on the back and left, balanced asymmetry.
 for x,z in [(-63,-16),(-49,-44),(0,-67),(45,-47)]:
  plated_box((x,-2,z),(14,8,10),ivory[1],4)
  tanks(x-4,3,z,3,"x",1.8,9)
  for dx in [-4,4]:vertical_radiator(x+dx,-13,z,7,17)
 # Apex-mounted hub, docking upward clear of the ring's working plane.
 info=vertical_capsule((0,32,-62))
 # Work vessel supplied by viewer.
 microship((7,-4,64),4)
 microship((16,-8,30),3)
 return info


_base_capsule=capsule
def capsule(origin):
 global OWNER
 info=_base_capsule(origin);OWNER="capsule"
 # Nested front frame and individual inset armor sectors rather than one face slab.
 phase=math.pi/8;n=8
 for j in range(n):
  a=phase+j*math.tau/n;b=phase+(j+1)*math.tau/n
  for r0,r1 in [(8.5,12.5),(12.8,18.1)]:
   for k in range(2):
    aa=a+(b-a)*k/2;bb=a+(b-a)*(k+1)/2
    pts=[(r*math.cos(t),r*math.sin(t),9.35) for r,t in [(r0,aa),(r1,aa),(r1,bb),(r0,bb)]]
    plate(pts,blue[1] if (j==1 or j==5) and r0>10 else ivory[j%3],Z,.16)
  aa=Vector((18.6*math.cos(a),18.6*math.sin(a),9.75))
  corner_hardware(aa)
  p=Vector((11*math.cos((a+b)/2),11*math.sin((a+b)/2),9.63))
  tube(p-Y*.45,p+Y*.45,.18,alloy)
 annulus((0,0),9.25,19.35,20.4,.6,steel,8,phase)
 annulus((0,0),9.87,19.7,20.2,.14,alloy,8,phase)
 front_frame(0,0,10.03,14.3,10.7,1.5,steel)
 for x in [-5.6,5.6]:
  box((x,0,10.6),(.26,6.6,.19),warm)
 for y in [-3.77,3.77]:
  box((0,y,10.6),(10.6,.24,.18),warm)
 for z in [-1,2,5,7.8]:
  for x in [-4.7,4.7]:
   box((x,0,z),(.18,6,.2),alloy)
   box((x,-2.95,z),(.18,.18,1.6),warm)
 for j in range(8):
  a=phase+(j+.5)*math.tau/8;normal=Vector((math.cos(a),math.sin(a),0));t=Vector((-math.sin(a),math.cos(a),0));p=normal*22.55
  for off in [-4.5,4.5]:
   box(p+t*off,(1.0,.6,14),steel,(t,normal,Z))
   for zz in [-5,0,5]:box(p+t*off+Z*zz,(1.6,.85,1.2),alloy,(t,normal,Z))
  for zz in [-5.5,5.5]:
   pp=p+Z*zz;box(pp,(6.8,.5,.4),steel,(t,normal,Z))
 OWNER="static";return info

def sideways_radiator(x,y,z,w,h):
 before={k:len(v[0]) for k,v in BATCH.items()}
 vertical_radiator(x,y,z,w,h)
 for k,(verts,faces,uv) in BATCH.items():
  for i in range(before.get(k,0),len(verts)):
   xx,yy,zz=verts[i];verts[i]=(x+(zz-z),yy,z-(xx-x))

_base_gantry=gantry
def gantry():
 info=_base_gantry()
 # Continuous armored tops and stepped caps connect the repeated service modules.
 for x in [-38,38]:
  for z in range(-69,61,10):
   plated_box((x,8.5,z),(12,3.0,9.65),ivory[(z//10)%3],4)
   # Dark inlaid service channels running continuously along the beam.
   box((x-3.4,10.1,z),(1.0,.2,9.4),steel)
   pipeline((x+4.5,9.8,z-4.7),(x+4.5,9.8,z+4.7),.27)
  for zz in [-42,-4,34]:
   for xx in [x-4.4,x+4.4]:corner_hardware((xx,10.1,zz))
  for z in [-44,-10,24]:
   sideways_radiator(x+(-6 if x<0 else 6),-17,z,27,19)
  for dz in [-2,0,2]:pipeline((x+(-5.6 if x<0 else 5.6),-1+dz,-69),(x+(-5.6 if x<0 else 5.6),-1+dz,60),.32)
 for z in [-43,-4,34]:
  for side in [-1,1]:
   x=side*29
   plated_box((x,12,z+2.2),(2.6,25,1.5),steel,5)
   pipeline((x,1,z+3.2),(x,23,z+3.2),.31)
   for yy in [1,12,23]:corner_hardware((x,yy,z+3.4))
  pipeline((-27,27.8,z),(27,27.8,z),.34)
  for x in [-26,-16,-6,4,14,24]:
   plated_box((x,25,z+2.8),(7,3.2,1.6),ivory[1],3)
  for x in [-23,23]:plated_box((x,21,z),(5,3,6),orange,3)
 # Stout tail cross-member and forward utilities, without invading capsule sweep.
 girder((-38,4,-75),(38,4,-75),10,10,True)
 for x in [-27,0,27]:plated_box((x,7,-76),(16,7,10),ivory[1],4)
 for xx in [-20,20]:
  for zz in [-28,-6,14]:
   plated_box((xx,0,zz),(4,5,6),steel,3)
   beam((xx,3,zz),(xx*.5,5,zz),.5,orange)
 return info

_base_hangar=hangar
def hangar():
 info=_base_hangar()
 for x in [-23.5,23.5]:
  front_frame(x,10.5,39,46,38,5,steel)
  front_frame(x,10.5,38.1,42.5,34.7,4)
  front_frame(x,10.5,37.4,39.5,31.7,3.3,steel)
  # Bright yellow travelling cranes seated in the front half of the hall.
  for z in [11,25]:
   for xx in [x-15,x+15]:
    plated_box((xx,8,z),(1.6,23,1.6),orange,5)
    pipeline((xx+.5,-3,z+1),(xx+.5,20,z+1),.17)
   girder((x-16,21,z),(x+16,21,z),3,3.5)
   plated_box((x,21,z+1.6),(34,2.8,1.5),orange,5)
   for off in [-6,4]:
    box((x+off,18,z),(4,2,3),orange)
    guided_actuator((x+off,17,z),(x+off,7,z),.4)
   for xx in [x-13,x+13]:flood((xx,20,z+2),(0,-1,.3))
  for zz in [-40,-22,-4,14,29]:
   # Raised segmented roof cassettes with dark channels and cranked feed pipes.
   for xx in [x-10,x+10]:
    if zz<14:
     plated_box((xx,34.3,zz),(16,2.8,12),ivory[zz%3],5)
    else:
     side=1 if xx>x else -1
     inner=x+side*2;outer=x+side*18
     # Shallow 10.6-degree armor shoulder, integrated with the existing roof.
     for u0,u1 in [(0,.5),(.5,1)]:
      x0=inner+(outer-inner)*u0;x1=inner+(outer-inner)*u1
      y0=37-3*u0;y1=37-3*u1
      for z0,z1 in [(zz-6,zz),(zz,zz+6)]:
       plate([(x0,y0,z0),(x1,y1,z0),(x1,y1,z1),(x0,y0,z1)],ivory[1],(side*.184,.983,0),.25)
     plate([(inner,37,zz+6),(outer,34,zz+6),(outer,33.6,zz+6),(inner,33.6,zz+6)],steel,Z,.18)
     pipeline((inner,36.8,zz-6),(inner,36.8,zz+6),.3)
     # Flush vent slats read as equipment armor rather than open lids.
     for dz in [-1,-.5,0,.5,1]:
      a=Vector((inner+side*5,36.17,zz+dz));b=Vector((inner+side*11,35.04,zz+dz))
      beam(a,b,.15,steel)
   for dx in [-3,0,3]:pipeline((x+dx,36,zz-5),(x+dx,36,zz+5),.27)
  for side in [-1,1]:pipeline((x+side*16,34.8,-43),(x+side*16,34.8,31),.4)
 for side in [-1,1]:
  xx=side*66
  for z in [-34,-15,5,24]:
   plated_box((xx,12,z),(7,12,13),blue[1],4)
   for yy in [8,11,14]:pipeline((xx+side*4,yy,z-6),(xx+side*4,yy,z+6),.38)
   sideways_radiator(xx+side*4.6,10,z,10,9)
  for zz in [-40,29]:
   plated_box((xx,10,zz),(9,25,9),ivory[1],5)
 for xx in [-32,-20,-9]:pipeline((xx,36,-33),(xx,36,-17),.55)
 return info

_base_slipway=slipway
def slipway():
 info=_base_slipway()
 R=62;start=math.radians(42);end=math.radians(318);n=18
 def p(a,r,y):return Vector((math.sin(a)*r,y,math.cos(a)*r))
 for i in range(n):
  a=start+(end-start)*i/n;b=start+(end-start)*(i+1)/n;mid=(a+b)/2
  # Raised stepped armor spine with chamfered shoulders, articulated by dark belts.
  sections=[(R-7,6.6),(R-5,11),(R+4,11),(R+8,6.5)]
  for (r0,y0),(r1,y1) in zip(sections,sections[1:]):
   nn=Vector((math.sin(mid)*(y0-y1),r1-r0,math.cos(mid)*(y0-y1))).normalized()
   for j in range(3):
    aa=a+(b-a)*j/3;bb=a+(b-a)*(j+1)/3
    plate([p(aa,r0,y0),p(bb,r0,y0),p(bb,r1,y1),p(aa,r1,y1)],ivory[(i+j)%3],nn,.2)
  for rr in [R-6,R+6]:
   pipeline(p(a,rr,8),p(b,rr,8),.42)
  for rr in [R-8,R+8]:
   beam(p(a,rr,-5),p(a,rr,8),.9,steel)
  # Under-spine machinery, valve boxes, service trunk.
  pipeline(p(a,R-7.5,-2),p(b,R-7.5,-2),.45)
  cc=p(mid,R-7,3)
  if i%2==0:
   plated_box(cc,(3,4,4),orange,3)
   for zz in [-1,1]:tube(cc+Vector((-1,0,zz)),cc+Vector((1,0,zz)),.65,alloy,12)
  # Outboard enclosed machinery pods with horizontal tank bundles.
  if i in [2,5,8,11,14,16]:
   cc=p(mid,R+10,-1)
   plated_box(cc,(9,9,12),ivory[1],4)
   for yy in [-1.5,1.5]:
    aa=cc+Vector((-4,yy,7));bb=cc+Vector((4,yy,7))
    tube(aa,bb,1.15,alloy,16)
    for x in [-3,0,3]:tube(cc+Vector((x-.15,yy,7)),cc+Vector((x+.15,yy,7)),1.25,steel,16)
   vertical_radiator(cc.x,cc.y-9,cc.z+7,9,12)
 for side in [-1,1]:
  xx=side*math.sin(start)*R;zz=math.cos(start)*R
  for z in [zz+9,zz+27,zz+46]:
   plated_box((xx,6,z),(14,6,10),ivory[1],4)
   for dx in [-4,4]:pipeline((xx+dx,9.3,z-5),(xx+dx,9.3,z+5),.3)
  for z in [zz+5,zz+22,zz+39]:
   root=Vector((xx-side*6,4,z));tip=Vector((xx-side*17,4,z))
   tube(root-Y*.6,root+Y*.6,1,alloy,12)
   pipeline(root+Y*.2,tip+Y*.2,.4)
   tube(tip-Y*.6,tip+Y*.6,.7,alloy,12)
   plated_box(tip,(3,3,4),orange,3)
 return info



# Round 3: industrial use is readable at the hero-view scale.
_r2gantry=gantry
def gantry():
 info=_r2gantry()
 for side in [-1,1]:
  x=side*38
  for i,z in enumerate(range(-64,60,12)):
   radiator(x,10.2,z,4.8,6)
   if i%2==0:
    hatch(x+3,10.25,z+2,2,3)
    lamp(x-4,10.6,z,"top")
   for yy in [-1.0,1.5]:
    pipeline((x+side*6.8,yy,z-5),(x+side*6.8,yy,z+5),.52)
  for z in [-72,61]:
   plated_box((x,2,z),(14,15,10),ivory[1],4)
   radiator(x,10,z,6,5)
   mast(x,11,z,9)
   for dx in [-4,4]:lamp(x+dx,4,z+5.4)
 for z in [-43,-4,34]:
  for x in [-29,29]:
   plated_box((x,24.5,z),(7,7,7),orange,3)
   for yy in [23,26]:
    tube((x-3.6,yy,z+3.6),(x+3.6,yy,z+3.6),.35,alloy)
   lamp(x,24.5,z+4)
  for x in [-18,3,20]:
   box((x,27.65,z),(6,.3,2.7),steel)
   radiator(x,27.95,z,5,2.4)
   pipeline((x-3,28.1,z-1.7),(x+3,28.1,z-1.7),.2)
 # Work stands cradle the detailed freighter, with independent machine pedestals.
 for z in [-29,-10,10]:
  for x in [-12,12]:
   plated_box((x,.5,z),(4,6,5),steel,3)
   tube((x,2,z),(x*.6,4,z),.5,orange)
   corner_hardware((x,3,z+1))
 for x,z in [(-17,36),(15,40),(-18,51)]:
  plated_box((x,1,z),(5,6,5),blue[1],3)
  radiator(x,4.2,z,3.4,3.2)
  tube((x,4,z),(x,8,z),.55,alloy)
  tube((x,8,z),(x+3,8,z),.5,orange)
  flood((x+3,8,z),(0,-1,0))
 return info

_r2hangar=hangar
def hangar():
 info=_r2hangar()
 for x in [-23.5,23.5]:
  for i,zz in enumerate([-40,-22,-4]):
   for side in [-1,1]:
    xx=x+side*10
    if (i+side)%3==0:
     radiator(xx,35.93,zz,12,7)
    else:
     hatch(xx,35.93,zz,5,7)
    pipeline((xx-6,36.3,zz-4),(xx+6,36.3,zz-4),.3)
  # Secondary roof rack, visibly different from the broad armor cassettes.
  girder((x-15,39,-31),(x+15,39,-31),4,2)
  for xx in [x-12,x,x+12]:
   plated_box((xx,39,-31),(6,2.5,4),steel,3)
   tanks(xx-1.5,40,-31,2,"x",.8,3)
  for z in [14,29]:
   # More visible longitudinal rail and articulated hoist, below the roof.
   plated_box((x,18,z),(31,2.2,2.5),orange,4)
   for xx in [x-12,x,x+12]:
    corner_hardware((xx,18,z+1.7))
   box((x+5,16,z),(6,3.3,4.5),steel)
   for dx in [3,7]:guided_actuator((x+dx,15,z),(x+dx,6,z),.45)
   plated_box((x+5,6,z),(6,1.3,2),orange,3)
  for xx in [x-17,x+17]:
   for z in [17,30]:
    plated_box((xx,0,z),(4,7,5),blue[1],3)
    radiator(xx,3.7,z,2,3)
  # Portal reveals emphasize thickness rather than bright bare jambs.
  for yy in [-6,27]:
   for xx in [x-14,x-5,x+5,x+14]:
    plated_box((xx,yy,40.2),(7,1.5,2.4),steel,3)
    lamp(xx,yy,41.6)
 for side in [-1,1]:
  xx=side*64
  for zz in [-24,0,22]:
   for yy in [4,8,12,16]:
    pipeline((xx+side*6,yy,zz-7),(xx+side*6,yy,zz+7),.48)
   plated_box((xx+side*6.5,10,zz),(3,14,4),orange,4)
 return info

_r2slipway=slipway
def slipway():
 info=_r2slipway()
 R=62;start=math.radians(42);end=math.radians(318);n=18
 def p(a,r,y):return Vector((math.sin(a)*r,y,math.cos(a)*r))
 for i in range(n):
  a=start+(end-start)*i/n;b=start+(end-start)*(i+1)/n;mid=(a+b)/2
  # Dark service belt atop the arc and occasional cooler replacement armor.
  for rr in [R-3,R+2]:
   pipeline(p(a,rr,11.55),p(b,rr,11.55),.34)
  cc=p(mid,R,11.4)
  if i%3:
   radiator(cc.x,cc.y,cc.z,4.0,4.8)
  else:
   plated_box(cc+Y*1.4,(6,2.5,5),blue[1],3)
   for yy in [1,2]:pipeline(cc+Vector((-3,yy,3)),cc+Vector((3,yy,3)),.25)
  if i%2==0:
   c=p(mid,R-8,2);tip=p(mid,R-20,2)
   plated_box(c,(3,6,4),steel,3)
   tube(c-Y*2,c+Y*2,1,alloy,16)
   beam(c+Y*1,tip+Y*1,1.0,orange)
   pipeline(c+Y*2,tip+Y*2,.38)
   tube(tip-Y*1.5,tip+Y*1.5,.85,alloy,16)
   arm=tip+Vector((0,7,0))
   beam(tip,arm,.8,steel);pipeline(tip+X*.8,arm+X*.8,.32)
   c2=p(mid,R-28,9);beam(arm,c2,.65,orange)
   box(c2,(2.5,2,3),steel);flood(c2-Y,(0,-1,0))
 # Equipment on the camera-near arc has the target's horizontal tank silhouette.
 for xx,zz in [(-67,-8),(-52,26),(-40,-50)]:
  plated_box((xx,-2,zz),(9,11,13),blue[1],4)
  for yy in [0,4]:
   for dz in [-3,3]:
    a=Vector((xx-7,yy,zz+dz));b=Vector((xx+7,yy,zz+dz))
    tube(a,b,1.8,alloy,20)
    for dx in [-5,0,5]:tube((xx+dx-.2,yy,zz+dz),(xx+dx+.2,yy,zz+dz),1.95,steel,16)
  sideways_radiator(xx-7.5,-11,zz,12,15)
 for side in [-1,1]:
  xx=side*math.sin(start)*R;zz=math.cos(start)*R
  # Long open span beyond the first round's armored tip.
  girder((xx,0,zz+48),(xx,0,zz+65),12,11,False)
  plated_box((xx,0,zz+65),(14,12,8),ivory[1],4)
  radiator(xx,6.2,zz+65,6,5)
  for dx in [-4,4]:pipeline((xx+dx,6.1,zz+44),(xx+dx,6.1,zz+68),.42)
  for y in [-3,3]:
   lamp(xx,y,zz+69.4)
  for z in [zz+9,zz+27,zz+46]:
   radiator(xx,9.25,z,5,6)
   plated_box((xx+side*4,9.2,z),(3,1.1,6),blue[1],3)
 return info



# Principal's mechanical ruling: no hanging hoists, and no EVA worker transfer.
def guided_actuator(a,b,r=.52):
 a,b=Vector(a),Vector(b);d=(b-a).normalized()
 tube(a,a.lerp(b,.58),r,steel,12)
 tube(a.lerp(b,.50),b,r*.53,alloy,12)
 for f in [.04,.48,.58]:
  p=a.lerp(b,f);tube(p-d*.22,p+d*.22,r*1.3,orange,12)
 tube(a-d*.5,a+d*.5,r*1.5,alloy,12)
 tube(b-d*.4,b+d*.4,r*1.4,alloy,12)

def robot_arm(base,elbow,tip):
 global OWNER
 base,elbow,tip=Vector(base),Vector(elbow),Vector(tip)
 previous=OWNER;idx=len(RIG)//4;prefix="tool-"+str(idx)
 # Captured carriage on a short rigid rail. End stops bound its travel.
 OWNER="static"
 for dx in [-1.3,1.3]:beam(base+X*dx-Z*4,base+X*dx+Z*4,.35,alloy)
 for dz in [-4,4]:box(base+Z*dz,(3.5,1,1),steel)
 parts=[("carriage",None,base,"rail",1.1),("shoulder",prefix+"-carriage",base,"pivot",.10),("elbow",prefix+"-shoulder",elbow,"pivot",.16),("wrist",prefix+"-elbow",tip,"pivot",.14)]
 for part,parent,pivot,motion,amplitude in parts:
  name=prefix+"-"+part
  RIG[name]={"parent":parent,"origin":tuple(pivot),"motion":motion,"amplitude":amplitude,"phase":idx*1.7}
 OWNER=prefix+"-carriage";plated_box(base,(3.5,1.2,3.5),steel,3)
 for part,a,b in [("shoulder",base,elbow),("elbow",elbow,tip)]:
  OWNER=prefix+"-"+part
  beam(a,b,.66,orange);pipeline(a+Z*.7,b+Z*.7,.26)
  guided_actuator(a+X*.7,a.lerp(b,.8)+X*.7,.4)
  tube(a-Z*.65,a+Z*.65,1.0,steel,16)
  tube(a+Z*.65,a+Z*.8,.67,alloy,12)
 OWNER=prefix+"-wrist"
 tube(tip-Z*.65,tip+Z*.65,1.0,steel,16)
 plated_box(tip,(2.1,2.0,2.2),steel,3)
 for side in [-1,1]:
  beam(tip+X*side,tip+X*side+Y*-2,.3,alloy)
  beam(tip+X*side+Y*-2,tip+X*(side*.35)+Y*-2,.3,steel)
 OWNER=previous

def pressure_spine(points,r=3.5):
 points=[Vector(p) for p in points];rings=[];inners=[]
 for i,c in enumerate(points):
  if i==0:t=(points[1]-c).normalized()
  elif i==len(points)-1:t=(c-points[i-1]).normalized()
  else:t=(points[i+1]-points[i-1]).normalized()
  u=t.cross(Y if abs(t.y)<.9 else X).normalized();v=t.cross(u).normalized()
  rings.append([c+(u*math.cos(j*math.tau/8+math.pi/8)+v*math.sin(j*math.tau/8+math.pi/8))*r for j in range(8)])
  inners.append([c+(u*math.cos(j*math.tau/8+math.pi/8)+v*math.sin(j*math.tau/8+math.pi/8))*(r-.45) for j in range(8)])
 for k in range(len(points)-1):
  ra,rb=rings[k:k+2];ia,ib=inners[k:k+2]
  for j in range(8):
   q=(j+1)%8;pts=[ra[j],ra[q],rb[q],rb[j]]
   poly(pts,steel,group="pressurized-access-shell")
   poly([ia[j],ib[j],ib[q],ia[q]],steel,group="pressurized-access-lining")
   nn=(ra[j]+ra[q])/2-points[k]
   length=(points[k+1]-points[k]).length;count=max(1,int(length/5))
   for a in range(count):
    p0=ra[j].lerp(rb[j],a/count);p1=ra[q].lerp(rb[q],a/count);p2=ra[q].lerp(rb[q],(a+1)/count);p3=ra[j].lerp(rb[j],(a+1)/count)
    plate([p0,p1,p2,p3],ivory[a%3] if j%3 else blue[1],nn,.14)
 for i in [0,len(points)-1]:
  for j in range(8):
   q=(j+1)%8
   poly([rings[i][j],inners[i][j],inners[i][q],rings[i][q]],alloy,group="pressurized-access-rim")

_r3capsule=capsule
def capsule(origin):
 global OWNER
 info=_r3capsule(origin);OWNER="capsule"
 # Rear rotating pressure sleeve receives workers on axis through the bearing.
 annulus((0,0),-9.65,3.0,4.4,.50,alloy,32)
 annulus((0,0),-9.16,3.0,3.9,.48,rubber,32)
 OWNER="static";ox,oy,oz=origin
 annulus((ox,oy),oz-10.6,3.0,4.6,.89,alloy,32)
 info["crewEntryLocal"]=[0,0,-9.65]
 return info

_r3gantry=gantry
def gantry():
 info=_r3gantry()
 route=[(-30,0,60),(0,0,60),(0,0,74.8)]
 pressure_spine(route,3.7);info["crewRoute"]=route
 # Carriages traverse the portal rails; arms react against their anchored rails.
 for z in [-43,-4,34]:
  robot_arm((-10,19,z),(-6,12,z+2),(1,7,z+2))
  for x in [-12,12]:
   guided_actuator((x,-1,z),(x*.55,3,z),.62)
   plated_box((x*.55,3,z),(3,2,3),steel,3)
 return info

_r3hangar=hangar
def hangar():
 info=_r3hangar()
 route=[(0,-7,5),(0,-37,5),(0,-37,28.8)]
 pressure_spine(route,3.8);info["crewRoute"]=route
 for x in [-23.5,23.5]:
  for z in [14,29]:
   robot_arm((x+5,15,z),(x+10,9,z-2),(x+3,4,z-2))
  for z in [16,27]:
   for side in [-1,1]:
    guided_actuator((x+side*10,-3,z),(x+side*5,0,z),.6)
    plated_box((x+side*5,0,z),(2.5,2,3.2),steel,3)
 return info

def vertical_capsule(origin):
 # Keep rotating geometry in its own local Z frame; turn only its mounting axis.
 counts={k:len(v[0]) for k,v in BATCH.items()}
 info=capsule((0,0,0))
 def orient(v):
  return Vector((v[0],v[2],-v[1]))+Vector(origin)
 for name,(verts,faces,uvs) in BATCH.items():
  if name.startswith("capsule/"):continue
  for i in range(counts.get(name,0),len(verts)):verts[i]=tuple(orient(verts[i]))
 info["origin"]=origin;info["bearing"]=tuple(orient((0,0,-13.3)))
 info["tiltX"]=-math.pi/2
 return info

_r3slipway=slipway
def slipway():
 info=_r3slipway()
 route=[(0,0,-62),(0,21.8,-62)]
 pressure_spine(route,3.7);info["crewRoute"]=route
 # External repair plant: radial housings and tangent cylinder racks.
 for degrees in [210,235,260,285]:
  a=math.radians(degrees);radial=Vector((math.sin(a),0,math.cos(a)));tangent=Vector((math.cos(a),0,-math.sin(a)))
  c=radial*74
  armour=radial*69.5
  plate([armour-tangent*6-Y*5,armour+tangent*6-Y*5,armour+tangent*6+Y*9,armour-tangent*6+Y*9],blue[1],radial,1.2)
  plated_box(c,(12,9,12),blue[1],4)
  for height in [-2,2]:
   centre=c+radial*6+Y*height
   tube(centre-tangent*6,centre+tangent*6,1.55,alloy,16)
   for distance in [-5,0,5]:
    p=centre+tangent*distance;tube(p-tangent*.22,p+tangent*.22,1.72,steel,16)
  pipeline(c-tangent*6+Y*5,c+tangent*6+Y*5,.45)
  radiator(c.x,5,c.z,7,8)
 for d0,d1 in [(210,235),(235,260),(260,285)]:
  def header(d):
   a=math.radians(d);return Vector((math.sin(a)*80,5,math.cos(a)*80))
  pipeline(header(d0),header(d1),.65)
 for side in [-1,1]:
  robot_arm((side*41.5,10,67),(side*33,16,67),(side*25,10,67))
 return info


# Coriolis family: pale armour districts on dark strapped frames, recessed plant,
# broad three-tier docking coamings and small warm service fixtures.
def service_trunk(a,b,normal=Y):
 a,b=Vector(a),Vector(b);n=Vector(normal).normalized();d=(b-a).normalized();t=d.cross(n).normalized()
 box((a+b)/2,(3.8,(b-a).length,.7),black,(t,d,n))
 for offset in [-1,0,1]:
  pipeline(a+t*offset+n*.55,b+t*offset+n*.55,.26 if offset else .38)
 for i in range(1,max(2,int((b-a).length/7))):
  c=a.lerp(b,i/max(2,int((b-a).length/7)))
  box(c+n*.7,(4.4,.45,1.1),steel,(t,d,n))
  box(c+t*1.45+n*1.05,(.45,1.15,.25),warm,(t,d,n))

def docking_coaming():
 def outline(w,h,k,z):
  return [Vector(p) for p in [(-w+k,-h,z),(w-k,-h,z),(w,-h+k,z),(w,h-k,z),(w-k,h,z),(-w+k,h,z),(-w,h-k,z),(-w,-h+k,z)]]
 for a,b,mat in [((10,7.3,1.8,9.7),(8.7,6.1,1.2,10.3),steel),((8.7,6.1,1.2,10.3),(7.2,4.8,.8,10.9),alloy),((7.2,4.8,.8,10.9),(5.15,3.35,0,11.2),steel)]:
  aa=outline(*a);bb=outline(*b)
  for i in range(8):
   j=(i+1)%8;pts=[aa[i],aa[j],bb[j],bb[i]]
   clean=[]
   for p in pts:
    if not clean or (p-clean[-1]).length>.0001:clean.append(p)
   if len(clean)>2:poly(clean,mat,group="coriolis-dock-coaming-"+mat)
 for x in [-8.9,8.9]:
  for y in [-3.7,3.7]:
   box((x,y,10.95),(.8,1.1,.3),black)
   box((x,y,11.14),(.18,.65,.15),white)
 for x in range(-5,5):
  poly([(x,-5.65,10.86),(x+.4,-5.65,10.86),(x+.8,-4.95,11.1),(x+.4,-4.95,11.1)],orange,group="dock-hazard-sill")
 for x in [-13,13]:
  service_trunk((x,-11,9.62),(x,11,9.62),Z)
 for y in [-12.5,12.5]:service_trunk((-11,y,9.62),(11,y,9.62),Z)

_coriolis_capsule=capsule
def capsule(origin):
 global OWNER
 info=_coriolis_capsule(origin);OWNER="capsule"
 docking_coaming()
 # Broad radial structural ribs divide face armour into Coriolis-like districts.
 for j in range(8):
  a=math.pi/8+j*math.tau/8
  aa=Vector((13.5*math.cos(a),13.5*math.sin(a),9.7));bb=Vector((20*math.cos(a),20*math.sin(a),9.7))
  beam(aa,bb,.8,steel)
 OWNER="static"
 return info

_coriolis_gantry=gantry
def gantry():
 info=_coriolis_gantry()
 for x in [-38,38]:
  service_trunk((x,10.3,-64),(x,10.3,58))
  for z in [-50,-20,10,40]:
   box((x,10.5,z),(11,.7,1.4),steel)
 return info

_coriolis_hangar=hangar
def hangar():
 info=_coriolis_hangar()
 for x in [-23.5,23.5]:
  service_trunk((x,34.1,-43),(x,34.1,31))
  for side in [-1,1]:
   service_trunk((x+side*19,-2,40),(x+side*19,24,40),Z)
 return info

_coriolis_slipway=slipway
def slipway():
 info=_coriolis_slipway()
 for i in range(18):
  a=math.radians(42+276*i/18);b=math.radians(42+276*(i+1)/18)
  aa=Vector((math.sin(a)*62,11.3,math.cos(a)*62));bb=Vector((math.sin(b)*62,11.3,math.cos(b)*62))
  service_trunk(aa,bb)
 return info


def export(id,info):
 objects=[]
 root=bpy.data.objects.new("shipyard-"+id,None);bpy.context.collection.objects.link(root)
 spin=bpy.data.objects.new("life-capsule",None);bpy.context.collection.objects.link(spin);spin.parent=root;spin.location=Vector(info["origin"])*10;spin.rotation_euler.x=info.get("tiltX",0)
 rigs={}
 for name,spec in RIG.items():
  ob=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(ob)
  ob.parent=rigs[spec["parent"]] if spec["parent"] else root
  offset=Vector(RIG[spec["parent"]]["origin"]) if spec["parent"] else Vector()
  ob.location=(Vector(spec["origin"])-offset)*10
  ob["tool_motion"]=spec["motion"];ob["amplitude"]=spec["amplitude"];ob["phase"]=spec["phase"]
  rigs[name]=ob
 for name,(verts,faces,uvs) in BATCH.items():
  owner=name.split("/")[0];pivot=Vector(RIG[owner]["origin"]) if owner in RIG else Vector()
  mesh=bpy.data.meshes.new(name);mesh.from_pydata([tuple((Vector(v)-pivot)*10) for v in verts],[],faces);mesh.materials.append(MATS[GROUP_MAT[name]]);mesh.update()
  uv=mesh.uv_layers.new(name="surface-metres")
  for face,coords in zip(mesh.polygons,uvs):
   for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=xy
  bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
  ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);ob.parent=spin if name.startswith("capsule/") else rigs.get(owner,root);objects.append(ob)
  if "/cladding-" in name:
   bevel=ob.modifiers.new("plate-edge-radius","BEVEL");bevel.width=.28;bevel.segments=1
   normal=ob.modifiers.new("weighted-normals","WEIGHTED_NORMAL");normal.keep_sharp=True
 for name,loc,parent in [("docking-centre",info["portLocal"],spin),("bearing-centre",info["bearing"],root)]:
  ob=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(ob);ob.location=Vector(loc)*10;ob.parent=parent
 root["crew_route_author_units"]=json.dumps(info["crewRoute"]);root["tooling"]="rigid guided manipulators with positive clamps";root["design"]=id;root["metres_per_author_unit"]=10;spin["axis"]="local +Z";spin["radius_m"]=info["radius"]*10
 bpy.context.preferences.filepaths.save_version=0;bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(id+".blend")))
 glb=OUT/(id+".glb");bpy.ops.export_scene.gltf(filepath=str(glb),export_format="GLB",export_yup=False,export_apply=True,export_materials="EXPORT",export_extras=True)
 data=glb.read_bytes();jl=struct.unpack_from("<I",data,12)[0];doc=json.loads(data[20:20+jl])
 for m in doc["materials"]:
  if "baseColorTexture" in m.get("pbrMetallicRoughness",{}):m["pbrMetallicRoughness"]["baseColorFactor"]=list(MATS[m["name"]].diffuse_color)
 enc=json.dumps(doc,separators=(",",":")).encode();enc+=b" "*((-len(enc))%4);tail=data[20+jl:]
 glb.write_bytes(struct.pack("<4sII",b"glTF",2,20+len(enc)+len(tail))+struct.pack("<II",len(enc),0x4E4F534A)+enc+tail)
 print("EXPORTED",id,glb.stat().st_size,flush=True)

import sys
wanted=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else ["o1","o2","o3"]
for id,fn in [("o1",gantry),("o2",hangar),("o3",slipway)]:
 if id not in wanted:continue
 bpy.ops.object.select_all(action="SELECT");bpy.ops.object.delete(use_global=False);BATCH.clear();GROUP_MAT.clear();RIG.clear();OWNER="static";random.seed(800+int(id[1]))
 info=fn();export(id,info)
