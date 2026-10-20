/**
 * An asteroid field's drawn form (node #968): two `BatchedMesh`es and one
 * `Points` draw, the scheme #950 D3 measured on the GPU lane.
 *
 * - **Points** hold every rock below level 2 (and every rock while no mesh
 *   shapes are installed), one draw, 1.5 px.
 * - **Near batch** holds level 0 and casts into the shadow map on quality high
 *   only. **Far batch** holds levels 1–2 and never casts.
 *
 * The root is placed against the camera's own star-centric position each frame
 * (`update`), turned by the plan's inertial frame, and every rock is placed in
 * that frame at the current clock: drift from `rockLocal`, spin from
 * `rockSpinAngle` about `spinAxis`. Three's batching carries each instance's
 * rotation into the surface normal (`beginnormal_vertex` multiplies by
 * `batchingMatrix`); `tests/field-draw.test.ts` binds that chunk, because the
 * station rock's `ROCK_SURFACE` does not and a spinning rock would keep fixed
 * shading under it (#950 D8).
 *
 * Construction is cheap and holds no shapes. `install` adds the shapes in
 * slices the caller yields between, and only then do the batches join the
 * scene; until it resolves the field is points alone.
 */
import * as THREE from "three";
import { type FieldPlan, type Rock, rockSpinAngle } from "./asteroid-field";
import {
	type FieldLevel,
	POINT_LEVEL,
	type QualitySide,
	fieldCameraLocal,
	fieldOffsetFromCamera,
	rockArchetype,
	selectFieldLevels,
	spinQuat,
} from "./field-lod";
import type { RockShapes } from "./asteroid-model";
import { NEAR_FAR_KM } from "./units";
import type { Vec3 } from "./vec3";

/** The field is not drawn at all past this distance from its centre: the near
 *  camera's far plane, less the field's own reach. A field further off is
 *  sub-pixel, and the far layers do not carry it. */
export const FIELD_DRAW_KM = NEAR_FAR_KM - 100;

/** What `update` needs from the frame. */
export interface FieldFrame {
	gameTime: number;
	/** The camera, star-centric km. */
	camera: Vec3;
	pxPerRadian: number;
	quality: QualitySide;
	/** The shadow gate's answer; level 0 casts only when this and `high`. */
	shadows: boolean;
}

interface Batch {
	mesh: THREE.BatchedMesh;
	/** `geometry[archetype][slot]` — the id `addGeometry` returned. */
	geometry: number[][];
	/** One instance per rock, hidden until placed. */
	instance: number[];
}

/** Which draw a rock is in right now: 0 near batch, 1 far batch, −1 neither. */
type Where = -1 | 0 | 1;

export class FieldDraw {
	readonly root = new THREE.Group();
	readonly levels: Int8Array;
	private readonly pos: Float32Array;
	private readonly pointPos: Float32Array;
	private readonly pointGeometry = new THREE.BufferGeometry();
	private readonly pointMaterial = new THREE.PointsMaterial({
		color: 0x8a7e6c,
		size: 1.5,
		sizeAttenuation: false,
	});
	private readonly points: THREE.Points;
	private readonly where: Int8Array;
	private near?: Batch;
	private far?: Batch;
	private disposed = false;
	/** Level counts as of the last `update`, L0/L1/L2/point. */
	readonly perLevel: [number, number, number, number] = [0, 0, 0, 0];
	/** Which shapes the batches hold: `none` while points are all there is. */
	shapes: "none" | "authored" | "standin" = "none";

	private readonly matrix = new THREE.Matrix4();
	private readonly q = new THREE.Quaternion();
	private readonly p = new THREE.Vector3();
	private readonly s = new THREE.Vector3();
	private readonly spin = { x: 0, y: 0, z: 0, w: 1 };

	constructor(
		readonly plan: FieldPlan,
		readonly rocks: readonly Rock[],
	) {
		this.root.name = `asteroid-field:${plan.id}`;
		this.levels = new Int8Array(rocks.length).fill(POINT_LEVEL);
		this.pos = new Float32Array(rocks.length * 3);
		this.pointPos = new Float32Array(rocks.length * 3);
		this.where = new Int8Array(rocks.length).fill(-1);
		this.pointGeometry.setAttribute(
			"position",
			new THREE.BufferAttribute(this.pointPos, 3),
		);
		this.points = new THREE.Points(this.pointGeometry, this.pointMaterial);
		this.points.name = "asteroid-points";
		this.points.frustumCulled = false;
		this.root.add(this.points);
		this.root.visible = false;
	}

	/** Both batches are in the scene and their rocks are drawn. */
	get meshesInstalled(): boolean {
		return this.near !== undefined && this.far !== undefined;
	}
	get batches(): readonly THREE.BatchedMesh[] {
		return this.near && this.far ? [this.near.mesh, this.far.mesh] : [];
	}

	/**
	 * Build the two batches from `shapes`, one step per yield, and join them to
	 * the root only when every step has run. `live` is checked after each
	 * yield: a jump that disposed this field ends the work and frees what it
	 * had made. `warm` gets each finished batch before it is shown, so the
	 * caller can compile its program and upload its buffers off a visible frame.
	 */
	async install(
		shapes: RockShapes,
		kind: "authored" | "standin",
		yieldSlice: () => Promise<void>,
		live: () => boolean,
		warm: (mesh: THREE.BatchedMesh) => Promise<void>,
	): Promise<boolean> {
		if (this.meshesInstalled || this.disposed) return this.meshesInstalled;
		const made: THREE.BatchedMesh[] = [];
		const build = async (
			slots: readonly number[],
			cast: boolean,
		): Promise<Batch | undefined> => {
			let vertices = 0;
			let indices = 0;
			for (const levels of shapes.levels)
				for (const slot of slots) {
					vertices += levels[slot].getAttribute("position").count;
					indices += levels[slot].index?.count ?? 0;
				}
			const mesh = new THREE.BatchedMesh(
				this.rocks.length,
				vertices,
				indices,
				shapes.material,
			);
			made.push(mesh);
			mesh.frustumCulled = false;
			mesh.perObjectFrustumCulled = true;
			mesh.sortObjects = false;
			mesh.castShadow = cast;
			mesh.visible = false;
			const geometry: number[][] = [];
			for (const levels of shapes.levels) {
				geometry.push(slots.map((slot) => mesh.addGeometry(levels[slot])));
				await yieldSlice();
				if (!live()) return undefined;
			}
			const instance = this.rocks.map(() => {
				const id = mesh.addInstance(geometry[0][0]);
				mesh.setVisibleAt(id, false);
				return id;
			});
			return { mesh, geometry, instance };
		};
		let near: Batch | undefined;
		let far: Batch | undefined;
		try {
			near = await build([0], false);
			far = near && (await build([1, 2], false));
			// Each batch is compiled and its buffers uploaded while hidden.
			for (const batch of [near, far])
				if (batch && live()) await warm(batch.mesh);
		} catch (error) {
			for (const mesh of made) mesh.dispose();
			throw error;
		}
		if (!near || !far || !live() || this.disposed) {
			for (const mesh of made) mesh.dispose();
			return false;
		}
		this.near = near;
		this.far = far;
		this.shapes = kind;
		for (const batch of [near, far]) {
			batch.mesh.visible = true;
			this.root.add(batch.mesh);
		}
		return true;
	}

	/** Place the field for this frame; see the module docstring. */
	update(frame: FieldFrame): void {
		if (this.disposed) return;
		const offset = fieldOffsetFromCamera(
			this.plan,
			frame.gameTime,
			frame.camera,
		);
		if (Math.hypot(offset.x, offset.y, offset.z) > FIELD_DRAW_KM) {
			this.root.visible = false;
			return;
		}
		this.root.visible = true;
		this.root.position.set(offset.x, offset.y, offset.z);
		const r = this.plan.rotation;
		this.root.quaternion.set(r.x, r.y, r.z, r.w);
		this.root.updateMatrixWorld(true);

		const meshes = this.meshesInstalled;
		const np = selectFieldLevels(
			this.rocks,
			frame.gameTime,
			fieldCameraLocal(this.plan, frame.gameTime, frame.camera),
			frame.pxPerRadian,
			frame.quality,
			this.levels,
			this.pos,
			this.pointPos,
			meshes,
		);
		const perLevel = this.perLevel;
		perLevel.fill(0);
		if (this.near && this.far) {
			this.near.mesh.castShadow = frame.shadows && frame.quality === "high";
			for (let i = 0; i < this.rocks.length; i++) {
				const level = this.levels[i] as FieldLevel;
				perLevel[level]++;
				const want: Where = level === POINT_LEVEL ? -1 : level === 0 ? 0 : 1;
				const was = this.where[i];
				if (was !== want && was !== -1) {
					const old = was === 0 ? this.near : this.far;
					old.mesh.setVisibleAt(old.instance[i], false);
				}
				this.where[i] = want;
				if (want === -1) continue;
				const rock = this.rocks[i];
				const batch = want === 0 ? this.near : this.far;
				this.p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
				const sq = spinQuat(
					rock,
					rockSpinAngle(rock, frame.gameTime),
					this.spin,
				);
				this.q.set(sq.x, sq.y, sq.z, sq.w);
				this.s.setScalar(rock.radiusKm);
				this.matrix.compose(this.p, this.q, this.s);
				const id = batch.instance[i];
				batch.mesh.setGeometryIdAt(
					id,
					batch.geometry[rockArchetype(rock)][want === 0 ? 0 : level - 1],
				);
				batch.mesh.setMatrixAt(id, this.matrix);
				if (was !== want) batch.mesh.setVisibleAt(id, true);
			}
		} else {
			perLevel[POINT_LEVEL] = this.rocks.length;
		}
		this.pointGeometry.setDrawRange(0, np);
		(
			this.pointGeometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
		this.points.visible = np > 0;
	}

	/** Release the batches and points. Shared shapes and material are not
	 *  touched: their geometry was copied into the batch buffers. */
	dispose(): void {
		this.disposed = true;
		this.root.removeFromParent();
		this.near?.mesh.dispose();
		this.far?.mesh.dispose();
		this.near = this.far = undefined;
		this.pointGeometry.dispose();
		this.pointMaterial.dispose();
		this.root.clear();
	}
}
