import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('export is a textured, bounded 3D courier with real depth and two engine bays', () => {
  const bytes = readFileSync(new URL('./courier-hull.glb', import.meta.url));
  expect(bytes.toString('ascii',0,4)).toBe('glTF');
  const json = JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  const names = json.meshes.map((m: {name:string})=>m.name);
  expect(names).toContain('canopy-glass');
  expect(names).toContain('engine-port');
  expect(names).toContain('engine-starboard');
  expect(json.images.length).toBeGreaterThan(0);
  expect(json.materials.some((m: {pbrMetallicRoughness?:{baseColorTexture?:unknown}})=>m.pbrMetallicRoughness?.baseColorTexture)).toBe(true);
  const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  let triangles=0;
  for(const mesh of json.meshes) for(const p of mesh.primitives) {
    const a=json.accessors[p.attributes.POSITION];
    for(let i=0;i<3;i++){min[i]=Math.min(min[i],a.min[i]);max[i]=Math.max(max[i],a.max[i]);}
    triangles+=json.accessors[p.indices].count/3;
  }
  const size=max.map((v,i)=>v-min[i]);
  expect(size[0]).toBeGreaterThan(45); expect(size[0]).toBeLessThan(62);
  expect(size[1]).toBeGreaterThan(6); expect(size[1]).toBeLessThan(15);
  expect(size[2]).toBeGreaterThan(50); expect(size[2]).toBeLessThan(68);
  expect(triangles).toBeGreaterThan(20000); expect(triangles).toBeLessThan(500000);
});
