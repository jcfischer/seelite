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
 if(role==='explorer'){
  expect(report.floorRadiusMetres).toBe(40);
  expect(report.gravityG).toBeCloseTo(.4026,3);
  expect(report.boundsMetres[0]).toBeGreaterThanOrEqual(83.8);
  expect(report.boundsMetres[0]).toBeLessThan(86);
  expect(doc.nodes.some((n:any)=>n.name==='habitat-rotor')).toBe(true);
 }
});
