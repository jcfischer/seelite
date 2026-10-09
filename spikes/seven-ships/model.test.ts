import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const roles=['interceptor','patrol','explorer','raider','carrier','prospector','dreadnought'];
for(const role of roles) test(`${role}: exported geometry, textures and measured bounds`,()=>{
 const b=readFileSync(join(import.meta.dir,role,'model.glb'));
 expect(b.toString('ascii',0,4)).toBe('glTF');
 expect(b.readUInt32LE(8)).toBe(b.length);
 const doc=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
 expect(doc.images.length).toBeGreaterThan(0);
 expect(doc.images.every((i:any)=>i.bufferView!==undefined&&!i.uri)).toBe(true);
 expect(doc.meshes.length).toBeGreaterThan(8);
 const positions=doc.meshes.flatMap((m:any)=>m.primitives.map((p:any)=>doc.accessors[p.attributes.POSITION]));
 expect(positions.every((a:any)=>a.count>0&&a.min.every(Number.isFinite)&&a.max.every(Number.isFinite))).toBe(true);
 const report=JSON.parse(readFileSync(join(import.meta.dir,role,'model-report.json'),'utf8'));
 expect(report.triangles).toBeGreaterThan(20000);
 expect(report.boundsMetres.every((n:number)=>n>0&&Number.isFinite(n))).toBe(true);
 if(role==='carrier'||role==='dreadnought'){
  expect(report.floorRadiusMetres).toBe(90);
  expect(report.rotationRPM).toBe(2.5);
  expect(report.gravityG).toBeCloseTo(0.629012,5);
  expect(report.rotorClearanceMetres).toBeGreaterThan(0.5);
  // Independent check on exported triangles: a radial envelope proves clearance
  // for every rotor angle, including fixed faces spanning the axial interval.
  const binaryStart=28+b.readUInt32LE(12);
  const accessor=(id:number)=>{
   const a=doc.accessors[id],v=doc.bufferViews[a.bufferView];
   const offset=binaryStart+(v.byteOffset??0)+(a.byteOffset??0);
   const size=a.componentType===5125||a.componentType===5126?4:a.componentType===5123?2:1;
   const width=a.type==='VEC3'?3:1;
   return (index:number,component=0)=>{
    const at=offset+index*(v.byteStride??size*width)+component*size;
    return a.componentType===5126?b.readFloatLE(at):size===4?b.readUInt32LE(at):size===2?b.readUInt16LE(at):b.readUInt8(at);
   };
  };
  const rotorMeshes=new Set(doc.nodes.filter((n:any)=>n.name?.startsWith('rotor:')).map((n:any)=>n.mesh));
  let radialMin=Infinity,zMin=Infinity,zMax=-Infinity;
  for(const id of rotorMeshes as Set<number>)for(const primitive of doc.meshes[id].primitives){
   const a=doc.accessors[primitive.attributes.POSITION],pos=accessor(primitive.attributes.POSITION);
   for(let i=0;i<a.count;i++){radialMin=Math.min(radialMin,Math.hypot(pos(i,0),pos(i,1)));zMin=Math.min(zMin,pos(i,2));zMax=Math.max(zMax,pos(i,2));}
  }
  let fixedRadius=0;
  doc.meshes.forEach((mesh:any,id:number)=>{if(rotorMeshes.has(id))return;
   for(const primitive of mesh.primitives){
    const pos=accessor(primitive.attributes.POSITION),indices=accessor(primitive.indices),count=doc.accessors[primitive.indices].count;
    for(let i=0;i<count;i+=3){
     const ids=[indices(i),indices(i+1),indices(i+2)],zs=ids.map(j=>pos(j,2));
     if(Math.min(...zs)<=zMax&&Math.max(...zs)>=zMin)
      for(const j of ids)fixedRadius=Math.max(fixedRadius,Math.hypot(pos(j,0),pos(j,1)));
    }
   }
  });
  expect(Number.isFinite(radialMin)).toBe(true);
  expect(radialMin-fixedRadius).toBeGreaterThan(0.5);
  expect(doc.nodes.some((n:any)=>n.name==='habitat-rotor')).toBe(true);
 }
 if(role==='explorer'){
  expect(report.floorRadiusMetres).toBe(40);
  expect(report.gravityG).toBeCloseTo(.4026,3);
  expect(report.boundsMetres[0]).toBeGreaterThanOrEqual(83.8);
  expect(report.boundsMetres[0]).toBeLessThan(86);
  expect(doc.nodes.some((n:any)=>n.name==='habitat-rotor')).toBe(true);
 }
});
