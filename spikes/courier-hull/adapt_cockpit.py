"""Derive the exterior-visible interior from the authored courier cockpit.
Source mesh is preserved unchanged under source/; filtering works on copies.
"""
import bpy, bmesh, math, json, hashlib
from mathutils import Vector

def append_adapted_cockpit(out, materials):
    source=out/'source/courier-cockpit.blend'
    with bpy.data.libraries.load(str(source),link=False) as (available,loaded):
        loaded.objects=[name for name in available.objects if not name.startswith(('label-','key-'))]
    report={'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'source':'source/courier-cockpit.blend','original_triangles':0,'adapted_triangles':0,
            'kept_components':0,'removed_components':0,'objects':[]}
    handled=set()
    def local(v):
        # Authoring file uses Blender Z-up: recover its documented pilot frame.
        return Vector((v.x,v.z,-v.y))
    def fit(v,seat=False):
        # Proper rotation from source -Z forward to hull +Z forward, then fit.
        return Vector((-v.x*(1 if seat else .70),v.y*.85+4.066+(0 if seat else .60),-v.z*.85+10.557))
    for obj in loaded.objects:
        if obj is None or obj.type!='MESH':continue
        bpy.context.collection.objects.link(obj)
        original_name=obj.name
        report['original_triangles']+=sum(len(p.vertices)-2 for p in obj.data.polygons)
        for mat in obj.data.materials:
            if mat in handled:continue
            handled.add(mat)
            original=mat.name.split('.')[0]
            shader=mat.node_tree.nodes.get('Principled BSDF')
            multiply=next((n for n in mat.node_tree.nodes if n.type=='MIX_RGB'),None)
            color=multiply.inputs[2].default_value[:] if multiply else shader.inputs['Base Color'].default_value[:]
            mat.diffuse_color=color
            mat.name='cockpit-'+original
            materials[mat.name]=mat
        bm=bmesh.new();bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
        if original_name.startswith('screen-'):
            for v in bm.verts:v.co=fit(local(obj.matrix_world@v.co))
        else:
            unseen=set(bm.verts);remove=[]
            while unseen:
                first=unseen.pop();component=[first];stack=[first]
                while stack:
                    for edge in stack.pop().link_edges:
                        for other in edge.verts:
                            if other in unseen:unseen.remove(other);component.append(other);stack.append(other)
                points=[local(obj.matrix_world@v.co) for v in component]
                lo=Vector(tuple(min(v[i] for v in points) for i in range(3)))
                hi=Vector(tuple(max(v[i] for v in points) for i in range(3)))
                seat=max(abs(lo.x),abs(hi.x))<.72 and lo.z>-.25 and hi.z<1.5 and lo.y>-2.3 and hi.y<-.1
                # Remove the original floor, roof/outer canopy, and sub-75mm
                # ornament. Keep complete components so filtering opens no boxes.
                discard=not seat and (hi.y< -2.85 or hi.y>-.80 or max(abs(lo.x),abs(hi.x))>3.22 or (hi-lo).length<.075)
                if discard:
                    remove.extend(component);report['removed_components']+=1
                else:
                    report['kept_components']+=1
                    for v,p in zip(component,points):v.co=fit(p,seat)
            bmesh.ops.delete(bm,geom=remove,context='VERTS')
            bmesh.ops.dissolve_limit(bm,angle_limit=math.radians(3),verts=list(bm.verts),edges=list(bm.edges),delimit={'UV'})
        bm.to_mesh(obj.data);bm.free();obj.matrix_world.identity();obj.data.update()
        if not obj.data.polygons:
            bpy.data.objects.remove(obj,do_unlink=True);continue
        obj.name='interior-'+original_name
        report['adapted_triangles']+=sum(len(p.vertices)-2 for p in obj.data.polygons)
        report['objects'].append(obj.name)
    (out/'cockpit-adaptation.json').write_text(json.dumps(report,indent=2)+'\n')
    print('COCKPIT_ADAPTED',json.dumps(report))
