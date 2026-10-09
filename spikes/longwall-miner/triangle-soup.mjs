// The export's triangles as an order-free soup (node #815, sage round 8), so
// the shipped file can be compared with the approved export itself rather
// than with a document `dedup` and `reorder` have already rewritten. Each
// triangle is its three corners' every attribute, as the smallest of its
// three rotations, so its winding is kept and a degenerate one with two equal
// corners still has one form; each primitive's triangles are
// sorted, and the primitive is keyed by the node that draws it, its place in
// that node's mesh and its material's properties. By node and not by mesh:
// `dedup` lets the four anchors' identical parts share one mesh, which is the
// same drawing under another mesh's name. By properties and not by name: it
// also folds a material into an identical one (`pale-steel-1` into
// `pale-steel-0`), which draws the same. A texture is keyed by its slot only;
// `prepare-flight-asset.mjs` checks its pixels.
const material = m => m ? JSON.stringify([
 m.getBaseColorFactor(), m.getEmissiveFactor(), m.getMetallicFactor(), m.getRoughnessFactor(),
 m.getAlphaMode(), m.getAlphaCutoff(), m.getDoubleSided(),
 ['getBaseColorTexture', 'getEmissiveTexture', 'getMetallicRoughnessTexture', 'getNormalTexture', 'getOcclusionTexture'].map(slot => Boolean(m[slot]())),
 m.listExtensions().map(e => e.extensionName).sort(),
]) : '';

export function triangleSoup(doc) {
 const soup = {};
 for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  mesh.listPrimitives().forEach((primitive, p) => {
   const semantics = primitive.listSemantics().sort();
   const arrays = semantics.map(s => [primitive.getAttribute(s).getElementSize(), primitive.getAttribute(s).getArray()]);
   const corner = i => arrays.map(([size, array]) => Array.from(array.subarray(i * size, (i + 1) * size)).join(',')).join('|');
   const index = primitive.getIndices()?.getArray() ?? Array.from({length: primitive.getAttribute('POSITION').getCount()}, (_, i) => i);
   const triangles = [];
   for (let t = 0; t < index.length; t += 3) {
    const corners = [corner(index[t]), corner(index[t + 1]), corner(index[t + 2])];
    const rotations = [0, 1, 2].map(start => [0, 1, 2].map(c => corners[(start + c) % 3]).join(' / '));
    triangles.push(rotations.sort()[0]);
   }
   soup[`${node.getName()}#${p}:${material(primitive.getMaterial())}:${semantics.join(',')}`] = triangles.sort();
  });
 }
 return soup;
}
