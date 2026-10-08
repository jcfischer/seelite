"""Blender-authored Coriolis prototype. Run with Blender --background --python.
Geometry is authored in metres on the game's XYZ axes, +Z is the dock.
No internet assets. Seeded construction, material batches, physically open slot.
"""
import bpy, math, random, json, os, struct, sys
from mathutils import Vector
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/spikes/coriolis'
OUT.mkdir(parents=True, exist_ok=True)
FLIGHT = "--flight" in sys.argv
ASSET = "coriolis-industrial-flight" if FLIGHT else "coriolis-industrial"
random.seed(790)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
F = 403.5
BATCH = {}
MATS = {}

def material(name, color, metal=0.5, rough=0.55, emission=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*color,1)
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    texture = OUT / 'industrial-surface.png'
    if texture.exists() and not emission:
        t = m.node_tree.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(str(texture), check_existing=True)
        mix = m.node_tree.nodes.new('ShaderNodeMixRGB')
        mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1
        mix.inputs[2].default_value = (*color,1)
        m.node_tree.links.new(t.outputs['Color'],mix.inputs[1])
        m.node_tree.links.new(mix.outputs[0],p.inputs['Base Color'])
    MATS[name] = m
    BATCH[name] = [[], [], []]
    return name

armor = [material('ceramic-steel-'+str(i),(0.42+i*.055,0.43+i*.05,0.40+i*.045),.45,.66) for i in range(4)]
steel = material('structural-graphite',(.10,.12,.125),.75,.43)
black = material('recess-and-radiator',(.023,.032,.035),.65,.52)
pipe = material('worn-alloy',(.25,.28,.27),.83,.36)
rust = material('oxide-primer',(.20,.075,.032),.4,.79)
yellow = material('ochre-safety-paint',(.68,.38,.07),.25,.65)
letters = material('charcoal-stencil',(.055,.063,.058),.2,.8)
warm = material('habitation-amber', (1,.43,.105),.15,.32,4)
white = material('maintenance-white',(1,.83,.53),.1,.3,5)
red = material('navigation-red',(1,.035,.008),.1,.3,3)

def add_poly(points, mat, uv=None):
    verts, faces, uvs = BATCH[mat]
    offset = len(verts)
    verts.extend([tuple(p) for p in points])
    faces.append(tuple(range(offset, offset+len(points))))
    if uv is None:
        # Per-face planar mapping at a 145m material repeat.
        n = (Vector(points[1])-Vector(points[0])).cross(Vector(points[2])-Vector(points[0]))
        axis=max(range(3),key=lambda i:abs(n[i]))
        ij=[i for i in range(3) if i!=axis]
        uv=[(p[ij[0]]/145,p[ij[1]]/145) for p in points]
    uvs.append(uv)

def prism(poly, n, depth, mat):
    n=Vector(n).normalized()
    pts=[Vector(p) for p in poly]
    if (pts[1]-pts[0]).cross(pts[2]-pts[0]).dot(n)<0: pts.reverse()
    top=[p+n*depth for p in pts]
    add_poly(top,mat)
    add_poly(list(reversed(pts)),mat)
    for i in range(len(pts)):
        j=(i+1)%len(pts)
        add_poly([pts[i],pts[j],top[j],top[i]],mat)

def box(center, size, mat, basis=None):
    c=Vector(center)
    u,v,n = basis or (Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))
    x,y,z=[s/2 for s in size]
    poly=[c+u*a*x+v*b*y-n*z for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    prism(poly,n,2*z,mat)

def beam(a,b,width,depth,mat,normal=None):
    a,b=Vector(a),Vector(b)
    x=(b-a).normalized()
    n=Vector(normal).normalized() if normal is not None else (a+b).normalized()
    n=(n-x*n.dot(x)).normalized()
    y=n.cross(x).normalized()
    box((a+b)/2,((b-a).length,width,depth),mat,(x,y,n))

def tube(a,b,r,mat,sides=8):
    a,b=Vector(a),Vector(b)
    z=(b-a).normalized()
    up=Vector((0,1,0)) if abs(z.y)<.8 else Vector((1,0,0))
    u=z.cross(up).normalized(); v=z.cross(u)
    rings=[[c+r*(u*math.cos(i*2*math.pi/sides)+v*math.sin(i*2*math.pi/sides)) for i in range(sides)] for c in (a,b)]
    for i in range(sides):
        j=(i+1)%sides
        add_poly([rings[0][i],rings[0][j],rings[1][j],rings[1][i]],mat)
    add_poly(list(reversed(rings[0])),mat);add_poly(rings[1],mat)

def clip(poly, a,b,c):
    out=[]
    for i,p in enumerate(poly):
        q=poly[(i+1)%len(poly)]; dp=a*p[0]+b*p[1]-c; dq=a*q[0]+b*q[1]-c
        if dp<=0:out.append(p)
        if (dp<0)!=(dq<0):
            t=dp/(dp-dq);out.append((p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])))
    return out

def square_face(n,u,v,front=False):
    n,u,v=Vector(n),Vector(u),Vector(v)
    basis=(u,v,n)
    def p(x,y,z=0):return n*(F+z)+u*x+v*y
    if front:
        inner=[(60,0),(60,35),(0,35),(-60,35),(-60,0),(-60,-35),(0,-35),(60,-35)]
        outer=[(x*F/(abs(x)+abs(y)),y*F/(abs(x)+abs(y))) for x,y in inner]
        for i in range(8):
            j=(i+1)%8
            add_poly([p(*outer[i]),p(*outer[j]),p(*inner[j]),p(*inner[i])],black)
    else:add_poly([p(F,0),p(0,F),p(-F,0),p(0,-F)],black)
    # Armour districts, with service spines left recessed between them.
    for ix in range(-5,5):
        for iy in range(-6,6):
            x0=ix*79+.65; x1=(ix+1)*79-.65
            y0=iy*62+.65; y1=(iy+1)*62-.65
            cx=(x0+x1)/2;cy=(y0+y1)/2
            if abs(cx)+abs(cy)>F+60:continue
            if front and x0<108 and x1>-108 and y0<77 and y1>-77:
                if cx < -108:x1=min(x1,-108)
                elif cx > 108:x0=max(x0,108)
                elif cy < -77:y1=min(y1,-77)
                elif cy > 77:y0=max(y0,77)
                else:continue
            # Narrow channels run between large armour districts.
            if ix in [-1,0]:
                if ix==-1:x1=-37
                else:x0=37
            if iy==-1:y1=-14
            if iy==0:y0=14
            for band in [-98,98]:
                if y0<band+15 and y1>band-15:
                    if cy<band:y1=min(y1,band-15)
                    else:y0=max(y0,band+15)
            if x1-x0<4 or y1-y0<4:continue
            poly=[(x0,y0),(x1,y0),(x1,y1),(x0,y1)]
            for aa,bb in [(1,1),(1,-1),(-1,1),(-1,-1)]:
                if poly:poly=clip(poly,aa,bb,F-17)
            if len(poly)<3:continue
            m=random.choice(armor)
            depth=random.choice([3,4,5])
            prism([p(x,y,2) for x,y in poly],n,depth,m)
            # Wear belongs to panel edges and fixings, not the entire paint field.
            pcx=sum(q[0] for q in poly)/len(poly);pcy=sum(q[1] for q in poly)/len(poly)
            for i,(x,y) in enumerate(poly):
                bx=x*.95+pcx*.05;by=y*.95+pcy*.05
                box(p(bx,by,depth+2.6),(2.4,2.4,1.2),steel,basis)
                nx,ny=poly[(i+1)%len(poly)]
                for t in [.10,.34,.71,.89]:
                    xx=x+(nx-x)*t;yy=y+(ny-y)*t
                    tt=min(1,t+random.uniform(.02,.09))
                    ex=x+(nx-x)*tt;ey=y+(ny-y)*tt
                    midx=(xx+ex)/2;midy=(yy+ey)/2
                    add_poly([p(xx,yy,depth+2.03),p(ex,ey,depth+2.03),p(midx*.97+pcx*.03,midy*.97+pcy*.03,depth+2.03)],pipe if t<.5 else steel)
            if len(poly)==4 and random.random()<.28:
                # Inspection hatch rather than another full plate grid.
                box(p(cx,cy,depth+3),(19,14,2),steel,basis)
                box(p(cx,cy,depth+4.5),(15,10,1),random.choice(armor),basis)
    # Trunk pipe runs, collars and tie brackets physically on the face.
    segments=[(-330,-88),(88,330)] if front else [(-330,330)]
    for start,end in segments:
        for x in [-14,0,14]:
            tube(p(x,start,6),p(x,end,6),3.0 if x else 4.8,pipe)
            for y in range(int(start)+8,int(end),24):
                tube(p(x,y-1.6,6),p(x,y+1.6,6),4.1 if x else 6,steel)
        for x in [-30,30]:
            tube(p(x,start,6),p(x,end,6),1.8,steel)
        for y in range(int(start)+25,int(end)-20,54):
            side=-1 if (y//54)%2 else 1
            for side2 in [-1,1]:box(p(side2*24,y,3),(14,24,8),steel,basis)
            tube(p(side*24,y-11,8),p(side*24,y+11,8),5.3,pipe,12)
            for yy in [-9,9]:tube(p(side*24,y+yy-1,8),p(side*24,y+yy+1,8),6.2,steel,12)
            box(p(-side*24,y,7),(13,19,11),steel,basis)
            box(p(-side*24,y,13),(9,14,2),pipe,basis)
            for dx in [-3,3]:box(p(-side*24+dx,y,14.5),(1,7,1),warm,basis)
        for y in range(int(start)+15,int(end)-10,49):
            box(p(0,y,2),(43,5,5),steel,basis)
            for x in [-28,28]:
                box(p(x,y,7),(8,15,8),black,basis)
                for dy in [-4,1,6]: box(p(x,y+dy,11.2),(2.3,2.5,.8),warm,basis)
    for y in [-98,98]:
        for delta in [-9,-3,4,10]:
            tube(p(-245,y+delta,5),p(245,y+delta,5),2.3 if delta<0 else 1.5,pipe if delta<0 else steel)
        for x in range(-238,240,29):box(p(x,y,4),(4,19,6),steel,basis)
    # Equatorial maintenance belt, with cabinets rooted into the hull and
    # continuous conduits carried by those cabinets on both sides of the dock.
    for lo,hi in [(-F+25,-112),(112,F-25)]:
        for yy in [-7,0,7]:tube(p(lo,yy,5),p(hi,yy,5),1.5,pipe)
        for x in range(int(lo)+13,int(hi)-6,32):
            box(p(x,0,3),(12,21,8),steel,basis)
            box(p(x,0,8),(8,17,3),pipe,basis)
            box(p(x,4,10),(3,4,1),warm,basis)
            for xx in [-4,4]:tube(p(x+xx,-10,8),p(x+xx,10,8),.65,pipe,6)
    # Small rectangular heat exchangers in the outer service quadrants.
    for x,y in [(-220,58),(220,-58),(-90,240),(90,-240)]:
        if abs(x)+abs(y)+50>F:continue
        box(p(x,y,8),(62,40,9),steel,basis)
        box(p(x,y,13),(55,33,1.5),black,basis)
        for yy in range(-13,15,3):box(p(x,y+yy,14),(52,.85,2),pipe,basis)
    # Thin, supported service galleries across two shoulders.
    for x,y in [(-250,0),(250,0)]:
        box(p(x,y,12),(82,15,3),steel,basis)
        for yy in [-6,6]:
            beam(p(x-40,y+yy,22),p(x+40,y+yy,22),.75,.75,pipe,n)
            for dx in [-38,-19,0,19,38]:tube(p(x+dx,y+yy,12),p(x+dx,y+yy,22),.6,pipe,6)
        for dx in [-28,28]:box(p(x+dx,y,5),(3,12,12),steel,basis)
        box(p(x-38,y,23),(3,3,2),white,basis)

square_face((0,0,1),(1,0,0),(0,1,0),True)
square_face((0,0,-1),(-1,0,0),(0,1,0))
square_face((1,0,0),(0,0,-1),(0,1,0))
square_face((-1,0,0),(0,0,1),(0,1,0))
square_face((0,1,0),(1,0,0),(0,0,-1))
square_face((0,-1,0),(1,0,0),(0,0,1))
# Eight structural plant bays: lowered backplane, deep bulkheads, twin exchangers.
for sx in [-1,1]:
 for sy in [-1,1]:
  for sz in [-1,1]:
    corners=[Vector((sx*F,sy*F,0)),Vector((sx*F,0,sz*F)),Vector((0,sy*F,sz*F))]
    n=Vector((sx,sy,sz)).normalized();c=sum(corners,Vector())/3
    u=(corners[2]-corners[0]).normalized();v=n.cross(u)
    if (corners[0]-c).dot(v)<0:v=-v
    basis=(u,v,n)
    def p(x,y,z):return c+u*x+v*y+n*z
    prism([q-n*20 for q in corners],n,4,black)
    for i,a in enumerate(corners):
        b=corners[(i+1)%3]
        innera=a*.88+c*.12;innerb=b*.88+c*.12
        prism([a,b,innerb,innera],n,4,armor[2])
        add_poly([innera,innerb,innerb-n*16,innera-n*16],steel)
        beam(innera-n*10,innerb-n*10,9,12,pipe,n)
    for side in [-1,1]:
        poly=[p(side*145,-54,-2),p(side*105,-142,-2),p(side*58,-247,-2),p(side*8,-119,-2)]
        prism(poly,n,6,armor[2])
    # Broad paired radiator cassettes with their own raised enclosure.
    for x in [-65,65]:
        box(p(x,38,-7),(119,148,18),steel,basis)
        box(p(x,38,3),(106,136,3),black,basis)
        for xx in [-57,57]:box(p(x+xx,38,7),(5,148,20),pipe,basis)
        for yy in [-34,110]:box(p(x,yy,7),(119,5,20),steel,basis)
        for yy in range(-27,104,4):box(p(x,yy,6),(105,1.3,5),pipe,basis)
        for yy in [-17,91]:
            box(p(x,yy,11),(108,3,4),steel,basis)
            for xx in [-49,49]:box(p(x+xx,yy,14),(3,3,2),yellow,basis)
    for yy in [-83,-110]:
        tube(p(-104,yy,-3),p(104,yy,-3),7,pipe,12)
        for x in range(-96,100,32):
            box(p(x,yy,-10),(9,23,12),steel,basis)
            tube(p(x-3,yy,-3),p(x+3,yy,-3),9,steel,12)
    for x in [-52,-26,0,26,52]:
        box(p(x,-174,-9),(21,91,14),steel,basis)
        tube(p(x,-210,3),p(x,-138,3),8,pipe,12)
        for yy in [-197,-152]:box(p(x,yy,10),(19,5,3),steel,basis)
    for x in [-170,170]:
        box(p(x,89,-4),(23,61,24),armor[1],basis)
        for yy in [67,79,91,103]:box(p(x,yy,9),(14,4,2),black,basis)
    for x in [-125,125]:
        box(p(x,-29,16),(9,167,4),steel,basis)
        for yy in [-101,-49,3,49]:box(p(x,yy,2),(5,5,28),steel,basis)
        tube(p(x,-105,29),p(x,50,29),.8,pipe)
        for yy in [-100,-50,0,48]:tube(p(x,yy,18),p(x,yy,29),.7,pipe)
        for yy in [-78,36]:box(p(x,yy,20),(3,7,2),warm,basis)
# 24 edge girders with strapped sections and riveted joint plates.
verts=[]
for zero in range(3):
 for a in [-1,1]:
  for b in [-1,1]:
   xyz=[a*F,b*F];xyz.insert(zero,0);verts.append(Vector(xyz))
for i,a in enumerate(verts):
 for b in verts[i+1:]:
  if abs((b-a).length-F*math.sqrt(2))>1:continue
  n=(a+b).normalized()
  beam(a+n*3,b+n*3,29,16,steel,n)
  beam(a+n*10,b+n*10,3,2,pipe,n)
  for t in [.07,.28,.49,.70,.93]:
   c=a.lerp(b,t)+n*10
   d=(b-a).normalized();v=n.cross(d)
   box(c,(23,36,4),steel,(d,v,n))
   for xx in [-8,8]:
    for yy in [-9,9]:box(c+d*xx+v*yy+n*3,(2,2,2),pipe,(d,v,n))
# Open display tunnel: all walls strictly outside the 120 x 70 metre aperture.
if not FLIGHT:
    for z in [427,414,398,371,342,307,273]:
     for x in [-66,66]:box((x,0,z),(12,92,5),steel)
     for y in [-41,41]:box((0,y,z),(120,12,5),steel)
    for x in [-63,63]:box((x,0,329),(6,70,198),black)
    for y in [-38,38]:box((0,y,329),(120,6,198),steel)
    box((0,0,228),(120,70,4),black)
    for z in [414,380,342,303,270]:
     for x in [-60.5,60.5]:box((x,22,z),(1,18,2),warm)
     box((0,35.5,z),(95,1,2),white)
     for x in [-40,40]:box((x,-35.25,z),(8,.5,8),warm)
# Flight collar joins the aperture plane to the recessed production bulkhead.
if FLIGHT:
    for x in [-61.5,61.5]:box((x,0,409),(3,70,38),steel)
    for y in [-36.5,36.5]:box((0,y,409),(120,3,38),steel)
# Three bevelled coaming tiers: chamfered outside, rectangular flight clearance.
def octagon(w,h,k,z):
    return [Vector(q) for q in [(-w+k,-h,z),(w-k,-h,z),(w,-h+k,z),(w,h-k,z),(w-k,h,z),(-w+k,h,z),(-w,h-k,z),(-w,-h+k,z)]]
for outer,inner,mat in [((111,79,15,403),(99,68,12,417),steel),((99,68,12,417),(84,54,8,425),pipe),((84,54,8,425),(60,35,0,428),steel)]:
    aa=octagon(*outer);bb=octagon(*inner)
    for i in range(8):
        j=(i+1)%8
        poly=[aa[i],aa[j],bb[j],bb[i]]
        unique=[]
        for q in poly:
            if not unique or (q-unique[-1]).length>.001:unique.append(q)
        if len(unique)>2:add_poly(unique,mat)
for x in [-91,91]:
 for y in [-39,-13,13,39]:box((x,y,421),(9,5,6),steel)
for x in range(-65,70,13):
    add_poly([Vector((x,-65,420)),Vector((x+5,-65,420)),Vector((x+10,-55,425)),Vector((x+5,-55,425))],yellow)
# Dock service enclosure: deep columns, attached equipment, overhead service bridge.
for side in [-1,1]:
 x=side*115
 box((x,0,411),(26,180,26),steel)
 for yy in [-73,-27,31,72]:
  box((x,yy,427),(31,29,10),pipe)
  box((x,yy,433),(25,21,3),steel)
  for dx in [-10,10]:
   for dy in [-8,8]:box((x+dx,yy+dy,435),(2,2,2),pipe)
 for xx in [side*138,side*148]:
  tube((xx,-80,415),(xx,80,415),3.2,pipe)
  for yy in [-72,-20,35,70]:
   box((xx,yy,407),(11,6,13),steel)
   tube((xx,yy-2,415),(xx,yy+2,415),4.6,steel)
 for yy in [-58,52]:
  tube((side*133,yy-12,426),(side*133,yy+12,426),6,pipe,12)
  box((side*126,yy,414),(16,30,18),steel)
  box((side*115,yy,436),(5,9,3),black)
  for dy in [-2,2]:box((side*115,yy+dy,438),(2,2,1),warm)
for yy in [-90,90]:
 box((0,yy,416),(218,22,28),steel)
 for x in [-88,-44,0,44,88]:
  box((x,yy,432),(37,18,6),pipe)
  box((x,yy,436),(31,12,2),steel)
  for dx in [-12,12]:box((x+dx,yy,438),(2,3,2),pipe)
 for yoff in [-7,7]:tube((-102,yy+yoff,442),(102,yy+yoff,442),1.6,pipe)
 for x in [-98,-64,-30,30,64,98]:
  box((x,yy,426),(4,23,29),steel)
box((0,-119,412),(85,35,22),steel)
for x in [-30,-15,0,15,30]:box((x,-119,425),(7,24,3),pipe)
# Four tiny docking signal clusters outside the slot.
for x in [-76,76]:
 for y in [-43,43]:
  box((x,y,431),(7,9,3),black)
  box((x,y,433),(2,5,1),white)
# Roof utility district: several scales of machinery, walking decks and masts.
box((0,F+3,0),(590,6,145),steel)
for x,w,h,z,d in [(-235,56,23,2,54),(-156,74,45,-14,70),(-62,83,59,-8,70),(43,94,54,-20,75),(143,62,30,12,58),(228,64,19,-8,67)]:
 box((x,F+6+h/2,z),(w,h,d),armor[2])
 box((x,F+7.5+h,z),(w+3,3,d+3),steel)
 for xx in [-w/2+4,0,w/2-4]:box((x+xx,F+6+h/2,z+d/2+1),(2,h,2),steel)
 box((x+w*.20,F+17,z+d/2+2),(10,19,3),steel)
 for dz in [-d*.25,d*.25]:
  box((x,F+h+12,z+dz),(w*.7,5,9),pipe)
 for dx in [-w*.3,0,w*.3]:
  box((x+dx,F+7+h*.68,z+d/2+2),(w*.19,9,3),black)
  for dy in [-2,1,4]:box((x+dx,F+7+h*.68+dy,z+d/2+4),(w*.16,.7,1),pipe)
# Supported access gallery along the front roof edge.
box((0,F+13,61),(580,4,21),pipe)
for z in [51,71]:
 tube((-288,F+25,z),(288,F+25,z),.7,pipe)
 tube((-288,F+20,z),(288,F+20,z),.5,pipe)
 for x in range(-280,281,20):tube((x,F+15,z),(x,F+25,z),.6,pipe)
for x in range(-280,281,32):
 box((x,F+8,61),(4,10,19),steel)
 for dz in [-5,0,5]:box((x,F+15.3,61+dz),(28,.6,1),black)
for x in [-181,-16,174]:
 tube((x-11,F+10,-60),(x+11,F+10,-60),8,pipe,12)
 tube((x,F+10,-60),(x,F+10,40),2,pipe)
 for z in [-48,-15,20]:box((x,F+5,z),(8,10,5),steel)
for x,z,h in [(-203,38,79),(-122,-20,115),(109,34,86),(247,8,57)]:
 box((x,F+11,z),(13,20,13),steel)
 tube((x,F+15,z),(x,F+h,z),1,pipe)
 for yy in [h*.45,h*.70,h*.89]:
  tube((x-8,F+yy,z),(x+8,F+yy,z),.55,pipe)
  tube((x-8,F+yy,z),(x-8,F+yy+10,z),.4,pipe)
 box((x,F+h+1,z),(1.8,2,1.8),red)
# Side service booms: deck, truss supports and safety rails rooted in side hull.
for side,y,z,length in [(1,-38,165,116),(1,122,135,53),(-1,17,188,63)]:
 start=side*(F-6);end=side*(F+length)
 box(((start+end)/2,y,z),(abs(end-start),5,31),steel)
 for zz in [z-15,z+15]:
  beam((start,y-26,zz),(end,y-3,zz),2,2,pipe,(0,1,0))
  tube((start,y+12,zz),(end,y+12,zz),.7,pipe)
  tube((start,y+7,zz),(end,y+7,zz),.5,pipe)
  for j in range(7):
   xx=start+(end-start)*j/6
   tube((xx,y+2,zz),(xx,y+12,zz),.7,pipe)
   if j<6:beam((xx,y-20*(1-j/6),zz),(xx+(end-start)/6,y-2,zz),1,1,steel,(0,1,0))
 for j in range(12):box((start+(end-start)*(j+.5)/12,y+2.7,z),(1,.6,28),pipe)
 box((end,y+6,z),(7,18,35),steel)
 for zz in [z-12,z+12]:box((end+side*4,y+8,zz),(1,8,3),white)
 box((start,y-8,z),(8,41,40),steel)
# Station district plate, seated on the front armour before batching.
box((194,46,F+7),(68,56,10),armor[2])
for x in [165,223]:
 for y in [22,70]:box((x,y,F+12.5),(2,2,1),pipe)
# Material batches keep the model renderable instead of one draw per rivet.
objects=[]
for mat,(vertices,faces,uvs) in BATCH.items():
 if not faces:continue
 mesh=bpy.data.meshes.new(mat);mesh.from_pydata(vertices,[],faces);mesh.materials.append(MATS[mat]);mesh.update()
 uv=mesh.uv_layers.new(name='surface-145m')
 for face,coords in zip(mesh.polygons,uvs):
  for index,xy in zip(face.loop_indices,coords):uv.data[index].uv=xy
 ob=bpy.data.objects.new(mat,mesh);bpy.context.collection.objects.link(ob);objects.append(ob)
 # Small edge radii catch light; preserve microscopic light geometry unmodified.
 if mat not in [warm,white,red,letters]:
  mod=ob.modifiers.new('machined-edge-bevel','BEVEL');mod.width=.45;mod.segments=1
  mod.affect='EDGES'
  mod=ob.modifiers.new('weighted-flat-panels','WEIGHTED_NORMAL');mod.keep_sharp=True
# Stencilled station district on its own bolted repair panel.
for text,loc,size in [('03',(168,26,F+12.1),42),('CORIOLIS',(-104,-125,F+9),12),('PORT 01',(-42,82,F+9),7)]:
 curve=bpy.data.curves.new('stencil-'+text,'FONT');curve.body=text;curve.size=size;curve.extrude=.02
 ob=bpy.data.objects.new('stencil-'+text,curve);bpy.context.collection.objects.link(ob);ob.location=loc;curve.materials.append(MATS[letters])
 bpy.context.view_layer.objects.active=ob;ob.select_set(True);bpy.ops.object.convert(target='MESH');ob.select_set(False)
# Retain editable authoring source outside the web-served directory.
bpy.ops.file.pack_all()
if not FLIGHT:bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'spikes/coriolis/coriolis-industrial.blend'))
FLIGHT_OUT = ROOT / '.dream-loop'
FLIGHT_OUT.mkdir(exist_ok=True)
glb=(FLIGHT_OUT if FLIGHT else OUT)/(ASSET+'.glb')
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=False,export_apply=True,export_materials='EXPORT',export_extras=True)
# Blender's glTF exporter keeps the image but drops the constant multiplier
# on this node graph. Carry that authored linear tint into the standard PBR
# factor explicitly, so every independent GLB viewer gets the same materials.
data=glb.read_bytes(); jlen=struct.unpack_from('<I',data,12)[0]
doc=json.loads(data[20:20+jlen])
for mat in doc.get('materials',[]):
    if 'baseColorTexture' in mat.get('pbrMetallicRoughness',{}):
        mat['pbrMetallicRoughness']['baseColorFactor']=list(MATS[mat['name']].diffuse_color)
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
tail=data[20+jlen:]
glb.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+tail)
print('CORIOLIS_EXPORTED',str(glb))
