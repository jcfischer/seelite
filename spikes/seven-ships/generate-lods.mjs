/** Offline form of node 812 / PR 828's position-welded Meshopt levels.
 * All coordinates remain study metres, Y up, +Z forward. Full assets untouched.
 * Run `npm ci --prefix spikes/seven-ships`, then this script from any directory.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const root = fileURLToPath(new URL('./', import.meta.url));
export const roles = ['interceptor','patrol','explorer','raider','carrier','prospector','dreadnought'];
const requested = process.argv.slice(2);
if (requested.some(role => !roles.includes(role))) throw Error('Unknown ship role');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const frame = { fovDeg: 60, heightPx: 1800, errorPixels: 0.5 };

function measure(doc) {
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION').getArray();
    triangles += (p.getIndices()?.getCount() ?? pos.length / 3) / 3;
    for (let i=0;i<pos.length;i++) { const axis=i%3; min[axis]=Math.min(min[axis],pos[i]); max[axis]=Math.max(max[axis],pos[i]); }
  }
  return { triangles, meshes: doc.getRoot().listMeshes().length, min, max };
}

for (const role of requested.length ? requested : roles) {
  const source = await readFile(`${root}${role}/model.glb`);
  const original = await io.readBinary(source);
  // This pipeline's exported vertices already contain the metre transform.
  // Reject a future transformed asset rather than silently use local-space error.
  for (const node of original.getRoot().listNodes()) {
    if (node.getTranslation().some(v=>v!==0) || node.getScale().some(v=>v!==1) ||
        node.getRotation().some((v,i)=>v!==(i===3?1:0))) throw Error(`${role}: transformed source node`);
  }
  const full = measure(original);
  const centre = full.min.map((v,i)=>(v+full.max[i])/2);
  let reachMetres = 0;
  for (const mesh of original.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const pos=primitive.getAttribute('POSITION').getArray();
    for(let i=0;i<pos.length;i+=3) reachMetres=Math.max(reachMetres,Math.hypot(pos[i]-centre[0],pos[i+1]-centre[1],pos[i+2]-centre[2]));
  }
  const report = { role, sourceSha256: createHash('sha256').update(source).digest('hex'),
    method: 'PR 828 / node 812: position weld, Meshopt ErrorAbsolute + Prune, 30 degree normals',
    frame, reachMetres, centreMetres: centre, full: {...full, bytes: source.length}, levels: {} };
  for (const [level,radii] of [['reduced',40],['outline',400]]) {
    const distanceMetres = radii * reachMetres;
    const errorMetres = frame.errorPixels * 2 * distanceMetres * Math.tan(frame.fovDeg*Math.PI/360) / frame.heightPx;
    const doc = await io.readBinary(source);
    const buffer = doc.getRoot().listBuffers()[0];
    for(const mesh of [...doc.getRoot().listMeshes()]) {
      for(const primitive of [...mesh.listPrimitives()]) {
        if(primitive.getMode()!==4 || primitive.listTargets().length) throw Error('Unsupported non-triangle or morph source');
        const pos = primitive.getAttribute('POSITION').getArray();
        const indices = primitive.getIndices()?.getArray() ?? Uint32Array.from({length:pos.length/3},(_,i)=>i);
        const remap = MeshoptSimplifier.generatePositionRemap(pos,3);
        const welded = Uint32Array.from(indices,i=>remap[i]);
        const [kept] = MeshoptSimplifier.simplify(welded,pos,3,0,errorMetres,['ErrorAbsolute','Prune']);
        if(!kept.length) {mesh.removePrimitive(primitive);primitive.dispose();continue;}
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position',new THREE.BufferAttribute(pos,3));
        const uv=primitive.getAttribute('TEXCOORD_0');
        if(uv) geom.setAttribute('uv',new THREE.BufferAttribute(uv.getArray(),2));
        geom.setIndex(new THREE.BufferAttribute(kept,1));
        const smooth=toCreasedNormals(geom,Math.PI/6);
        for(const semantic of primitive.listSemantics()) primitive.setAttribute(semantic,null);
        for(const [attribute,semantic,type] of [['position','POSITION','VEC3'],['normal','NORMAL','VEC3'],['uv','TEXCOORD_0','VEC2']]) {
          const data=smooth.getAttribute(attribute);
          if(data) primitive.setAttribute(semantic,doc.createAccessor().setType(type).setBuffer(buffer).setArray(new Float32Array(data.array)));
        }
        primitive.setIndices(null);
        smooth.dispose();geom.dispose();
      }
      if(!mesh.listPrimitives().length) {
        for(const node of doc.getRoot().listNodes()) if(node.getMesh()===mesh) node.setMesh(null);
        mesh.dispose();
      }
    }
    // Keep named empty habitat parents and their physical metadata, even if a
    // tiny child disappears. Weld final vertices including normals and UVs.
    await doc.transform(weld(),prune({keepLeaves:true}));
    const result=measure(doc);
    if(result.triangles>=full.triangles || result.triangles<=0) throw Error(`${role}/${level}: no useful reduction`);
    const bytes=await io.writeBinary(doc);
    await writeFile(`${root}${role}/model-${level}.glb`,bytes);
    report.levels[level]={...result,bytes:bytes.length,distanceRadii:radii,distanceMetres,errorMetres};
  }
  if(report.levels.outline.triangles>=report.levels.reduced.triangles) throw Error(`${role}: outline must be simpler`);
  await writeFile(`${root}${role}/lod-report.json`,JSON.stringify(report,null,2)+'\n');
  console.log(role,JSON.stringify({full:full.triangles,reduced:report.levels.reduced.triangles,outline:report.levels.outline.triangles}));
}
