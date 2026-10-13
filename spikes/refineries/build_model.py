"""Four approved refinery studies, authoring units = 10 metres, Y up, +Z approach.
Rebuild: Blender --background --python spikes/refineries/build_model.py [-- o1]
"""
from pathlib import Path
exec(compile((Path(__file__).parent/'primitives.py').read_text(),'primitives.py','exec'))
from mathutils import noise
import sys
X=Vector((1,0,0));Y=Vector((0,1,0));Z=Vector((0,0,1))
# The approved broad asteroid proportions, applied at export.
SHAPE={'o1':(1.15,.96,1),'o2':(1.22,.94,1.14),'o3':(1,1,1),'o4':(1.09,1,1)}
for i,k in enumerate(ivory):
 MATS[k].diffuse_color=(.68+i*.025,.66+i*.024,.60+i*.023,1)
 for nd in MATS[k].node_tree.nodes:
  if nd.type=="MIX_RGB":nd.inputs[2].default_value=MATS[k].diffuse_color
rock=material('mineral-bedrock',(.76,.77,.76),0,.95,texture=False)
p=MATS[rock].node_tree.nodes.get('Principled BSDF')
t=MATS[rock].node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(OUT/'rock-albedo.png'),check_existing=True)
MATS[rock].node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
for name,color in [('mineral-dark',(.42,.43,.42)),('mineral-pale',(.87,.85,.78))]:
 m=material(name,color,0,.96,texture=False)
 tt=MATS[m].node_tree.nodes.new('ShaderNodeTexImage');tt.image=t.image
 MATS[m].node_tree.links.new(tt.outputs['Color'],MATS[m].node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
white=material('worklight',(1,.79,.48),.1,.3,3,False)
def plated(c,size,mat=None,step=5):
 c=Vector(c);sx,sy,sz=size;box(c,size,steel)
 for u,v,n,wu,wv,dist in [(X,Z,Y,sx,sz,sy/2),(X,Y,Z,sx,sy,sz/2),(X,Y,-Z,sx,sy,sz/2),(Z,Y,X,sz,sy,sx/2),(Z,Y,-X,sz,sy,sx/2)]:
  nu=max(1,round(wu/step));nv=max(1,round(wv/step));ctr=c+n*(dist+.015)
  for i in range(nu):
   for j in range(nv):
    a=-wu/2+i*wu/nu;b=-wv/2+j*wv/nv
    plate([ctr+u*x+v*y for x,y in [(a,b),(a+wu/nu,b),(a+wu/nu,b+wv/nv),(a,b+wv/nv)]],mat or random.choice(ivory),n,.08,True)
def railing(a,b,height=1.05):
 a,b=Vector(a),Vector(b);n=max(1,int((a-b).length/2.8))
 for y in [.40,height]:tube(a+Y*y,b+Y*y,.055,orange,6)
 for i in range(n+1):
  p=a.lerp(b,i/n);tube(p,p+Y*height,.065,steel,6)
def pipe(points,r=.30,mat=alloy):
 for a,b in zip(points,points[1:]):
  a,b=Vector(a),Vector(b);tube(a,b,r,mat,12);v=(b-a).normalized()
  for t in [.04,.48,.96]:
   p=a.lerp(b,t);tube(p-v*.13,p+v*.13,r*1.23,steel,12)
def tank(x,y,z,r=2.5,h=9):
 tube((x,y,z),(x,y+h,z),r,ivory[1],24)
 for yy in [.3,1,h*.28,h*.82,h-.1]:
  tube((x,y+yy,z),(x,y+yy+.22,z),r*1.04,steel,24)
 tube((x,y+h,z),(x,y+h+.7,z),r*.90,alloy,24)
 tube((x,y+h+.7,z),(x,y+h+1,z),r*.25,steel,12)
 tube((x,y+h*.56,z),(x,y+h*.56+.7,z),r*1.007,orange,24)
 pipe([(x+r*.9,y+.4,z+.3),(x+r*1.3,y+.4,z+.3),(x+r*1.3,y+h,z+.3)],.14)
 for yy in range(int(h)):
  tube((x-.4,y+yy,z+r+.15),(x+.4,y+yy,z+r+.15),.04,alloy,6)
 for xx in [-.43,.43]:tube((x+xx,y,z+r+.15),(x+xx,y+h,z+r+.15),.05,steel)
def machinery(x,y,z,w=10,h=7,d=8):
 plated((x,y+h/2,z),(w,h,d),step=4)
 for xx in [-w*.28,w*.28]:
  radiator(x+xx,y+h+.2,z,w*.35,d*.65)
  box((x+xx,y+h*.48,z+d/2+.15),(w*.28,h*.55,.3),steel)
  for j in range(max(4,int(h*2))):
   box((x+xx,y+h*.23+j*.25,z+d/2+.34),(w*.24,.10,.10),alloy)
  lamp(x+xx,y+h*.85,z+d/2+.28)
 hatch(x,y+h+.2,z,2,2.5)
 railing((x-w/2,y+h+.2,z-d/2),(x+w/2,y+h+.2,z-d/2))
 pipe([(x-w*.6,y+.6,z+d*.4),(x-w*.6,y+h*.8,z+d*.4),(x-w*.5,y+h*.8,z)],.32)
 # Secondary service housings break up repeated box faces and roof lines.
 for off in [-1,1]:
  plated((x+off*w*.33,y+h+.6,z-d*.28),(w*.22,1.2,d*.24),steel,3)
  pipe([(x+off*w*.4,y+1,z+d*.57),(x+off*w*.4,y+h*.65,z+d*.57),(x+off*w*.12,y+h*.65,z+d*.57),(x+off*w*.12,y+h*.65,z+d*.48)],.18)
 box((x,y+h*.75,z+d/2+.25),(w*.3,.45,.3),orange)
 for zz in [-d*.25,d*.20]:
  box((x+w/2+.2,y+h*.5,z+zz),(.4,h*.65,d*.18),steel)
  for yy in [.3,.6]:
   box((x+w/2+.45,y+h*yy,z+zz),(.1,.3,d*.14),alloy)
 # Small grounded skids, pressure vessels and thick umbilicals make a plant.
 if int(abs(x+z))%3==0:
  for off in [-1,1]:
   a=Vector((x+off*w*.28,y+h+.8,z-d*.25))
   tube(a,a+Z*d*.5,min(1.4,w*.12),alloy,16)
   for zz in [0,d*.4]:tube(a+Z*zz,a+Z*(zz+.2),min(1.5,w*.13),steel,16)
 else:
  plated((x+w*.14,y+h+1.3,z),(w*.40,2.6,d*.52),ivory[1],3)
 for yy in [.18,.42,.70]:
  pipe([(x-w*.5-.7,y+h*yy,z-d*.4),(x-w*.5-.7,y+h*yy,z+d*.4),(x-w*.22,y+h*yy,z+d*.4)],.24,steel)
def post(x,y,z,h=4):
 tube((x,y,z),(x,y+h,z),.10,steel)
 box((x,y+h,z),(.8,.35,.6),steel);box((x,y+h-.22,z),(.63,.09,.46),white)
# Flight export (`-- o1 --flight`, node #819): the recessed pad.
# The sim's refinery is a pad (#165): a deck 380 m square at the aperture
# plane, a 216 m hole round the lane and four berths standing on it
# (`stationInterior("refinery")`). The review box (`dock`) holds neither, so
# the flight export keeps the framed mouth in the rock, widened to hold the
# deck and made shallow (principal ruling, 2026-10-13). The game draws the deck
# and berths; this draws the housing round them and the lane's floor behind
# the hole. Metres, in the exported frame after the per-model shape; the whole
# model is then moved so the plane lies on the +Z axis at the sim's figure.
# tests/refinery-flight-asset.test.ts reads the sim's figures and fails on drift.
APERTURE_PLANE_M=396
PAD_INNER_M=200      # the housing's clear half-width; the deck's is 190 m
PAD_WALL_M=20
PAD_FRAME_M=36       # the frame's border outside the walls' inner face
PAD_FRAME_DEPTH_M=30
PAD_RECESS_M=24      # the deck's face behind the frame's front
PAD_FLOOR_M=60       # the lane's floor behind the deck's face, past the sim's 50.6 m landing well
PAD_CUT_M=40         # rock cleared outside the housing, before displacement
# Per model: the frame's centre and front face, metres, in the shaped frame,
# and how far the housing runs back into the rock. None keeps the review
# box's place.
FLIGHT_DOCK={'o1':(-69,-163,410),'o2':(0,0,650),'o3':(0,0,590),'o4':(-76,-120,500)}
FLIGHT_DEPTH_M={'o1':300,'o2':250,'o3':200,'o4':250}
CURRENT={}
def flight_dock_m(x,y,z):
 """Where the flight frame stands: the review box's front, shaped, unless set."""
 if FLIGHT_DOCK[CURRENT['id']] is not None:return Vector(FLIGHT_DOCK[CURRENT['id']])
 sh=SHAPE[CURRENT['id']];return Vector(((x)*10*sh[0],(y)*10*sh[1],(z+3)*10*sh[2]))
def pad_housing(f):
 """The recessed pad's housing, built unshaped in author units from metres."""
 global OWNER
 previous=OWNER;OWNER="pad"
 u=.1;cx,cy,front=f.x*u,f.y*u,f.z*u
 plane=front-PAD_RECESS_M*u;floor=plane-PAD_FLOOR_M*u;back=plane-FLIGHT_DEPTH_M[CURRENT['id']]*u
 hi=PAD_INNER_M*u;ho=hi+PAD_WALL_M*u;fd=PAD_FRAME_DEPTH_M*u;fo=hi+PAD_FRAME_M*u
 wall_front=front-fd;length=wall_front-back;mid=(wall_front+back)/2
 # Four walls, side walls full height so the corners close.
 for s in [-1,1]:
  plated((cx+s*(hi+ho)/2,cy,mid),(ho-hi,2*ho,length),steel,5)
  plated((cx,cy+s*(hi+ho)/2,mid),(2*hi,ho-hi,length),steel,5)
 # The lane's floor, seen through the deck's hole.
 plated((cx,cy,floor-.5),(2*hi,2*hi,1),steel,5)
 # Ribs along the inner walls, never across the opening.
 for zz in [floor+.6,(floor+wall_front)/2,wall_front-.4]:
  for s in [-1,1]:
   box((cx+s*(hi-.3),cy,zz),(.6,2*hi,.6),alloy)
   box((cx,cy+s*(hi-.3),zz),(2*hi,.6,.6),alloy)
 # The frame: the review box's chamfered ring and ochre armour, at pad size.
 def corners(w,h,c):return [(-w+c,-h),(w-c,-h),(w,-h+c),(w,h-c),(w-c,h),(-w+c,h),(-w,h-c),(-w,-h+c)]
 outer=corners(fo,fo,4.5);inner=corners(hi,hi,1.2)
 for i in range(8):
  j=(i+1)%8
  pts=[(cx+a,cy+b,wall_front) for a,b in [outer[i],outer[j],inner[j],inner[i]]]
  prism(pts,Z,fd,steel)
  op=[Vector(p) for p in pts];c=sum(op,Vector())/4
  plate([c+(p-c)*.79 for p in op],orange,Z,fd+.18,True)
 for s in [-1,1]:
  for t in [-.8,-.4,0,.4,.8]:
   box((cx+t*hi,cy+s*(hi+1.2),front+.3),(2.4,.3,.17),warm)
   box((cx+s*(hi+1.2),cy+t*hi,front+.3),(.3,2.4,.17),warm)
  for t in [-.6,0,.6]:lamp(cx+s*(fo-1),cy+t*hi,front+.25)
 OWNER=previous
 return Vector((cx,cy,plane))
def dock(x,y,z):
 if FLIGHT:
  f=flight_dock_m(x,y,z);CURRENT['front']=f
  return pad_housing(f)
 # A real open box, with recessed ribs and no opaque face across the mouth.
 for yy in [-8.8,8.8]:plated((x,y+yy,z-8),(29,2,20),steel,6)
 for xx in [-14,14]:plated((x+xx,y,z-8),(2,16,20),steel,5)
 for zz in [z+2,z-3,z-8,z-13]:
  box((x,y+7.6,zz),(26,.6,.6),alloy);box((x,y-7.6,zz),(26,.6,.6),alloy)
  for xx in [-12.6,12.6]:
   box((x+xx,y,zz),(.6,15.2,.6),alloy)
   box((x+xx*.96,y+4,zz+.1),(.23,3,.15),white)
  for xx in [-9,9]:box((x+xx,y-7.2,zz),(1.2,.08,2),warm)
 def corners(w,h,c):return [(-w+c,-h),(w-c,-h),(w,-h+c),(w,h-c),(w-c,h),(-w+c,h),(-w,h-c),(-w,-h+c)]
 outer=corners(17.5,11.5,3);inner=corners(13.1,8.0,1.2)
 for i in range(8):
  j=(i+1)%8
  pts=[(x+a,y+b,z) for a,b in [outer[i],outer[j],inner[j],inner[i]]]
  prism(pts,Z,3.0,steel)
  op=[Vector(p) for p in pts]
  # inset ochre armor segments leave a dark structural frame
  c=sum(op,Vector())/4
  plate([c+(p-c)*.79 for p in op],orange,Z,3.18,True)
 for yy in [-9.8,9.8]:
  for xx in [-10,-5,0,5,10]:box((x+xx,y+yy,z+3.3),(1.4,.3,.17),warm)
 for xx in [-15.4,15.4]:
  for yy in [-5,0,5]:lamp(x+xx,y+yy,z+3.25)
 for xx in [-17.5,17.5]:
  box((x+xx,y,z+1),(1,4,5),alloy)
 # back wall behind the tested 130 m navigable mouth
 plated((x,y,z-19),(27,16,1),steel,6)
 for xx in [-8,8]:box((x+xx,y,z-18.4),(.3,11,.1),warm)
 return (x,y,z+3)
def boolean_cut(ob,c,size):
 bpy.ops.mesh.primitive_cube_add(size=1,location=c);cut=bpy.context.object;cut.scale=size
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 bpy.context.view_layer.objects.active=ob
 kept=ob.data.copy()
 for self_intersecting in [False,True]:
  mod=ob.modifiers.new("excavation","BOOLEAN");mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cut
  mod.use_self=self_intersecting
  bpy.ops.object.modifier_apply(modifier=mod.name)
  if len(ob.data.polygons):break
  # The Works' quarry shell intersects itself, and under the flight export's
  # pad cut the plain exact solver returns nothing (15 360 faces to 0).
  # Cut the kept copy again in self-intersection mode. (The float solver
  # returned a ring of fragments.)
  print('BOOLEAN',ob.name,'exact solver emptied the mesh; self-intersection mode',flush=True)
  ob.data=kept.copy()
 if not len(ob.data.polygons):raise RuntimeError('boolean cut emptied '+ob.name)
 bpy.data.meshes.remove(kept);bpy.data.objects.remove(cut,do_unlink=True)
def asteroid(scale,center=(0,0,0),seed=5):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5,radius=1)
 ob=bpy.context.object;ob.name='quarried-asteroid'
 for v in ob.data.vertices:
  q=v.co.copy();n=noise.noise_vector(q*3.2+Vector((seed,seed*.7,1)));f=1+.11*n.x+.045*noise.noise(q*13)+.019*noise.noise(q*49)
  v.co=Vector((q.x*scale[0]*f,q.y*scale[1]*f,q.z*scale[2]*f))+Vector(center)
 ob.data.materials.append(MATS[rock]);return ob
def finish_rock(ob):
 # Rebuild the cut surfaces into geological facets rather than giant flat ngons.
 bpy.context.view_layer.objects.active=ob
 remesh=ob.modifiers.new('fractured-cut-surface','REMESH');remesh.mode='VOXEL';remesh.voxel_size=1.25;remesh.adaptivity=.18
 bpy.ops.object.modifier_apply(modifier=remesh.name)
 ob.data.update()
 for v in ob.data.vertices:
  q=v.co.copy()
  # Fine displacement breaks cliff walls while leaving machinery benches seated.
  amp=.15 if v.normal.y>.75 else 1.15
  v.co+=v.normal*(noise.noise(q*.95)*amp+noise.noise(q*.31)*amp+noise.noise(q*.13)*amp*.6)
 ob.data.update()
 for layer in list(ob.data.uv_layers):ob.data.uv_layers.remove(layer)
 # planar projections per polygon preserve geological grain through cut walls.
 uv=ob.data.uv_layers.new(name="rock-metres")
 ob.data.materials.clear()
 for mat in [rock,'mineral-dark','mineral-pale']:ob.data.materials.append(MATS[mat])
 for face in ob.data.polygons:
  q=face.center
  mineral=noise.noise(Vector((q.x*.065,q.y*.13,q.z*.065)))
  face.material_index=1 if mineral<-.40 else 2 if mineral>.46 else 0
  ij=[i for i in range(3) if i!=max(range(3),key=lambda i:abs(face.normal[i]))]
  for li in face.loop_indices:
   p=ob.data.vertices[ob.data.loops[li].vertex_index].co
   uv.data[li].uv=(p[ij[0]]/12,p[ij[1]]/12)
 # Rock's geometric facets remain faceted, fine grain supplied by generated albedo.
 for v in ob.data.vertices:v.co*=10
 return ob
def bore(ob,where):
 x,y,z=where
 if FLIGHT:
  # The housing's footprint and the deck's depth, cleared through the rock's
  # front, in the rock's unshaped author units. The cut stands PAD_CUT_M
  # outside the walls and behind the floor because the rock is displaced
  # after it (`finish_rock`, up to ~30 m along its normals).
  f=CURRENT['front'];sh=SHAPE[CURRENT['id']];u=.1
  half=(PAD_INNER_M+PAD_WALL_M+PAD_CUT_M)*u
  z0=(f.z-(PAD_RECESS_M+PAD_FLOOR_M+PAD_CUT_M))*u;z1=f.z*u+60
  boolean_cut(ob,(f.x*u/sh[0],f.y*u/sh[1],(z0+z1)/2/sh[2]),(2*half/sh[0],2*half/sh[1],(z1-z0)/sh[2]))
  return
 boolean_cut(ob,(x,y,z-6),(28,17,46))
def boulder(c,r,stretch=(1,1,1)):
 # Small solid angular fragments seated on quarry benches.
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3,radius=1)
 ob=bpy.context.object
 pts=[Vector(c)+Vector((v.co.x*r*stretch[0],v.co.y*r*.7*stretch[1],v.co.z*r*.8*stretch[2]))*(1+.24*noise.noise(v.co*5)) for v in ob.data.vertices]
 for f in ob.data.polygons:poly([pts[i] for i in f.vertices],rock)
 bpy.data.objects.remove(ob,do_unlink=True)
def wall_pipes(x,y,z,w):
 for i in range(3):
  pipe([(x-w/2,y+i*.95,z),(x+w*.40,y+i*.95,z),(x+w*.5,y+i*.95-.8,z),(x+w*.5,y-5,z)],.31)
def warren():
 ob=asteroid((59,51,43),(0,0,0),3)
 # Three broad excavation benches face the docking approach.
 for y,segments in [
  (1,[(-75,-37,18),(-37,-10,16),(-10,6,29),(6,35,17),(35,75,22)]),
  (17,[(-75,-32,1),(-32,-11,-11),(-11,1,-5),(1,18,0),(18,39,-2),(39,75,8)]),
  (33,[(-75,-10,-30),(-10,22,-24),(22,75,-19)])]:
  for left,right,z in segments:
   boolean_cut(ob,((left+right)/2,y+65,z+65),(right-left+.1,130,130))
 port=dock(-6,-17,43);bore(ob,(-6,-17,43))
 # Grounded plants on all three terraces, varied sizes.
 for spec in [(-33,1,24,13,8,11),(26,1,24,15,8,10),(-22,17,3,15,9,10),(7,17,0,17,8,9),(18,33,-21,15,7,9),(-3,33,-21,13,6,8)]:
  if spec[1]!=17:machinery(*spec)
 for x in [-33,-26,-19]:tank(x,1,31,2.4,8.5)
 for x in [22,28]:tank(x,1,18,2,10)
 for z,y in [(34,1),(9,17),(-13,33)]:
  railing((-35,y,z),(34,y,z))
  for x in [-34,-12,13,32]:post(x,y,z-.3,3)
  wall_pipes(-3,y+2,z-6,46)
 # Large ore hoppers recessed against the middle cut wall.
 for x,dz in [(-20,-4),(-6,2),(8,7)]:
  plated((x,24,-2+dz),(10,8,6),steel,4)
  # Tapered hopper and substantial downward chute in the cut rock face.
  pts=[(x-4.7,27,1.2+dz),(x+4.7,27,1.2+dz),(x+2.4,20,3+dz),(x-2.4,20,3+dz)]
  prism(pts,(0,.3,1),.45,alloy)
  prism([(x-2.4,21,3+dz),(x+2.4,21,3+dz),(x+2,17.8,8+dz),(x-2,17.8,8+dz)],(0,1,1),.35,steel)
  for d in [-4.4,4.4]:tube((x+d,17,4+dz),(x+d,27,dz),.38,steel)
  for j in range(8):boulder((x+random.uniform(-2,2),17.5,random.uniform(7,10)+dz),random.uniform(.35,.8))
 machinery(25,17,-1,12,7,9)
 for c,r in [((-43,2,19),3),((38,2,19),4),((-32,18,-3),2),((32,18,-5),3)]:
  boulder(c,r)
 for x in [-3,5]:
  tube((x,39,-22),(x,46,-22),.16,steel);lamp(x,46,-22)
 # Geological spurs interrupt the repeated shelf silhouette.
 for c,r in [((-23,33,-37),21),((-40,20,-10),11),((35,18,-14),12),((-46,2,16),11),((37,1,18),10),((9,1,33),5)]:
  boulder(c,r)
 for y,z in [(2,21),(18,0),(34,-23)]:
  for x in [-30,25]:tank(x,y,z,1.1,4)
 # Two unexcavated shoulders interrupt the shelf stack and carry its geology.
 boulder((-43,18,2),20,(.72,1.65,1))
 boulder((45,12,12),18,(.72,1.65,1))
 for x,dz in [(-20,-4),(-6,2),(8,7)]:
  for zz in [1.4,3.8,6.2]:
   tube((x-2,20-(zz-1)*.5,zz+dz),(x+2,20-(zz-1)*.5,zz+dz),.32,alloy,12)
  for side in [-1,1]:lamp(x+side*4.3,23,5+dz)
 for x,y,z in [(-20,1,29),(20,1,23),(-5,33,-24)]:
  pipe([(x,y+2,z),(x,y+6,z),(x+5,y+6,z),(x+5,y+2,z)],.6,alloy)
 return finish_rock(ob),port

def collar():
 ob=asteroid((51,52,47),(0,0,0),8)
 # An actual segmented equatorial belt, machinery recessed between strong clamps.
 N=22
 for i in range(N):
  a=math.tau*i/N;u=Vector((math.cos(a),0,-math.sin(a)));n=Vector((math.sin(a),0,math.cos(a)))
  if min(i,N-i)<2:continue
  c=Vector((n.x*54,0,n.z*51))
  box(c,(15,20,8),steel,(u,Y,n))
  for k in [-1,0,1]:
   cc=c+u*k*4.65+n*4.1
   box(cc,(4.5,18,.25),ivory[(i+k)%3],(u,Y,n))
   for yy in [-7,-3,1,5,8]:
    box(cc+Y*yy+n*.18,(4,.13,.10),steel,(u,Y,n))
   if k==0:
    box(cc+Y*1+n*.3,(3.1,6,.4),steel,(u,Y,n))
    for yy in range(-1,4):
     box(cc+Y*yy+n*.6,(2.8,.22,.12),alloy,(u,Y,n))
   box(cc+Y*8.3+n*.3,(1.8,.25,.2),warm,(u,Y,n))
  for yy in [-9.8,9.8]:
   tube(c-u*7+Y*yy+n*3.9,c+u*7+Y*yy+n*3.9,.22,alloy)
  # Projecting housings and open pipework break the continuous belt surface.
  cc=c+n*5.2
  if i%3==0:
   for off in [-4,0,4]:
    aa=cc+u*off-Y*5
    tube(aa,aa+Y*10,1.55,ivory[1],16)
    for yy in [1,5,8.5]:tube(aa+Y*yy,aa+Y*(yy+.27),1.64,steel,16)
    tube(aa+Y*5,aa+Y*5.7,1.57,orange,16)
  elif i%3==1:
   for yy in [-5,-2,1,4]:
    tube(cc-u*6+Y*yy,cc+u*6+Y*yy,.5,alloy,12)
    for off in [-5,5]:tube(cc+u*off+Y*yy-u*.2,cc+u*off+Y*yy+u*.2,.68,steel,12)
  else:
   for off in [-4,4]:
    box(cc+u*off,(4.8,13,3),steel,(u,Y,n))
    box(cc+u*off+n*1.65,(4.1,11,.4),ivory[i%3],(u,Y,n))
    for yy in [-3,0,3]:box(cc+u*off+Y*yy+n*1.95,(3.2,.17,.15),alloy,(u,Y,n))
  # Irregular upper machinery islands stand on each belt segment.
  if i%2:
   box(c+Y*11+n*.8,(11,3.2,7),steel,(u,Y,n))
   box(c+Y*13+n*.8,(8.5,1,5.6),ivory[i%3],(u,Y,n))
   for off in [-4,4]:
    aa=c+Y*12+u*off+n*4
    tube(aa,aa+n*2.5,.55,steel,12)
    box(aa+n*2.8,(1.0,.35,.4),warm,(u,Y,n))
 # Front head joins the belt to the dock.
 for yy in [-11,11]:plated((0,yy,46),(41,4,18),steel,6)
 port=dock(0,0,60);bore(ob,(0,0,60))
 # outer head side pods sit outside clear aperture.
 for x in [-23,23]:
  machinery(x,-10,53,11,20,13)
  for xx in [x-2.8,x+2.8]:tank(xx,10,49,1.7,6)
 # Clamps follow the rock's shoulders from equatorial belt towards the poles.
 for a in [-2.6,-1.5,-.72,.68,1.55,2.5]:
  n=Vector((math.sin(a),0,math.cos(a)));u=Vector((math.cos(a),0,-math.sin(a)))
  for s in [-1,1]:
   A=Vector((n.x*55,s*10,n.z*51));B=Vector((n.x*40,s*34,n.z*37));C=Vector((n.x*31,s*43,n.z*29))
   for aa,bb in [(A,B),(B,C)]:
    d=(bb-aa).normalized();v=d.cross(u).normalized()
    box((aa+bb)/2,(6,(bb-aa).length,3),steel,(u,d,v))
    for off in [-1.6,1.6]:tube(aa+u*off,bb+u*off,.36,alloy)
   tube(A+n*2,B+n*2,.95,alloy,16)
   tube(A+n*2,A.lerp(B,.58)+n*2,1.35,orange,16)
   for off in [-2.8,2.8]:
    tube(A+u*off+n*1.8,B+u*off+n*1.8,.44,steel,12)
   box(C,(8,3,7),steel)
   for t in [.12,.62,.9]:
    p=A.lerp(B,t);d=(B-A).normalized();v=d.cross(u).normalized()
    box(p,(7.2,3.4,4),steel,(u,d,v))
    box(p+v*2.1,(5.8,2.7,.25),alloy,(u,d,v))
    for off in [-2.8,2.8]:tube(p+u*off-v*2.2,p+u*off+v*2.2,.45,alloy,12)
   for off in [-2,2]:tube(B+u*off,C+u*off,.35,steel,12)
 for x in [-42,42]:
  for dx in [-3.3,3.3]:tank(x+dx,10,16,2.2,9)
 return finish_rock(ob),port

def spar():
 ob=asteroid((49,46,49),(0,0,8),12)
 for x in [-45,45]:boolean_cut(ob,(x,0,3),(59,38,110))
 # exposed service spine through rock, far-side tank group
 port=dock(0,0,59);bore(ob,(0,0,59))
 # side exposed conduits and structural roots.
 for x in [-24,24]:
  for zz in [38,12,-15,-43]:
   machinery(x,-14,zz,13,8,20)
   machinery(x,5,zz,13,8,20)
  for off in [-4,0,4]:
   pipe([(x,off,52),(x,off,-61),(6 if x>0 else -6,off,-70)],.65)
  for yy in [-2,0,2]:
   pipe([(32 if x>0 else -32,yy,47),(32 if x>0 else -32,yy,-58),(6 if x>0 else -6,yy,-70)],.52)
 for yy in [-15,0,15]:
  x=0
  tankc=Vector((x,yy,-85))
  tube(tankc+Z*19,tankc-Z*17,6.2,ivory[1],32)
  for zz in [-17,-13,0,13,18]:
   tube(tankc+Z*zz,tankc+Z*(zz+.6),6.45,steel,32)
  for zz in [-11,10]:tube(tankc+Z*zz,tankc+Z*(zz+1.1),6.27,orange,32)
  tube(tankc-Z*17,tankc-Z*19,5.4,alloy,32)
  tube(tankc-Z*19,tankc-Z*20,3.5,steel,24)
  for s in [-1,1]:
   pipe([(x+s*6,yy+4,-50),(x+s*6,yy+4,-99)],.50)
  machinery(10,yy-4,-80,5,7,18)
 # Upright rock clamps frame long spine.
 for x in [-31,31]:
  for z in [30,-22]:
   tube((x,-18,z),(x,18,z),1.05,steel,12)
   for y in [-15,15]:plated((x,y,z),(5.5,6,5),steel,3)
   tube((x,-12,z+2),(x,12,z+2),.64,orange,12)
   for y in [-12,0,12]:lamp(x,y,z+3)
 for x in [-12,12]:machinery(x,18,-49,10,7,16)
 for x in [-6,6]:tube((x,-22,-70),(x,22,-70),1.2,alloy,16)
 # Irregular native rock bridges interrupt the exposed process trench.
 for x in [-35,35]:boulder((x,0,-3),17,(.58,1.9,.72))
 for x in [-33,33]:
  for y in [-10,10]:
   for off in [-2,0,2]:pipe([(x,y+off,47),(x,y+off,-61),(x*.30,y+off,-67)],.62)
  for z in [-53,-65]:
   tube((x,-12,z),(x,16,z),.4,steel)
 # The aft vessel bank stacks vertically, readable beside the core.
 return finish_rock(ob),port
def works_rock():
 # Radially meshed quarry: broad shallow floor, two cut benches, rough outer rim.
 verts=[];faces=[];rings=34;seg=160
 verts.append((0,3,0))
 for r in range(1,rings+1):
  rho=r/rings
  for i in range(seg):
   a=math.tau*i/seg
   outline=1+.035*math.sin(5*a)+.045*math.cos(3*a)+.026*math.sin(9*a)
   x=63*rho*math.cos(a)*outline;z=49*rho*math.sin(a)*outline
   if rho<.74:y=9
   elif rho<.85:y=15
   elif rho<.92:y=19
   else:y=22+3*math.sin(a*4)
   if math.sin(a)>.10 and rho>.74:y=9+(y-9)*max(0,1-math.sin(a)*1.7)
   if rho>.74:y+=noise.noise(Vector((x,z,9))*.7)*.8
   verts.append((x,y,z))
 for i in range(seg):faces.append((0,1+(i+1)%seg,1+i))
 for r in range(rings-1):
  for i in range(seg):
   a=1+r*seg+i;b=1+r*seg+(i+1)%seg;c=a+seg;d=b+seg
   faces.extend([(a,b,c),(b,d,c)])
 outer=1+(rings-1)*seg;prev=outer
 for j in range(1,15):
  phi=j/15*math.pi/2;rr=math.cos(phi);base=len(verts)
  for i in range(seg):
   p=Vector(verts[outer+i]);p.x*=rr;p.z*=rr;p.y=22-60*math.sin(phi)
   p+=Vector((noise.noise(p*.23)*1.3,noise.noise(p*.34)*1.4,noise.noise(p*.27)*1.3))
   verts.append(tuple(p))
  for i in range(seg):
   n=(i+1)%seg;faces.extend([(prev+i,prev+n,base+i),(prev+n,base+n,base+i)])
  prev=base
 bottom=len(verts);verts.append((0,-38,0))
 for i in range(seg):faces.append((prev+i,prev+(i+1)%seg,bottom))
 mesh=bpy.data.meshes.new('quarry-shell');mesh.from_pydata(verts,[],faces);mesh.update()
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
 ob=bpy.data.objects.new('quarried-asteroid',mesh);bpy.context.collection.objects.link(ob);mesh.materials.append(MATS[rock])
 return ob
def works():
 ob=works_rock();port=dock(-7,-8,49);bore(ob,(-7,-8,49))
 for x in range(-35,36,10):
  for z in range(-25,36,10):
   if (x/63)**2+(z/49)**2>.85:continue
   box((x,9.2,z),(9.8,.3,9.8),alloy)
   for dx in [-4.3,4.3]:box((x+dx,9.37,z),(.16,.03,8.5),orange)
 # Broad plant on the quarry floor with open aisles and connected pipe racks.
 for x,z,w,h,d in [(-22,-8,14,8,11),(-6,-13,12,9,10),(19,-8,12,7,10),(-22,12,10,6,9),(20,12,14,7,10)]:
  machinery(x,9,z,w,h,d)
 for x in [-3,4,11]:tank(x,9,12,2.5,10)
 for z in [-21,1,23]:
  for off in [-.6,.6]:
   pipe([(-35,10+off*.2,z+off),(34,10+off*.2,z+off)],.4,steel)
 for x in [-28,-12,4,21]:
  pipe([(x,10,-21),(x,10,0),(x+2,11,0),(x+2,15,0)],.4,alloy)
 # rim facilities and fixed conveyor, no loose gravity crane.
 machinery(-28,19,-31,12,6,7)
 machinery(27,19,-29,10,5,8)
 for x in [-25,0,25]:post(x,9,25,4)
 railing((-34,9,26),(32,9,26))
 for i in range(14):
  z=-29+i*3.5;y=23-i*.65
  box((37,y,z),(3,.4,3.3),steel)
  for side in [-1,1]:tube((37+side*1.6,y,z-1.6),(37+side*1.6,y,z+1.6),.17,orange)
  if i<13:
   for side in [-1,1]:
    a=Vector((37+side*1.5,y-1,z-1.7));b=Vector((37+side*1.5,y-1.8,z+1.8))
    tube(a,b,.22,steel)
    tube(a+Y*1.6,b,.12,alloy)
   tube((37,y-1,z),(37,9,z),.20,steel)
 for x,z in [(-10,17),(28,-20),(-33,-17)]:
  for off in [-1.6,1.6]:tank(x+off,9,z,1.2,6)
 for x,z in [(-28,-28),(21,-31)]:
  for j in range(16):boulder((x+random.uniform(-5,5),11+random.uniform(0,.5),z+random.uniform(-3,3)),random.uniform(.6,1.8))
 def conveyor(a,b,w=4):
  a,b=Vector(a),Vector(b);d=(b-a).normalized();u=d.cross(Y).normalized();length=(b-a).length;n=max(1,int(length/4))
  for side in [-1,1]:
   for up in [0,2.5]:tube(a+u*w*side/2+Y*up,b+u*w*side/2+Y*up,.27,steel)
  for j in range(n):
   p=a.lerp(b,j/n);q=a.lerp(b,(j+1)/n)
   prism([p-u*w/2,p+u*w/2,q+u*w/2,q-u*w/2],Y,.2,black)
   for side in [-1,1]:
    tube(p+u*w*side/2,q+u*w*side/2+Y*2.5,.14,orange)
    tube(p+u*w*side/2+Y*2.5,q+u*w*side/2,.14,steel)
   tube(p-u*w/2,p+u*w/2,.15,alloy)
  for t in [0,.3,.7,1]:
   p=a.lerp(b,t)
   for side in [-1,1]:tube(p+u*w*side/2,p+u*w*side/2-Y*5,.32,steel)
 conveyor((-36,25,-29),(32,25,-29),4.5)
 conveyor((30,24,-29),(24,15,-8),4)
 machinery(-36,19,-28,8,7,8)
 machinery(31,19,-29,9,6,8)
 for x,z in [(-8,-24),(15,-22),(-30,5)]:
  for off in [-2,2]:tank(x+off,9,z,1.6,7)
 machinery(-36,9,2,11,6,15)
 machinery(35,9,6,10,8,13)
 for x in [-26,-18,-10]:tank(x,9,26,2.1,6)
 for i in range(30):
  a=random.uniform(0,math.tau);r=random.uniform(.79,.97)
  x=60*r*math.cos(a);z=46*r*math.sin(a)
  if z>25:continue
  boulder((x,19 if r<.91 else 23,z),random.uniform(.7,2.4))
 return finish_rock(ob),port

def clear_housing(root,plane):
 """Nothing of the review layout may stand in the housing's clear volume.
 A loose part whose bounds reach into it (a boulder, a tank) goes whole; the rock,
 displaced after its cut, is pushed back out to the housing's walls and floor,
 which hide where it was flattened. Shaped metres, before the final move."""
 hi=PAD_INNER_M;back=plane.z-PAD_FLOOR_M
 inside=lambda v:abs(v.x-plane.x)<hi and abs(v.y-plane.y)<hi and v.z>back
 for child in root.children:
  if child.type!='MESH' or child.name.startswith('pad/'):continue
  bm=bmesh.new();bm.from_mesh(child.data)
  if child.name.startswith('quarried-asteroid'):
   moved=0
   for v in bm.verts:
    if not inside(v.co):continue
    dx=hi-abs(v.co.x-plane.x);dy=hi-abs(v.co.y-plane.y);dz=v.co.z-back
    m=min(dx,dy,dz)
    if m==dz:v.co.z=back-.5
    elif m==dx:v.co.x=plane.x+math.copysign(hi+.5,v.co.x-plane.x)
    else:v.co.y=plane.y+math.copysign(hi+.5,v.co.y-plane.y)
    moved+=1
   print('CLEAR',child.name,'rock vertices moved',moved,flush=True)
  else:
   seen=set();drop=[]
   for f in bm.faces:
    if f.index in seen:continue
    island=[];stack=[f];seen.add(f.index)
    while stack:
     g=stack.pop();island.append(g)
     for e in g.edges:
      for h in e.link_faces:
       if h.index not in seen:seen.add(h.index);stack.append(h)
    # By bounds, not vertices: a long plated box can have every corner outside
    # the volume and a face straight across it (the Collar's front head).
    vs=[v.co for g in island for v in g.verts]
    lo=[min(v[k] for v in vs) for k in range(3)];up=[max(v[k] for v in vs) for k in range(3)]
    if lo[0]<plane.x+hi and up[0]>plane.x-hi and lo[1]<plane.y+hi and up[1]>plane.y-hi and up[2]>back:drop+=island
   if drop:
    bmesh.ops.delete(bm,geom=drop,context='FACES')
    print('CLEAR',child.name,'faces dropped',len(drop),flush=True)
  bm.to_mesh(child.data);bm.free();child.data.update()
def export(id,rockob,port):
 root=bpy.data.objects.new('refinery-'+id,None);bpy.context.collection.objects.link(root)
 rockob.parent=root
 for name,(verts,faces,uvs) in BATCH.items():
  mesh=bpy.data.meshes.new(name);mesh.from_pydata([tuple(Vector(v)*10) for v in verts],[],faces);mesh.materials.append(MATS[GROUP_MAT[name]]);mesh.update()
  uv=mesh.uv_layers.new(name='surface-metres')
  for face,coords in zip(mesh.polygons,uvs):
   for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=xy
  bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
  ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);ob.parent=root
  if '/cladding-' in name and not FLIGHT:
   bevel=ob.modifiers.new('plate-edge-radius','BEVEL');bevel.width=.2;bevel.segments=1
   n=ob.modifiers.new('weighted-normals','WEIGHTED_NORMAL');n.keep_sharp=True
 marker=bpy.data.objects.new('docking-centre',None);bpy.context.collection.objects.link(marker);marker.location=Vector(port)*10;marker.parent=root
 # Match the approved broad asteroid proportions without introducing transforms
 # that an exported-geometry consumer would need to infer.
 shape=SHAPE[id]
 for child in root.children:
  if child.type=='MESH' and not child.name.startswith('pad/'):
   for v in child.data.vertices:
    v.co.x*=shape[0];v.co.y*=shape[1];v.co.z*=shape[2]
 if FLIGHT:
  clear_housing(root,Vector(port)*10)
  # The pad's housing was built in the shaped frame; the marker is its plane.
  # Move everything so the plane lies on +Z at the sim's figure.
  plane=Vector(port)*10;offset=Vector((-plane.x,-plane.y,APERTURE_PLANE_M-plane.z))
  for child in root.children:
   if child.type=='MESH':
    for v in child.data.vertices:v.co+=offset
  marker.name='aperture-plane';marker.location=Vector((0,0,APERTURE_PLANE_M))
  root['aperture_plane_m']=APERTURE_PLANE_M;root['flight_offset_m']=list(offset)
 else:
  marker.location=Vector(tuple(marker.location[i]*shape[i] for i in range(3)))
 root['metres_per_author_unit']=10;root['design']=id;root['author']='Codex';root['scope']='visual prototype'
 if FLIGHT:
  # Intermediate: `prepare-flight-asset.mjs` encodes it into src/models/.
  flight=OUT.parent.parent/".dream-loop"/"refinery-flight";flight.mkdir(parents=True,exist_ok=True);glb=flight/(id+".glb")
 else:
  bpy.context.preferences.filepaths.save_version=0;bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(id+'.blend')))
  glb=OUT/(id+'.glb')
 # The exporter reads the evaluated depsgraph. Without this, a mesh rewritten
 # through bmesh (`clear_housing`) was intermittently exported as an empty
 # node: the Warren's rock once, the Works' rock once.
 for child in root.children:
  if child.type=='MESH':child.data.update();child.update_tag()
 bpy.context.view_layer.update()
 bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=False,export_apply=True,export_materials='EXPORT',export_extras=True)
 data=glb.read_bytes();jl=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+jl])
 for m in doc['materials']:
  if 'baseColorTexture' in m.get('pbrMetallicRoughness',{}):m['pbrMetallicRoughness']['baseColorFactor']=list(MATS[m['name']].diffuse_color)
 enc=json.dumps(doc,separators=(',',':')).encode();enc+=b' '*((-len(enc))%4);tail=data[20+jl:]
 glb.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(enc)+len(tail))+struct.pack('<II',len(enc),0x4E4F534A)+enc+tail)
 print('EXPORTED',id,glb.stat().st_size,flush=True)
wanted=[a for a in sys.argv[sys.argv.index('--')+1:] if not a.startswith('--')] if '--' in sys.argv else ['o1','o2','o3','o4']
for id,fn in [('o1',warren),('o2',collar),('o3',spar),('o4',works)]:
 if id not in wanted:continue
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);BATCH.clear();GROUP_MAT.clear();random.seed(804+int(id[1]))
 CURRENT.clear();CURRENT['id']=id
 rockob,port=fn();export(id,rockob,port)

