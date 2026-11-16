"""O2 Porter exterior study. Blender --background --python this_file.py.
Metres, Y up, +Z forward. Material-batched authored geometry; seeded detail.
"""
import bpy, bmesh, math, random, json, struct
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parent
random.seed(797)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
MATS={}; BATCH={}; GROUP_MAT={}; PREFIX=""

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

blue=[material('blue-grey-'+str(i),(.12+i*.012,.18+i*.012,.225+i*.012),.45,.49) for i in range(4)]
ivory=[material('pale-steel-'+str(i),(.62+i*.018,.60+i*.018,.55+i*.018),.48,.47) for i in range(3)]
steel=material('dark-structure',(.057,.071,.077),.76,.43)
black=material('recess-black',(.012,.019,.023),.42,.62)
alloy=material('machined-alloy',(.29,.295,.27),.84,.35)
rubber=material('hose-rubber',(.023,.027,.029),.08,.78)
orange=material('service-ochre',(.55,.29,.10),.37,.58)
warm=material('amber-lamp',(1,.29,.045),.2,.23,3,False)
cyan=material('cyan-display',(.025,.55,.66),.15,.32,1.7,False)
glass=material('canopy-glass',(.012,.055,.070),.62,.18,0,False,1)

def poly(points,mat,group=None,uv=None):
 key=PREFIX+(group or mat)
 if key not in BATCH:BATCH[key]=[[],[],[]];GROUP_MAT[key]=mat
 verts,faces,uvs=BATCH[key];pts=[Vector(p) for p in points];offset=len(verts)
 verts.extend([tuple(p) for p in pts]);faces.append(tuple(range(offset,offset+len(pts))))
 if uv is None:
  n=(pts[1]-pts[0]).cross(pts[2]-pts[0]);axis=max(range(3),key=lambda i:abs(n[i]));ij=[i for i in range(3) if i!=axis]
  scale=7.0
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
 pts=[c+(p-c)*.994 for p in pts];prism(pts,n,depth,mat)
 if bolts:
  for i,p in enumerate(pts):
   q=pts[(i+1)%len(pts)];length=(q-p).length;count=max(1,int(length/2.2))
   for j in range(count+1):
    a=p.lerp(q,j/count)*.955+c*.045+n*(depth+.025)
    tube(a-n*.005,a+n*.025,.06,steel,8)
    tube(a+n*.025,a+n*.083,.04,alloy,6)

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
   centre_y=sum(p.y for p in a+b)/16
   if n.dot(Vector((c.x-x,c.y-centre_y,0)))<0:n=-n
   subdivisions=max(1,math.ceil((a[k]-a[j]).length/2.3))
   for q in range(subdivisions):
    f,g=q/subdivisions,(q+1)/subdivisions
    aa=a[j].lerp(a[k],f);ab=a[j].lerp(a[k],g);bb=b[j].lerp(b[k],g);ba=b[j].lerp(b[k],f)
    longitudinal=max(1,math.ceil((ba-aa).length/2.8))
    for l in range(longitudinal):
     u,v=l/longitudinal,(l+1)/longitudinal
     pts=[aa.lerp(ba,u),ab.lerp(bb,u),ab.lerp(bb,v),aa.lerp(ba,v)]
     plate(pts,random.choice(roof if roof and j==0 else mat),n,.10)
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

