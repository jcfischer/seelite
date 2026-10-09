/**
 * Meshes and triangles under some objects, counted from their geometry: an
 * index's corners, or the vertices of an unindexed buffer, over three. An
 * instance is counted once, as `renderer.info` would not; this is a census of
 * what was built, not of what a frame draws.
 *
 * Plain JavaScript with no imports, so a page can load it through the dev
 * server (`import("/scripts/lib/mesh-stats.mjs")`) inside `page.evaluate`.
 * `skip` leaves out a mesh and everything under it.
 *
 * @param {Iterable<{ traverse(fn: (o: any) => void): void }>} objects
 * @param {(mesh: any) => boolean} [skip]
 * @returns {{ meshes: number, triangles: number }}
 */
export function meshStats(objects, skip = () => false) {
	let meshes = 0;
	let triangles = 0;
	for (const object of objects)
		object.traverse((o) => {
			if (!o.isMesh || skip(o)) return;
			meshes++;
			const geo = o.geometry;
			triangles +=
				(geo.index ? geo.index.count : geo.attributes.position.count) / 3;
		});
	return { meshes, triangles };
}
