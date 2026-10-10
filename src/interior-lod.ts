import * as THREE from "three";
import { selectLod, type LodLevel, type LodMode } from "./interior-lod-policy";
export type LodRecord = {
	full: { min: number[]; max: number[]; triangles: number };
	levels: { file: string; maxRemovedDiameter: number; triangles: number }[];
};
type Instance = {
	id?: string;
	transform: THREE.Matrix4;
	bounds: THREE.Box3;
	scale: number;
	level: LodLevel;
};
type Part = { mesh: THREE.InstancedMesh; local: THREE.Matrix4 };
type Bucket = {
	name: string;
	parent: THREE.Group;
	record: LodRecord;
	instances: Instance[];
	parts: Part[][];
	world: THREE.Matrix4;
};
/** One bucket per module/parent, with three instanced draw sets. No per-fitting draw calls. */
export class InteriorLods {
	private buckets = new Map<string, Bucket>();
	mode: LodMode = "auto";
	private dirty = true;
	private lastCamera = new THREE.Matrix4();
	private lastProjection = new THREE.Matrix4();
	private lastHeight = -1;
	constructor(
		private assets: Map<string, THREE.Group>,
		private records: Record<string, LodRecord>,
		private material: (m: THREE.Material) => THREE.Material,
	) {}
	add(
		name: string,
		transform: THREE.Matrix4,
		parent: THREE.Group,
		id?: string,
	) {
		const key = name + "/" + parent.uuid,
			record = this.records[name];
		if (!this.buckets.has(key))
			this.buckets.set(key, {
				name,
				parent,
				record,
				instances: [],
				parts: [[], [], []],
				world: new THREE.Matrix4(),
			});
		const scale = new THREE.Vector3().setFromMatrixScale(transform);
		this.buckets.get(key)!.instances.push({
			id,
			transform,
			bounds: new THREE.Box3(
				new THREE.Vector3(...record.full.min),
				new THREE.Vector3(...record.full.max),
			).applyMatrix4(transform),
			scale: Math.max(scale.x, scale.y, scale.z),
			level: 0,
		});
	}
	flush() {
		for (const _ of this.flushSteps()) {
			/* synchronous review/full-set path */
		}
	}
	*flushSteps(): Generator<void> {
		for (const b of this.buckets.values()) {
			if (b.parts[0].length) continue;
			const files = [`${b.name}.glb`, ...b.record.levels.map((l) => l.file)];
			for (let level = 0; level < 3; level++) {
				if (level > 0 && b.record.levels[level - 1].maxRemovedDiameter === 0)
					continue;
				const asset = this.assets.get(files[level])!;
				asset.updateMatrixWorld(true);
				const sources: THREE.Mesh[] = [];
				asset.traverse((o) => {
					if ((o as THREE.Mesh).isMesh) sources.push(o as THREE.Mesh);
				});
				for (const o of sources) {
					const source = o as THREE.Mesh;
					const mesh = new THREE.InstancedMesh(
						source.geometry,
						this.material(source.material as THREE.Material),
						b.instances.length,
					);
					mesh.name = `interior-lod-${b.name}-${level}`;
					mesh.userData.instanceIds = b.instances.map((i) => i.id);
					mesh.castShadow = b.name !== "panel";
					mesh.receiveShadow = true;
					// A fixed conservative bound covers any later subset of these instances.
					// Union cached source bounds, never scan all source vertices for
					// every instance. Covers every future LOD subset conservatively.
					if (!source.geometry.boundingBox)
						source.geometry.computeBoundingBox();
					const bounds = new THREE.Box3();
					const partBounds = new THREE.Box3();
					const matrix = new THREE.Matrix4();
					b.instances.forEach((i, n) => {
						matrix.multiplyMatrices(i.transform, o.matrixWorld);
						mesh.setMatrixAt(n, matrix);
						// Bound the float32 transform the GPU actually receives.
						mesh.getMatrixAt(n, matrix);
						bounds.union(
							partBounds
								.copy(source.geometry.boundingBox!)
								.applyMatrix4(matrix),
						);
					});
					mesh.boundingBox = bounds;
					mesh.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
					mesh.count = 0;
					mesh.visible = false;
					b.parent.add(mesh);
					b.parts[level].push({ mesh, local: o.matrixWorld.clone() });
					yield;
				}
				if (!b.parts[level].length)
					throw Error(`Empty LOD mesh batch: ${files[level]}`);
			}
		}
		this.dirty = true;
	}
	setMode(mode: LodMode) {
		this.mode = mode;
		this.dirty = true;
	}
	update(camera: THREE.PerspectiveCamera, height: number) {
		camera.updateMatrixWorld();
		let parentChanged = false;
		for (const b of this.buckets.values()) {
			b.parent.updateWorldMatrix(true, false);
			if (!b.world.equals(b.parent.matrixWorld)) parentChanged = true;
		}
		if (
			!this.dirty &&
			!parentChanged &&
			this.lastHeight === height &&
			this.lastCamera.equals(camera.matrixWorld) &&
			this.lastProjection.equals(camera.projectionMatrix)
		)
			return false;
		this.lastCamera.copy(camera.matrixWorld);
		this.lastProjection.copy(camera.projectionMatrix);
		this.lastHeight = height;
		const focal = (height * camera.projectionMatrix.elements[5]) / 2;
		const viewBounds = new THREE.Box3();
		const view = new THREE.Matrix4();
		const scale = new THREE.Vector3();
		let changed = this.dirty;
		for (const b of this.buckets.values()) {
			b.world.copy(b.parent.matrixWorld);
			view.multiplyMatrices(camera.matrixWorldInverse, b.world);
			const parentScale = Math.max(
				...scale.setFromMatrixScale(b.world).toArray(),
			);
			for (const i of b.instances) {
				viewBounds.copy(i.bounds).applyMatrix4(view);
				const depth = -viewBounds.max.z;
				// Off-axis perspective magnifies detail too. Bound the projection
				// derivative over the entire fitting, including its nearest surface.
				const lateral = Math.hypot(
					Math.max(Math.abs(viewBounds.min.x), Math.abs(viewBounds.max.x)),
					Math.max(Math.abs(viewBounds.min.y), Math.abs(viewBounds.max.y)),
				);
				const effectiveDistance =
					depth > 0 ? depth / Math.hypot(1, lateral / depth) : 0;
				const next =
					this.mode === "auto"
						? selectLod(
								i.level,
								effectiveDistance,
								focal,
								b.record.levels.map(
									(l) => l.maxRemovedDiameter * i.scale * parentScale,
								),
							)
						: (Number(this.mode) as LodLevel);
				// Modules with no removable hardware stay in their one full-detail draw set.
				const level =
					b.record.levels[next === 2 ? 1 : 0].maxRemovedDiameter === 0
						? 0
						: next;
				if (level !== i.level) {
					i.level = level;
					changed = true;
				}
			}
		}
		if (!changed) return false;
		const matrix = new THREE.Matrix4();
		for (const b of this.buckets.values()) {
			for (const parts of b.parts)
				for (const p of parts) {
					p.mesh.count = 0;
					p.mesh.userData.instanceIds = [];
				}
			for (const i of b.instances)
				for (const p of b.parts[i.level]) {
					p.mesh.userData.instanceIds.push(i.id);
					p.mesh.setMatrixAt(
						p.mesh.count++,
						matrix.multiplyMatrices(i.transform, p.local),
					);
				}
			for (const parts of b.parts)
				for (const p of parts) {
					p.mesh.visible = p.mesh.count > 0;
					p.mesh.instanceMatrix.needsUpdate = true;
				}
		}
		this.dirty = false;
		return true;
	}
	stats() {
		const levels = [0, 0, 0];
		let triangles = 0,
			fullTriangles = 0;
		for (const b of this.buckets.values()) {
			let visible = true;
			for (let p: THREE.Object3D | null = b.parent; p; p = p.parent)
				visible &&= p.visible;
			if (!visible) continue;
			for (const i of b.instances) {
				levels[i.level]++;
				fullTriangles += b.record.full.triangles;
				triangles +=
					i.level === 0
						? b.record.full.triangles
						: b.record.levels[i.level - 1].triangles;
			}
		}
		return { mode: this.mode, levels, triangles, fullTriangles };
	}
	clear() {
		for (const b of this.buckets.values())
			for (const parts of b.parts)
				for (const p of parts) {
					p.mesh.removeFromParent();
					p.mesh.dispose();
				}
		this.buckets.clear();
		this.dirty = true;
	}
}
