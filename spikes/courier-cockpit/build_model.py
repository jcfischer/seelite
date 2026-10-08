"""Courier cockpit study. Blender --background --python spikes/courier-cockpit/build_model.py.
Original geometry in pilot-local metres: +X right, +Y up, -Z forward.
Pilot offset in courier-A hull coordinates is (0, 4.7, -12.5) m.
This study fits the equipment, not a certified watertight pressure vessel.
"""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/spikes/courier-cockpit'
random.seed(792)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
BATCH = {}
MATS = {}

def material(name, color, metal=.6, rough=.48, emit=0, textured=True):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    if emit:
        p.inputs['Emission Color'].default_value=(*color,1)
        p.inputs['Emission Strength'].default_value=emit
    elif textured:
        t=m.node_tree.nodes.new('ShaderNodeTexImage')
        t.image=bpy.data.images.load(str(OUT/'steel-wear.png'),check_existing=True)
        # Keep tint in glTF baseColorFactor; material export supports image * constant.
        mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY'
        mix.inputs[0].default_value=1;mix.inputs[2].default_value=(*color,1)
        m.node_tree.links.new(t.outputs['Color'],mix.inputs[1])
        m.node_tree.links.new(mix.outputs[0],p.inputs['Base Color'])
    MATS[name]=m;BATCH[name]=[[],[],[]]
    return name

steel=material('weathered-blue-steel',(.29,.36,.40),.65,.42)
dark=material('graphite-housings',(.23,.27,.30),.6,.43)
alloy=material('exposed-machined-edges',(.32,.34,.33),.82,.32)
black=material('rubber-and-recess',(.012,.018,.02),.12,.72,textured=False)
ochre=material('service-ochre',(.68,.32,.045),.35,.52)
red=material('guarded-red',(.4,.032,.02),.3,.45)
warm=material('amber-work-lights',(1,.48,.12),.15,.28,4)
cyan=material('cyan-indicators',(.04,.6,.8),.1,.35,2)

def poly(points, mat, uv=None):
    vs,fs,uvs=BATCH[mat];i=len(vs)
    vs.extend([tuple(p) for p in points]);fs.append(tuple(range(i,i+len(points))))
    if uv is None:
        n=(Vector(points[1])-Vector(points[0])).cross(Vector(points[2])-Vector(points[0]))
        axis=max(range(3),key=lambda i:abs(n[i]));ij=[i for i in range(3) if i!=axis]
        uv=[(p[ij[0]]*1.5,p[ij[1]]*1.5) for p in points]
    uvs.append(uv)

def basis(a=0):
    return Vector((1,0,0)),Vector((0,math.cos(a),math.sin(a))),Vector((0,-math.sin(a),math.cos(a)))

def box(c, size, mat, a=0):
    c=Vector(c);u,v,n=basis(a);w,h,d=size
    pts=[c+u*x*w/2+v*y*h/2+n*z*d/2 for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)]:poly([pts[i] for i in f],mat)

def tube(a,b,r,mat,sides=10):
    a,b=Vector(a),Vector(b);n=(b-a).normalized();up=Vector((0,1,0))
    if abs(n.dot(up))>.9:up=Vector((1,0,0))
    u=n.cross(up).normalized();v=n.cross(u).normalized()
    rings=[[p+r*(u*math.cos(i*math.tau/sides)+v*math.sin(i*math.tau/sides)) for i in range(sides)] for p in (a,b)]
    for i in range(sides):
        j=(i+1)%sides;poly([rings[0][i],rings[0][j],rings[1][j],rings[1][i]],mat)
    poly(list(reversed(rings[0])),mat);poly(rings[1],mat)

def path(points,r,mat):
    for a,b in zip(points,points[1:]):tube(a,b,r,mat)

def plane(name,c,w,h,a):
    u,v,n=basis(a);c=Vector(c)
    pts=[c-u*w/2-v*h/2,c+u*w/2-v*h/2,c+u*w/2+v*h/2,c-u*w/2+v*h/2]
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata([(p.x,-p.z,p.y) for p in pts],[],[(0,1,2,3)])
    uv=mesh.uv_layers.new()
    for li,co in enumerate([(0,0),(1,0),(1,1),(0,1)]):uv.data[li].uv=co
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    obj.data.materials.append(MATS[black]);return obj

A=-.62
def panel(name,c,w,h):
    c=Vector(c);u,v,n=basis(A)
    def p(x,y,z=0):return c+u*x+v*y+n*z
    box(c,(w,h,.22),dark,A)
    box(p(0,0,.12),(w-.045,h-.045,.035),alloy,A)
    box(p(0,0,.146),(w-.085,h-.085,.03),steel,A)
    # Recessed functional screen with bolted raised bezel.
    sw,sh=w-.26,h-.24
    box(p(0,0,.167),(sw+.045,sh+.045,.035),black,A)
    plane('screen-'+name,p(0,0,.19),sw,sh,A)
    for x in [-w/2+.06,w/2-.06]:
        for y in [-h/2+.06,h/2-.06,0]:
            tube(p(x,y,.15),p(x,y,.182),.024,alloy,8)
            box(p(x,y,.186),(.022,.004,.004),black,A)
    return p

# Three reachable equipment pods, lower than the eye line.
radar=panel('radar',(0,-.87,-2.35),1.80,1.20)
flight=panel('flight',(-1.53,-.81,-2.42),1.32,.72)
systems=panel('systems',(-1.53,-1.37,-2.15),1.32,.47)
target=panel('target',(1.53,-.91,-2.4),1.35,.96)

# Recessed tray below the instrument faces and support rails behind them.
box((0,-1.47,-2.50),(4.7,.30,1.05),dark)
for x in [-2.4,-.91,.91,2.4]:
    path([(x,-1.7,-1.25),(x,-1.18,-2.25),(x,-.94,-3.2)],.065,alloy)
    path([(x+.08,-1.7,-1.25),(x+.08,-1.19,-2.25),(x+.08,-.95,-3.2)],.04,black)
for x in [-1.8,-.62,.62,1.8]:
    box((x,-.50,-3.07),(.75,.06,.26),steel)
    for k in range(8):box((x-.27+k*.078,-.46,-3.06),(.034,.012,.19),black)

# Keypad, rotary controls, guarded switches and legends (legends supplied in viewer).
kp=Vector((1.55,-1.46,-1.98));u,v,n=basis(A)
box(kp,(1.32,.48,.19),dark,A)
for row in range(3):
    for col in range(5):
        c=kp+u*(-.43+col*.18)+v*(-.13+row*.13)+n*.11
        box(c,(.135,.088,.045),alloy if col==4 else black,A)
        if row==2 and col in [0,4]:box(c+n*.026,(.085,.04,.007),warm,A)
for x in [-.91,.91,-2.32,2.32]:
    for i in range(5):
        c=Vector((x,-.68-i*.145,-2.45+i*.10))
        box(c,(.11,.1,.07),black,A)
        box(c+Vector((0,.015,.04)),(.06,.04,.014),warm if i%3!=2 else alloy,A)
for x in [-2.02,-1.79,-1.56,-1.33,-1.1]:
    c=Vector((x,-1.7,-1.69))
    box(c,(.16,.22,.10),dark,A)
    tube(c+Vector((0,.03,.05)),c+Vector((0,.10,.14)),.018,alloy)
box((-.7,-1.5,-1.55),(.14,.23,.07),red,A)

# Lower equipment under the glass sill. Screen meshes share that exact transform.
for name,(vs,fs,uvs) in BATCH.items():
    BATCH[name][0]=[(x,y-.91,z) for x,y,z in vs]
for obj in bpy.data.objects:
    if obj.name.startswith('screen-'):obj.location.z-=.91

# Enclosed service cowling: no stars through gaps between equipment pods.
box((0,-2.18,-2.63),(5.15,1.6,.16),dark,A)
box((0,-2.1,-3.18),(5.2,.25,.42),steel)
for s in [-1,1]:
    # Shallow side cheek plates reach from consoles to the canopy gasket.
    poly([(s*2.05,-1.25,-3.5),(s*3.1,-.94,-3.4),(s*3.0,-1.46,.65),(s*2.2,-1.8,.65)],steel)
    poly([(s*2.2,-1.8,.65),(s*3.0,-1.46,.65),(s*3.1,-2.2,.65),(s*2.2,-2.2,.65)],dark)
    for z in [-2.7,-2,-1.3,-.6]:
        box((s*2.57,-1.30,z),(.5,.045,.45),steel)
        for k in range(6):box((s*(2.38+k*.065),-1.27,z),(.025,.018,.25),black)
    # A narrower longitudinal structural hoop follows the upper blister.
    support=[(s*3.05,-1.0,-4.2),(s*2.5,-.78,-3.4),(s*2.4,.18,-1.8),(s*1.7,.72,-.3),(s*.95,.82,.7)]
    path(support,.105,dark)
    path([(x-s*.04,y+.02,z+.045) for x,y,z in support],.023,alloy)
    for i in range(5):
        p=Vector(support[1]).lerp(Vector(support[2]),i/4)
        tube(p+Vector((0,0,.07)),p+Vector((0,0,.1)),.025,alloy,8)
    p=Vector(support[1]).lerp(Vector(support[2]),.42)
    box(p+Vector((0,0,.09)),(.075,.2,.025),warm)

# Sidewall structure within the courier canopy footprint, with ribbed ducts.
for s in [-1,1]:
    box((s*2.7,-1.68,-.5),(.7,.55,4.2),dark)
    for z in [-2,-1.35,-.7,0,.7]:
        box((s*2.67,-1.37,z),(.64,.075,.5),steel)
        for x in [s*2.46,s*2.88]:tube((x,-1.33,z-.16),(x,-1.31,z-.16),.025,alloy,8)
    for k in range(2):
        x=s*(2.45+k*.12)
        path([(x,-1.35,1),(x,-1.32,-1.1),(x,-1.12,-2.3),(s*1.7,-1.1,-4.2)],.042,black)
        for j in range(32):
            z=.9-j*.10;tube((x,-1.34,z),(x,-1.34,z+.035),.05,alloy if j%8==0 else dark)
    # Low sloping perimeter: drawn along the courier A glass edge, not a flat bridge.
    edge=[(s*3.55,-.72,.8),(s*3.4,-.72,-1),(s*3.0,-.95,-3),(s*2.25,-1.8,-5.5)]
    path(edge,.095,dark)
    path([(x,y+.08,z) for x,y,z in edge],.022,alloy)
    path([(x-s*.08,y+.03,z) for x,y,z in edge],.035,black)
    # Oblique supports sweep overhead toward the rear of the blister.
    rib=[(s*2.65,-1.08,-3.8),(s*3.05,-.55,-2.55),(s*3.27,.05,-1.1),(s*3.15,.45,.4),(s*2.7,.64,1.6)]
    path(rib,.095,steel)
    path([(x-s*.06,y+.035,z) for x,y,z in rib],.028,alloy)
    for t in [.15,.4,.65,.9]:
        p=Vector(rib[0]).lerp(Vector(rib[2]),t)
        tube(p+Vector((0,0,.06)),p+Vector((0,0,.10)),.032,alloy,8)
    # Warm service lights below window, never a huge roof bar.
    box((s*2.4,-.86,-3.2),(.31,.11,.15),black)
    box((s*2.4,-.82,-3.10),(.22,.047,.013),warm)
    box((s*.92,-2.78,-1.5),(.46,.12,.16),black)
    box((s*.92,-2.72,-1.40),(.32,.035,.014),warm)

# Access plates and visible fixings break up the lower service enclosure.
for s in [-1,1]:
    for i in range(4):
        x=s*(.36+i*.49)
        box((x,-2.24,-1.08),(.44,.035,.38),steel)
        box((x,-2.21,-1.08),(.32,.018,.25),dark)
        for dx in [-.17,.17]:tube((x+dx,-2.205,-1.19),(x+dx,-2.18,-1.19),.018,alloy,8)
    # Reachable rotary selectors with concentric machined collars.
    for j in range(2):
        c=Vector((s*(1.25+j*.42),-2.12,-1.18))
        tube(c,c+Vector((0,.10,.10)),.095,alloy,20)
        tube(c+Vector((0,.08,.08)),c+Vector((0,.19,.19)),.071,black,16)
        box(c+Vector((0,.2,.2)),(.012,.017,.033),ochre)
    for z in [-2.8,-2.4,-2.0,-1.6]:
        box((s*2.12,-1.86,z),(.13,.09,.19),dark)
        box((s*2.12,-1.8,z),(.075,.018,.1),warm if z==-2.4 else black)

# Floor and seat give orbit inspection a complete, compact occupied volume.
box((0,-3.02,.25),(4.2,.15,5.1),dark)
for x in [-1.6,-.8,0,.8,1.6]:
    for z in [-1.4,-.55,.3,1.15,2]:box((x,-2.93,z),(.72,.035,.72),steel)
box((0,-1.58,.42),(.85,.24,.9),black)
box((0,-1.10,1.00),(.86,1.04,.19),black)
box((0,-.43,1.02),(.55,.30,.17),black)
for x in [-.49,.49]:
    box((x,-1.18,.35),(.13,.13,.85),dark)
    tube((x,-2.13,.4),(x,-1.65,.4),.052,alloy)

# Deterministic chips on outer panel rims: geometry catches grazing highlights.
for center,w,h in [((0,-.87,-2.35),1.62,1.20),((-1.53,-.81,-2.42),1.32,.72),((1.53,-.91,-2.4),1.35,.96)]:
    c=Vector(center);c.y-=.91;u,v,n=basis(A)
    for i in range(75):
        x=random.uniform(-w/2+.04,w/2-.04)
        y=random.choice([-1,1])*(h/2-random.uniform(.025,.09))
        box(c+u*x+v*y+n*.167,(random.uniform(.005,.024),.003,.002),alloy,A)

for name,(verts,faces,uvs) in BATCH.items():
    if not faces:continue
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata([(x,-z,y) for x,y,z in verts],[],faces);mesh.update()
    uv=mesh.uv_layers.new(name='surface-metres')
    for f,coords in zip(mesh.polygons,uvs):
        for li,co in zip(f.loop_indices,coords):uv.data[li].uv=co
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    obj.data.materials.append(MATS[name])
    if name not in [warm,cyan,black]:
        mod=obj.modifiers.new('Machined edge bevels','BEVEL');mod.width=.009;mod.segments=2
        mod.affect='EDGES'
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        weighted=obj.modifiers.new('Weighted face normals','WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=weighted.name)

for image in bpy.data.images:
    if image.source=='FILE':image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'spikes/courier-cockpit/courier-cockpit.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'courier-cockpit.glb'),export_format='GLB',export_yup=True,export_apply=True)
print('Cockpit exported',len(bpy.data.objects),'objects')
