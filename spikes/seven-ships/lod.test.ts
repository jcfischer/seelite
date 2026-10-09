import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';

const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const roles=['interceptor','patrol','explorer','raider','carrier','prospector','dreadnought'];
for(const role of roles)test(`${role}: two smaller, aligned, complete LOD exports`,async()=>{
 const base=`${import.meta.dir}/${role}/`;
 const report=JSON.parse(readFileSync(base+'lod-report.json','utf8'));
 const source=readFileSync(base+'model.glb');
 expect(report.sourceSha256).toBe(createHash('sha256').update(source).digest('hex'));
 let previous=report.full.triangles;
 for(const level of ['full','reduced','outline']) {
  const doc=await io.read(base+(level==='full'?'model.glb':`model-${level}.glb`));
  let triangles=0;
  for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()) {
   const position=primitive.getAttribute('POSITION')!;
   const points=position.getArray()!;
   triangles+=(primitive.getIndices()?.getCount()??position.getCount())/3;
   expect(primitive.getMaterial()).not.toBeNull();
   expect([...primitive.getAttribute('NORMAL')!.getArray()!].every(Number.isFinite)).toBe(true);
   let inside=true;
   for(let i=0;i<points.length;i++)if(!Number.isFinite(points[i])||points[i]<report.full.min[i%3]-.0001||points[i]>report.full.max[i%3]+.0001)inside=false;
   expect(inside).toBe(true);
  }
  if(level!=='full') {
   expect(triangles).toBeGreaterThan(0);
   expect(triangles).toBeLessThan(previous);
   expect(triangles).toBe(report.levels[level].triangles);
   expect(readFileSync(base+`model-${level}.glb`).length).toBeLessThan(source.length);
   const entry=report.levels[level];
   expect(entry.errorMetres).toBeCloseTo(entry.distanceMetres*Math.tan(Math.PI/6)/1800,8);
  }
  previous=triangles;
  if(['explorer','carrier','dreadnought'].includes(role)) {
   const rotor=doc.getRoot().listNodes().find(n=>n.getName()==='habitat-rotor')!;
   expect(rotor).toBeDefined();
   expect(rotor.getExtras().rotationRPM).toBe(role==='explorer'?3:2.5);
   expect(rotor.getExtras().floorRadiusMetres).toBe(role==='explorer'?40:90);
   expect(rotor.listChildren().some(n=>n.getMesh())).toBe(true);
  }
  if(role==='carrier') {
   const cap=doc.getRoot().listMeshes().find(m=>m.getName()==='bastion-aft-bulkhead');
   expect(cap).toBeDefined();
   // Sample the formerly open stern from outside; front-facing triangles must
   // occlude every ray, including at coarse LOD. Merely naming a node fails.
   for(const x of [-30,0,30])for(const y of [-20,0,20]) {
    const ray=new THREE.Ray(new THREE.Vector3(x,y,-300),new THREE.Vector3(0,0,1));let hit=false;
    for(const p of cap!.listPrimitives()) {
     const pos=p.getAttribute('POSITION')!.getArray()!,ids=p.getIndices()?.getArray();
     for(let i=0;i<(ids?.length??pos.length/3);i+=3) {
      const vertices=[0,1,2].map(j=>new THREE.Vector3().fromArray(pos,(ids?.[i+j]??i+j)*3));
      if(ray.intersectTriangle(vertices[0],vertices[1],vertices[2],true,new THREE.Vector3())){hit=true;break;}
     }
    }
    expect(hit).toBe(true);
   }
  }
 }
},30000);
