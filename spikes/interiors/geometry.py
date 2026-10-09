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
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(OUT/'industrial-surface.png'),check_existing=True)
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
   q=pts[(i+1)%len(pts)];length=(q-p).length;count=max(1,min(3,int(length/9)))
   for j in range(count+1):
    a=p.lerp(q,j/count)*.975+c*.025+n*(depth+.025)
    tube(a-n*.005,a+n*.025,.115,steel,4)
    tube(a+n*.025,a+n*.083,.075,alloy,6)
   # Wear belongs in the surface map. Coplanar scratch triangles shimmer at bay scale.

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
