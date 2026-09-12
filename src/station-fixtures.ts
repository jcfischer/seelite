/**
 * The macro structure a station carries at 2 km (#202): the scale between a
 * 19 m plate and a kilometre of hull, which every form lacked.
 *
 * The vocabulary is the ISS's and the Nostromo's, which is the principal's
 * steer for this node: **truss** beams of square-section members with
 * diagonals, **radiator** arrays of thin white panels on a spine, **tank
 * racks** of cylinders in saddles, **pipe runs** with elbows, a **mast** with
 * a dish, a **docking collar** with approach lamps round a slot, and
 * **beacons** — clock-driven strobes on the ends of things. Each is a
 * primitive here; where each goes on a form is a short declaration per
 * selected form at the bottom, in the form's own kilometres, and nothing else
 * in the file knows what a Coriolis is.
 *
 * **Three rules, the same three the greebles are under** (`station-greebles.ts`).
 * No fixture may be a station's farthest vertex — `tests/station-visuals.test.ts`
 * holds the reach identical at every detail level and `tests/station-finish.test.ts`
 * holds it inside the form's declaration under every finish. Nothing stands in
 * the docking corridor, which the corridor row sweeps. And a fixture is
 * **mounted**: a declared base point is cast back along its normal onto the
 * structure that was built, so a truss on the Warren's rock sits on the rock
 * and not on the radius somebody wrote down.
 *
 * **Instanced, not assembled.** A truss is a hundred members and a pipe run a
 * dozen; as `Mesh`es that is a draw call each. Every member of every fixture
 * on a station is one instance of a unit box or a unit tube in a material's
 * pool, so the lattice is four or five draw calls however much of it there
 * is. What stands beside the pools is drawn on its own — a docking collar,
 * a dish per mast, the approach lamps and each beacon — a dozen-odd meshes
 * on a form, which is the count that moves when a declaration does.
 *
 * **The pools are tagged `full` and the group `reduced`.** A 12 m member is
 * a quarter of a pixel at the forty radii where `reduced` begins, so the
 * lattice drawn out to four hundred radii was a hundred thousand sub-pixel
 * triangles of vertex work (sage, round 5); the beacons, the collar and the
 * dishes stay in the `reduced` band with the aperture frame, because a
 * lamp is what reads at range. The outline never depended on either: no
 * fixture is a form's farthest vertex, and the reach test holds it.
 *
 * The group is tagged `reduced`: this is 2 km structure and belongs in the
 * same band as the aperture frame and the strobes, not with the 40 m clutter
 * that goes at `full`.
 */

import * as THREE from "three";
import { glowMaterial, glowPoints, steadyGlowMaterial } from "./station-glow";
import { shared } from "./gpu-teardown";
import { revolve } from "./loft";
import { castOntoStructure } from "./station-greebles";
import { STATION_GEOMETRY, type StationType } from "./station";
import type { StationFormId, StationFixture } from "./station-mesh";
import type { StationDetailLevel, StationFixtureKind } from "./station-visuals";
import { STATION_VISUALS } from "./station-visuals";

/** The unit box and the unit tube every member is an instance of. Built once
 *  and marked shared, so a jump's teardown frees the instance data and leaves
 *  these standing (#187). The tube is built along +Y by three and turned onto
 *  +Z here, so a member's length is its local z whichever it is. */
const UNIT_BOX = shared(new THREE.BoxGeometry(1, 1, 1));
const UNIT_TUBE = (() => {
	const tube = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
	tube.rotateX(Math.PI / 2);
	return shared(tube);
})();

/**
 * Unpainted structure, a white radiator, a dull tank, a dark pipe.
 *
 * Grey rather than the hull colour, for `station-greebles.ts`'s reason: §7's
 * colour cue is the hull, and a truss painted in it dilutes the one signal a
 * role is read by at range. Shared across every station and never mutated.
 */
const MATERIALS = {
	structure: shared(
		new THREE.MeshStandardMaterial({
			color: 0x6f7d88,
			roughness: 0.78,
			metalness: 0.42,
		}),
	),
	radiator: shared(
		new THREE.MeshStandardMaterial({
			color: 0xd8dde2,
			roughness: 0.88,
			metalness: 0.08,
		}),
	),
	tank: shared(
		new THREE.MeshStandardMaterial({
			color: 0x9da5ad,
			roughness: 0.62,
			metalness: 0.5,
		}),
	),
	pipe: shared(
		new THREE.MeshStandardMaterial({
			color: 0x4f5a64,
			roughness: 0.7,
			metalness: 0.55,
		}),
	),
} as const;

type MaterialName = keyof typeof MATERIALS;

/**
 * One station's instance pools: a list of matrices per (geometry, material),
 * emitted as one `InstancedMesh` each when the fixtures are done.
 */
export class Pools {
	private readonly lists = new Map<
		string,
		{
			geometry: THREE.BufferGeometry;
			material: THREE.Material;
			/** The material's name, kept beside it rather than parsed back out
			 *  of the cache key when the pool is emitted. */
			name: MaterialName;
			matrices: THREE.Matrix4[];
		}
	>();

	add(
		geometry: THREE.BufferGeometry,
		material: MaterialName,
		matrix: THREE.Matrix4,
	) {
		const key = `${geometry.uuid}:${material}`;
		let list = this.lists.get(key);
		if (!list) {
			list = {
				geometry,
				material: MATERIALS[material],
				name: material,
				matrices: [],
			};
			this.lists.set(key, list);
		}
		list.matrices.push(matrix);
	}

	/** How many members the pools hold, for a receipt. */
	get size() {
		let n = 0;
		for (const list of this.lists.values()) n += list.matrices.length;
		return n;
	}

	/** A member between two points: a box or a tube of the given thickness. */
	member(
		geometry: THREE.BufferGeometry,
		material: MaterialName,
		from: THREE.Vector3,
		to: THREE.Vector3,
		thickness: number,
	) {
		const direction = to.clone().sub(from);
		const length = direction.length();
		if (length <= 0) return;
		const orientation = new THREE.Quaternion().setFromUnitVectors(
			UNIT_Z,
			direction.divideScalar(length),
		);
		this.add(
			geometry,
			material,
			new THREE.Matrix4().compose(
				from.clone().add(to).multiplyScalar(0.5),
				orientation,
				new THREE.Vector3(thickness, thickness, length),
			),
		);
	}

	/**
	 * One `InstancedMesh` per pool into `into`, named `${prefix}-${material}`.
	 * `detail` tags each with the level it belongs to — `full` for a form's
	 * fixtures, whose members are sub-pixel past forty radii; none for the
	 * Assembly's own structure, which is the station and never hides.
	 */
	emit(into: THREE.Group, prefix: string, detail?: StationDetailLevel) {
		for (const list of this.lists.values()) {
			const mesh = new THREE.InstancedMesh(
				list.geometry,
				list.material,
				list.matrices.length,
			);
			list.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
			mesh.instanceMatrix.needsUpdate = true;
			mesh.name = `${prefix}-${list.name}`;
			if (detail) mesh.userData.minDetail = detail;
			into.add(mesh);
		}
	}
}

const UNIT_Z = new THREE.Vector3(0, 0, 1);

/**
 * A frame perpendicular to `direction`: two unit vectors spanning its plane,
 * the first as close to `upHint` as the direction allows.
 *
 * **Right-handed, and it matters.** `side × up = axis`, so
 * `makeBasis(side, up, axis)` is a rotation. The first build took
 * `side = axis × up`, which is the same three vectors with one sign flipped
 * — a reflection — and `Quaternion.setFromRotationMatrix` on a reflection
 * does not fail, it answers wrongly: for the shipyard's spine (+X, up +Y) it
 * returned the identity, so every radiator panel lay flat along the spine
 * instead of standing across it and the bank drew as one overlapping slab.
 * Sage read it off the matrix; `tests/station-finish.test.ts` reads every
 * panel's thin axis back against its spine now.
 */
function frameAround(direction: THREE.Vector3, upHint: THREE.Vector3) {
	const axis = direction.clone().normalize();
	let up = upHint.clone().sub(axis.clone().multiplyScalar(upHint.dot(axis)));
	if (up.lengthSq() < 1e-8)
		up = new THREE.Vector3(1, 0, 0).sub(axis.clone().multiplyScalar(axis.x));
	up.normalize();
	const side = new THREE.Vector3().crossVectors(up, axis).normalize();
	return { axis, up, side };
}

/**
 * A lattice beam from `a` to `b`: four longerons on a square section, a
 * frame at every bay, one diagonal per face per bay alternating in direction.
 * The ISS's integrated truss, at whatever width a form asks for.
 */
export function truss(
	pools: Pools,
	a: THREE.Vector3,
	b: THREE.Vector3,
	widthKm: number,
	upHint: THREE.Vector3,
) {
	const { axis, up, side } = frameAround(b.clone().sub(a), upHint);
	const length = a.distanceTo(b);
	const half = widthKm / 2;
	const member = widthKm * 0.14;
	const corners = [
		up.clone().multiplyScalar(half).addScaledVector(side, half),
		up.clone().multiplyScalar(half).addScaledVector(side, -half),
		up.clone().multiplyScalar(-half).addScaledVector(side, -half),
		up.clone().multiplyScalar(-half).addScaledVector(side, half),
	];
	for (const corner of corners)
		pools.member(
			UNIT_BOX,
			"structure",
			a.clone().add(corner),
			b.clone().add(corner),
			member,
		);
	// "Panel", not "bay": a bay is a slot role's interior (`CONTEXT.md`),
	// and a lattice's repeating unit is its panel.
	const panels = Math.max(1, Math.round(length / widthKm));
	const at = (panel: number, corner: number) =>
		a
			.clone()
			.addScaledVector(axis, (panel / panels) * length)
			.add(corners[corner]);
	for (let panel = 0; panel <= panels; panel++)
		for (let corner = 0; corner < 4; corner++)
			pools.member(
				UNIT_BOX,
				"structure",
				at(panel, corner),
				at(panel, (corner + 1) % 4),
				member * 0.8,
			);
	for (let panel = 0; panel < panels; panel++)
		for (let face = 0; face < 4; face++) {
			const next = (face + 1) % 4;
			// Alternating so the diagonals zig-zag down each face rather than
			// all leaning one way, which reads as a slant in the whole beam.
			const flip = (panel + face) % 2 === 0;
			pools.member(
				UNIT_BOX,
				"structure",
				at(panel, flip ? face : next),
				at(panel + 1, flip ? next : face),
				member * 0.7,
			);
		}
}

/**
 * A row of thin panels standing on a spine, each perpendicular to the spine.
 * The ISS's radiators, stacked rather than unfolded so the array reads as a
 * bank of fins from every side.
 */
export function radiatorArray(
	pools: Pools,
	{
		origin,
		along,
		up,
		count,
		panelWidthKm,
		panelHeightKm,
	}: {
		/** Where the first panel stands. */
		origin: THREE.Vector3;
		/** The spine's direction; the panels are spaced along it. */
		along: THREE.Vector3;
		/** Which way the panels rise off the surface. */
		up: THREE.Vector3;
		count: number;
		/** A panel's extent across the spine. */
		panelWidthKm: number;
		/** A panel's extent along `up`. */
		panelHeightKm: number;
	},
) {
	const { axis, up: rise, side } = frameAround(along, up);
	const pitch = panelWidthKm * 0.55;
	const spineLength = pitch * (count - 1) + panelWidthKm * 0.4;
	const spineStart = origin
		.clone()
		.addScaledVector(axis, -panelWidthKm * 0.2)
		.addScaledVector(rise, panelHeightKm * 0.06);
	pools.member(
		UNIT_BOX,
		"structure",
		spineStart,
		spineStart.clone().addScaledVector(axis, spineLength),
		panelHeightKm * 0.12,
	);
	for (let i = 0; i < count; i++) {
		const centre = origin
			.clone()
			.addScaledVector(axis, i * pitch)
			.addScaledVector(rise, panelHeightKm * 0.5 + panelHeightKm * 0.06);
		const orientation = new THREE.Quaternion().setFromRotationMatrix(
			new THREE.Matrix4().makeBasis(side, rise, axis),
		);
		pools.add(
			UNIT_BOX,
			"radiator",
			new THREE.Matrix4().compose(
				centre,
				orientation,
				new THREE.Vector3(panelWidthKm, panelHeightKm, panelHeightKm * 0.035),
			),
		);
	}
}

/** Cylinders side by side in two saddles, resting on the surface. */
export function tankRack(
	pools: Pools,
	{
		origin,
		along,
		up,
		count,
		radiusKm,
		lengthKm,
	}: {
		/** The rack's centre on the surface. */
		origin: THREE.Vector3;
		/** The tanks' long axis. */
		along: THREE.Vector3;
		/** Which way the tanks stand off the surface. */
		up: THREE.Vector3;
		count: number;
		/** One tank's radius. */
		radiusKm: number;
		/** One tank's length. */
		lengthKm: number;
	},
) {
	const { axis, up: rise, side } = frameAround(along, up);
	const pitch = radiusKm * 2.25;
	for (let i = 0; i < count; i++) {
		const centre = origin
			.clone()
			.addScaledVector(side, (i - (count - 1) / 2) * pitch)
			.addScaledVector(rise, radiusKm * 0.95);
		pools.member(
			UNIT_TUBE,
			"tank",
			centre.clone().addScaledVector(axis, -lengthKm / 2),
			centre.clone().addScaledVector(axis, lengthKm / 2),
			radiusKm * 2,
		);
	}
	const span = pitch * (count - 1) + radiusKm * 2.6;
	for (const s of [-0.3, 0.3]) {
		const mid = origin
			.clone()
			.addScaledVector(axis, s * lengthKm)
			.addScaledVector(rise, radiusKm * 0.3);
		pools.member(
			UNIT_BOX,
			"structure",
			mid.clone().addScaledVector(side, -span / 2),
			mid.clone().addScaledVector(side, span / 2),
			radiusKm * 0.35,
		);
	}
}

/**
 * A ring main: a closed pipe round `centre` in the plane at `z`, an ellipse
 * when `ry` differs from `rx`. Four declarations each wrote the loop.
 */
export function pipeRing(
	pools: Pools,
	{
		centre,
		rx,
		ry = rx,
		z,
		segments = 24,
	}: {
		centre: THREE.Vector3;
		rx: number;
		ry?: number;
		z: number;
		segments?: number;
	},
	radiusKm: number,
) {
	const points: THREE.Vector3[] = [];
	for (let i = 0; i <= segments; i++) {
		const theta = (i / segments) * Math.PI * 2;
		points.push(
			new THREE.Vector3(
				centre.x + Math.cos(theta) * rx,
				centre.y + Math.sin(theta) * ry,
				z,
			),
		);
	}
	pipeRun(pools, points, radiusKm);
}

/** A polyline of tubes with a block at each elbow. */
export function pipeRun(
	pools: Pools,
	points: readonly THREE.Vector3[],
	radiusKm: number,
) {
	for (let i = 0; i + 1 < points.length; i++)
		pools.member(UNIT_TUBE, "pipe", points[i], points[i + 1], radiusKm * 2);
	for (let i = 1; i + 1 < points.length; i++)
		pools.add(
			UNIT_BOX,
			"pipe",
			new THREE.Matrix4().compose(
				points[i],
				new THREE.Quaternion(),
				new THREE.Vector3(radiusKm * 2.6, radiusKm * 2.6, radiusKm * 2.6),
			),
		);
}

/** A truss mast with a dish on top. Returns where the top is, for a beacon. */
export function mast(
	pools: Pools,
	into: THREE.Group,
	{
		base,
		up,
		heightKm,
		widthKm,
	}: {
		/** The mast's foot on the surface. */
		base: THREE.Vector3;
		/** Which way it stands. */
		up: THREE.Vector3;
		/** Foot to dish. */
		heightKm: number;
		/** The truss's width; the dish is 1.9 of it across. */
		widthKm: number;
	},
) {
	const top = base.clone().addScaledVector(up.clone().normalize(), heightKm);
	truss(pools, base, top, widthKm, new THREE.Vector3(0, 0, 1));
	const dish = new THREE.Mesh(
		revolve(
			[
				[widthKm * 0.3, -widthKm * 0.6],
				[widthKm * 1.6, widthKm * 0.5],
				[widthKm * 1.9, widthKm * 0.8],
			],
			12,
		),
		MATERIALS.structure,
	);
	dish.position.copy(top);
	dish.quaternion.setFromUnitVectors(UNIT_Z, up.clone().normalize());
	dish.name = "dish";
	into.add(dish);
	return top;
}

/**
 * A ring round a slot with approach lamps on it, standing proud of the
 * aperture plane. The ring's inner radius is the caller's, and it is the
 * caller's job to keep it outside the corridor — the row that sweeps every
 * form is what checks it, and this function cannot know a slot's diagonal.
 *
 * A square-section torus rather than a loft: `hullLoft` caps both ends with a
 * fan across the whole disc, which is a plate over the hole.
 */
function dockingCollar(
	into: THREE.Group,
	planeKm: number,
	innerKm: number,
	outerKm: number,
	lampMaterial: THREE.MeshStandardMaterial,
) {
	const tube = (outerKm - innerKm) / 2;
	const major = innerKm + tube;
	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(major, tube, 4, 24),
		MATERIALS.structure,
	);
	ring.position.z = planeKm + tube * 0.6;
	ring.name = "docking-collar";
	into.add(ring);
	const lamps = new THREE.InstancedMesh(UNIT_BOX, lampMaterial, 8);
	const matrix = new THREE.Matrix4();
	const glowAt: THREE.Vector3[] = [];
	for (let i = 0; i < 8; i++) {
		const theta = ((i + 0.5) / 8) * Math.PI * 2;
		matrix.compose(
			new THREE.Vector3(
				Math.cos(theta) * (outerKm + tube * 0.9),
				Math.sin(theta) * (outerKm + tube * 0.9),
				planeKm + tube * 0.6,
			),
			new THREE.Quaternion().setFromAxisAngle(UNIT_Z, theta),
			// A real approach lamp (#300), not a box a collar's tube wide.
			new THREE.Vector3(0.003, 0.0015, 0.0015),
		);
		lamps.setMatrixAt(i, matrix);
		glowAt.push(new THREE.Vector3().setFromMatrixPosition(matrix));
	}
	lamps.instanceMatrix.needsUpdate = true;
	lamps.name = "approach-lamps";
	lamps.add(
		glowPoints(
			"approach-lamps",
			glowAt,
			0.003,
			0.0015,
			// The lamp's own colour and intensity, read off the material it was
			// handed rather than passed a second time beside it.
			steadyGlowMaterial(
				lampMaterial.emissive.getHex(),
				lampMaterial.emissiveIntensity,
				"pane",
			),
		),
	);
	into.add(lamps);
}

/**
 * Cast a declared point back along its normal onto the structure, and land it
 * there. The greebles' mounting rule, at fixture scale: tight outward, so a
 * fixture cannot be pulled onto something in front of its surface, and as far
 * inward as the station is wide, because the first thing the ray meets going
 * in *is* the surface the declaration pointed at. A miss leaves the point
 * where it was written, which the reach and corridor rows then judge.
 */
function mounter(structure: THREE.Object3D, type: StationType) {
	// The clutter's cast, fallback included (`station-greebles.ts`): the two
	// had the same lines and had drifted once.
	const cast = castOntoStructure(structure, type);
	return (point: THREE.Vector3, normal: THREE.Vector3, probeKm: number) => {
		const hit = cast(point, normal.clone().normalize(), probeKm);
		return hit ? hit.point.clone() : point.clone();
	};
}

/** What one form's fixtures are built against. */
interface FixtureSite {
	type: StationType;
	formId: StationFormId;
	/** The form as built so far, in kilometres, for mounting. */
	structure: THREE.Object3D;
	/** The station's clock-driven materials; beacons are pushed here. */
	fixtures: StationFixture[];
	/** Whether to add strobing beacons — a role that spins, on a finish that
	 *  asks for them. A refinery's beacon would mark a rotation it has not. */
	beacons: boolean;
	/** The strobe intensity, from the station's own emissive record. */
	strobeBase: number;
	/** The fixed intensity of an approach lamp. */
	lampBase: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Build a form's macro fixtures. A form without a declaration gets an empty
 * group — every trade form and the three other selected forms carry one, and
 * the remaining pool forms are forms nobody has looked at under a finish.
 */
export function buildMacroFixtures(site: FixtureSite): THREE.Group {
	const group = new THREE.Group();
	group.name = "macro-fixtures";
	// `detail()` is `station-mesh.ts`'s, and this module cannot import it
	// without a cycle; the tag is the same field it writes, and
	// `buildStationForm` collects on the field.
	group.userData.minDetail = "reduced" satisfies StationDetailLevel;
	const pools = new Pools();
	const mount = mounter(site.structure, site.type);
	const visuals = STATION_VISUALS[site.type];
	const lampMaterial = new THREE.MeshStandardMaterial({
		color: 0x101014,
		emissive: visuals.windowColor,
		emissiveIntensity: site.lampBase,
		roughness: 0.4,
	});
	const beaconAt = (position: THREE.Vector3, sizeKm: number) => {
		if (!site.beacons) return;
		const kind: StationFixtureKind =
			site.fixtures.filter((f) => f.kind.startsWith("strobe")).length % 2 === 0
				? "strobe-a"
				: "strobe-b";
		const material = new THREE.MeshStandardMaterial({
			color: 0x101014,
			emissive: visuals.strobeColor,
			emissiveIntensity: 0,
			roughness: 0.4,
		});
		const lamp = new THREE.Mesh(
			new THREE.BoxGeometry(sizeKm, sizeKm, sizeKm * 0.6),
			material,
		);
		lamp.position.copy(position);
		lamp.name = `beacon-${kind}`;
		// Its glare, as `station-glow.ts` gives every station light (#300): a
		// 2 m beacon is under a pixel at two kilometres, and "reads as a point
		// through bloom" was a job the old 8 m box was doing by being too big.
		const glow = glowMaterial(visuals.strobeColor, 0, "point");
		lamp.add(
			glowPoints(lamp.name, [new THREE.Vector3()], sizeKm, sizeKm * 0.75, glow),
		);
		group.add(lamp);
		site.fixtures.push({ material, base: site.strobeBase, kind, glow });
	};

	const declaration = DECLARATIONS[`${site.type}/${site.formId}`];
	if (declaration)
		declaration({ site, group, pools, mount, beaconAt, lampMaterial });
	pools.emit(group, "fixture", "full");
	return group;
}

interface DeclarationContext {
	site: FixtureSite;
	group: THREE.Group;
	pools: Pools;
	mount: ReturnType<typeof mounter>;
	beaconAt: (position: THREE.Vector3, sizeKm: number) => void;
	lampMaterial: THREE.MeshStandardMaterial;
}

/**
 * **Ship scale.** The principal's ruling on the first sheet (2026-09-06): a
 * station is huge beside a ship, and details sized to the station — the
 * Coriolis's first trusses were 47 m wide — hide that, because nothing in
 * the frame says how big anything is. Details sized to a ship say it. A
 * courier is 57.5 m long, 51 m in the beam and 12 m tall (`hull.ts`), so a
 * truss is a ship's height wide, a radiator panel half a ship, a tank a
 * ship's height across and a ship long, a pipe a hatch. Every declaration
 * below and the assembly (`station-mesh.ts`) read from here, in kilometres,
 * and `tests/station-finish.test.ts` reads every member back against the
 * caps. Counts rose as sizes fell: the pools make a member cheap.
 */
export const SHIP_SCALE = {
	/** A truss's section, side to side. */
	trussKm: 0.012,
	/** A leaf's strut, a brace, a mast's lattice. */
	strutKm: 0.008,
	/** A radiator panel across its spine, and its height off the surface. */
	panelKm: 0.03,
	panelHeightKm: 0.024,
	/** One tank's radius and length. */
	tankKm: 0.008,
	tankLengthKm: 0.055,
	/** A pipe's radius. */
	pipeKm: 0.002,
	/** A comms mast's lattice and height; the dish is 1.9 lattices across. */
	mastKm: 0.008,
	mastHeightKm: 0.09,
	/** A beacon's lamp: a real one (#300). It was 8 m so that it would read as
	 *  a point at two kilometres through bloom; its glow does that now, and the
	 *  principal ruled every station light too big for a km-scale station. */
	beaconKm: 0.002,
	/** The docking collar's band, out from its inner radius. */
	collarKm: 0.016,
	/**
	 * What the test holds every pooled member to, by material, kilometres:
	 * the two thin axes of a structure member (a 12 m truss's members are
	 * 1.7 m), a panel's longest axis, a tank's diameter, a pipe's diameter
	 * with its elbow blocks. A figure over its cap is a fixture back at
	 * station scale.
	 */
	caps: {
		structure: 0.003,
		radiator: 0.035,
		tank: 0.018,
		pipe: 0.006,
	},
} as const;

/**
 * Where each selected form's structure goes, in its own kilometres.
 *
 * Positions are fractions of the form's own core radius; sizes are
 * `SHIP_SCALE`'s. Every base point lies on or inside a surface the form
 * draws; the reach margin is stated where it is tight. Nothing is placed on
 * the +Z docking face inside the corridor, and nothing on a shipyard's spun
 * hub.
 */
const DECLARATIONS: Partial<
	Record<
		`${StationType}/${StationFormId}`,
		(context: DeclarationContext) => void
	>
> = {
	/**
	 * Trade A — Coriolis. A cuboctahedron of radius 0.95·r whose square faces
	 * sit at `face = 0.95·r/√2` and whose corners, at 0.95·r, are the outline:
	 * a fixture at a face's centre has √2 of headroom to the reach and one at a
	 * corner has none, so everything below sits on a face's middle band.
	 */
	"trade/a": ({ group, pools, mount, beaconAt, lampMaterial }) => {
		const r = STATION_GEOMETRY.trade.coreRadiusKm * 0.95;
		const face = r * Math.SQRT1_2;
		const S = SHIP_SCALE;
		const slot = STATION_GEOMETRY.trade.aperture;
		// The collar, clear of the corridor: its inner radius is 1.35× the
		// slot's half-diagonal, which is the cylinder the corridor row sweeps.
		const diagonal = Math.hypot(slot.widthKm / 2, slot.heightKm / 2);
		dockingCollar(
			group,
			STATION_GEOMETRY.trade.aperturePlaneKm,
			diagonal * 1.35,
			diagonal * 1.35 + S.collarKm,
			lampMaterial,
		);
		// **The headroom is the corner's, not the face's.** A point on a face
		// at lateral offset `d` may stand `h` proud only while
		// `hypot(face + h, d) < r`: 0.167 km at the face's centre, 0.11 km at
		// d = 0.6·face, nothing at all at the corner. Nothing below stands more
		// than 0.03 km proud, and nothing sits past 0.62·face from a face's
		// centre in either axis; `tests/station-finish.test.ts` reads the
		// outline at every level to hold it.
		//
		// Two ladders across the ±X faces: a pair of trusses running along Y,
		// 0.1·face apart, with a rung between them every 0.25·face, and a
		// beacon on each truss's end.
		for (const sign of [1, -1]) {
			const base = mount(V(sign * face, 0, 0), V(sign, 0, 0), face * 0.2);
			const x = base.x + sign * S.trussKm * 0.6;
			for (const lane of [-0.05, 0.05]) {
				const a = V(x, -face * 0.62, lane * face);
				const b = V(x, face * 0.62, lane * face);
				truss(pools, a, b, S.trussKm, V(sign, 0, 0));
				// On the truss's end frame, not beyond it: a lamp set past the
				// end by more than its own half-size is a lamp nothing supports.
				beaconAt(a.clone().add(V(sign * S.trussKm * 0.5, 0, 0)), S.beaconKm);
				beaconAt(b.clone().add(V(sign * S.trussKm * 0.5, 0, 0)), S.beaconKm);
			}
			for (let rung = -2; rung <= 2; rung++)
				truss(
					pools,
					V(x, rung * face * 0.25, -face * 0.05),
					V(x, rung * face * 0.25, face * 0.05),
					S.strutKm,
					V(sign, 0, 0),
				);
		}
		// Radiator banks on the ±Y faces: three banks a face, fins along Z,
		// side by side across X on the face's middle band.
		for (const sign of [1, -1]) {
			const base = mount(V(0, sign * face, 0), V(0, sign, 0), face * 0.2);
			for (const lane of [-0.3, 0, 0.3])
				radiatorArray(pools, {
					origin: base.clone().add(V(lane * face, 0, -face * 0.25)),
					along: V(0, 0, 1),
					up: V(0, sign, 0),
					count: 12,
					panelWidthKm: S.panelKm,
					panelHeightKm: S.panelHeightKm,
				});
		}
		// A tank farm on the back face, opposite the slot: three racks of six.
		const back = mount(V(0, 0, -face), V(0, 0, -1), face * 0.2);
		for (const lane of [-0.22, 0, 0.22])
			tankRack(pools, {
				origin: back.clone().add(V(0, lane * face, 0)),
				along: V(1, 0, 0),
				up: V(0, 0, -1),
				count: 6,
				radiusKm: S.tankKm,
				lengthKm: S.tankLengthKm,
			});
		// A ring main round the tank farm, and feeds from it round onto the
		// ±X faces, every elbow on a surface.
		pipeRing(
			pools,
			{ centre: back, rx: face * 0.5, ry: face * 0.4, z: back.z, segments: 8 },
			S.pipeKm,
		);
		for (const sign of [1, -1])
			for (const lane of [-0.18, 0.18])
				pipeRun(
					pools,
					[
						V(sign * face * 0.5, lane * face, -face - S.pipeKm),
						V(sign * (face + S.pipeKm), lane * face, -face * 0.5),
						V(sign * (face + S.pipeKm), lane * face, face * 0.2),
					],
					S.pipeKm,
				);
		// Comms masts: two off the +X face aft of the ladder and one off −X,
		// each with a beacon. 0.5·face along −Z leaves 0.15·face of headroom
		// and a mast is 0.09 km with its dish.
		for (const [sign, z] of [
			[1, -0.5],
			[1, -0.35],
			[-1, -0.45],
		] as const) {
			const foot = mount(
				V(sign * face, 0, z * face),
				V(sign, 0, 0),
				face * 0.2,
			);
			const top = mast(pools, group, {
				base: foot,
				up: V(sign, 0, 0),
				heightKm: S.mastHeightKm,
				widthKm: S.mastKm,
			});
			beaconAt(top.clone().add(V(sign * S.beaconKm * 0.6, 0, 0)), S.beaconKm);
		}
	},

	/**
	 * Trade B — Ring. A spun torus (major 0.92·r, tube 0.13·r) carrying
	 * twelve habitat modules on its equator, on A-frame spokes; the whole
	 * body spins. Its reach, 0.73 km, is the fin plates', so everything here
	 * sits on the rim's two faces and its inner wall, where a mast's 0.09 km
	 * of height stays 0.15 km inside the reach. The equator belongs to the
	 * modules and is left to them.
	 */
	"trade/b": ({ group, pools, beaconAt }) => {
		const r = STATION_GEOMETRY.trade.coreRadiusKm;
		const S = SHIP_SCALE;
		const major = r * 0.92;
		const tube = r * 0.13;
		const TURN = Math.PI * 2;
		const at = (theta: number, radius: number, z: number) =>
			V(Math.cos(theta) * radius, Math.sin(theta) * radius, z);
		for (const side of [1, -1]) {
			// A ring main round the face, on the torus at 45° up from the
			// equator; a lattice ring on the face's crown; six radiator banks
			// on the face between the modules, fins along the rim.
			pipeRing(
				pools,
				{
					centre: V(0, 0, 0),
					rx: major + tube * 0.71,
					z: side * tube * 0.71,
					segments: 36,
				},
				S.pipeKm,
			);
			for (let i = 0; i < 24; i++)
				truss(
					pools,
					at((i / 24) * TURN, major, side * tube * 0.97),
					at(((i + 1) / 24) * TURN, major, side * tube * 0.97),
					S.trussKm,
					V(0, 0, side),
				);
			for (let i = 0; i < 6; i++) {
				const theta = ((2 * i + 0.5) / 12) * TURN;
				radiatorArray(pools, {
					origin: at(theta, major + tube * 0.45, side * tube * 0.89),
					along: at(theta + Math.PI / 2, 1, 0),
					up: V(0, 0, side),
					count: 6,
					panelWidthKm: S.panelKm,
					panelHeightKm: S.panelHeightKm,
				});
			}
		}
		// Tank racks on the inner wall, four of them, tanks along the rim.
		for (let i = 0; i < 4; i++) {
			const theta = ((i + 0.5) / 4) * TURN;
			tankRack(pools, {
				origin: at(theta, major - tube * 0.98, 0),
				along: at(theta + Math.PI / 2, 1, 0),
				up: at(theta, -1, 0),
				count: 5,
				radiusKm: S.tankKm,
				lengthKm: S.tankLengthKm,
			});
		}
		// Two masts on the +Z face, and a beacon on each lattice ring's
		// quarter, on the ring.
		for (const theta of [0, Math.PI]) {
			const top = mast(pools, group, {
				base: at(theta, major, tube * 0.98),
				up: V(0, 0, 1),
				heightKm: S.mastHeightKm,
				widthKm: S.mastKm,
			});
			beaconAt(top.clone().add(V(0, 0, S.beaconKm * 0.6)), S.beaconKm);
		}
		for (let i = 0; i < 4; i++)
			beaconAt(
				at((i / 4) * TURN + Math.PI / 4, major, tube * 0.97 + S.beaconKm * 0.4),
				S.beaconKm,
			);
	},

	/**
	 * Trade C — Drum. A twelve-sided body 0.46·r across from z −1.02·r to
	 * 0.88·r wearing two raised bands; the whole body spins. Nothing crosses
	 * a band: the ladders run between them, the radiator banks and tank
	 * racks outside them, and the pipe rings sit against them. Reach 0.66 km
	 * is the aft cap's; a mast on the flank at 0.7·r reaches 0.56.
	 */
	"trade/c": ({ group, pools, mount, beaconAt }) => {
		const r = STATION_GEOMETRY.trade.coreRadiusKm;
		const S = SHIP_SCALE;
		const body = r * 0.46;
		const TURN = Math.PI * 2;
		const radial = (theta: number) => V(Math.cos(theta), Math.sin(theta), 0);
		/** A point on the flank's facet at `theta`, `z`, cast onto the hull. */
		const flank = (theta: number, z: number) =>
			mount(
				radial(theta).multiplyScalar(body).setZ(z),
				radial(theta),
				body * 0.3,
			);
		// Four ladders between the bands, at the quarters' diagonals: two
		// trusses a ship's height apart with a rung every 0.12·r.
		for (let k = 0; k < 4; k++) {
			const theta = Math.PI / 4 + (k / 4) * TURN;
			const lane = (S.trussKm * 1.4) / body;
			for (const side of [-1, 1]) {
				const a = flank(theta + side * lane, -r * 0.36);
				const b = flank(theta + side * lane, r * 0.11);
				truss(pools, a, b, S.trussKm, radial(theta));
				beaconAt(
					b.clone().addScaledVector(radial(theta), S.trussKm * 0.5),
					S.beaconKm,
				);
			}
			for (let rung = 0; rung < 4; rung++)
				truss(
					pools,
					flank(theta - lane, -r * 0.3 + rung * r * 0.12),
					flank(theta + lane, -r * 0.3 + rung * r * 0.12),
					S.strutKm,
					radial(theta),
				);
		}
		// Radiator banks on the quarters, aft of the aft band and forward of
		// the forward band, fins along the drum.
		for (let k = 0; k < 4; k++) {
			const theta = (k / 4) * TURN;
			for (const z of [-r * 0.85, r * 0.32])
				radiatorArray(pools, {
					origin: flank(theta, z),
					along: V(0, 0, 1),
					up: radial(theta),
					count: 8,
					panelWidthKm: S.panelKm,
					panelHeightKm: S.panelHeightKm,
				});
		}
		// Tank racks forward of the forward band, on the diagonals.
		for (let k = 0; k < 4; k++) {
			const theta = Math.PI / 4 + (k / 4) * TURN;
			tankRack(pools, {
				origin: flank(theta, r * 0.6),
				along: V(0, 0, 1),
				up: radial(theta),
				count: 4,
				radiusKm: S.tankKm,
				lengthKm: S.tankLengthKm,
			});
		}
		// Pipe rings against each band's shoulders, and one round the waist.
		for (const z of [-r * 0.55, -r * 0.35, r * 0.1, r * 0.3, -r * 0.12])
			pipeRing(
				pools,
				{ centre: V(0, 0, 0), rx: body + S.pipeKm * 0.5, z },
				S.pipeKm,
			);
		// Two masts on the forward flank, opposite each other.
		for (const theta of [Math.PI / 4, Math.PI * 1.25]) {
			const top = mast(pools, group, {
				base: flank(theta, r * 0.7),
				up: radial(theta),
				heightKm: S.mastHeightKm,
				widthKm: S.mastKm,
			});
			beaconAt(
				top.clone().addScaledVector(radial(theta), S.beaconKm * 0.6),
				S.beaconKm,
			);
		}
	},

	/**
	 * Shipyard A — Gantry. Everything hangs on the static keel and its rails,
	 * whose z is read off the keel itself rather than restated: the keel sits
	 * where `SHIPYARD_KEEL_AFT_KM` put it and moved once already. The spun hub
	 * carries nothing. The braces from each boom's tip triangulate the yoke
	 * the form gives the boom's root; the beacons mark the tips.
	 */
	"shipyard/a": ({ site, group, pools, mount, beaconAt }) => {
		const r = STATION_GEOMETRY.shipyard.coreRadiusKm;
		const S = SHIP_SCALE;
		const keel = site.structure.getObjectByName("keel");
		if (!keel) throw new Error("the Gantry's keel is not named");
		const aft = -keel.position.z;
		// A lattice bridge along each rail's top, the keel's length, and a
		// pipe along each boom from its root to the tip.
		for (const side of [1, -1]) {
			truss(
				pools,
				V(-r * 2.0, side * r * 0.58, -aft + r * 0.09),
				V(r * 2.0, side * r * 0.58, -aft + r * 0.09),
				S.trussKm,
				V(0, 0, 1),
			);
			pipeRun(
				pools,
				[
					V(0, side * r * 0.89, -r * 1.0),
					V(0, side * r * 0.89, r * 0.2),
					V(0, side * r * 0.89, r * 1.4),
				],
				S.pipeKm,
			);
		}
		// Radiator banks on the keel's top, aft half: two rows of twelve.
		for (const row of [-0.16, 0.16]) {
			const keelTop = mount(
				V(-r * 1.4, r * 0.3, -aft + row * r),
				V(0, 1, 0),
				r * 0.3,
			);
			radiatorArray(pools, {
				origin: keelTop,
				along: V(1, 0, 0),
				up: V(0, 1, 0),
				count: 12,
				panelWidthKm: S.panelKm,
				panelHeightKm: S.panelHeightKm,
			});
		}
		// Tank racks under the keel, forward half: two racks of six.
		for (const row of [-0.12, 0.12]) {
			const keelUnder = mount(
				V(r * 1.0, -r * 0.3, -aft + row * r),
				V(0, -1, 0),
				r * 0.3,
			);
			tankRack(pools, {
				origin: keelUnder,
				along: V(1, 0, 0),
				up: V(0, -1, 0),
				count: 6,
				radiusKm: S.tankKm,
				lengthKm: S.tankLengthKm,
			});
		}
		// Two braces from each boom's tip back to the keel's rail: the boom
		// reads as carried, and the yoke at its root is triangulated.
		for (const sign of [1, -1]) {
			const tip = V(0, sign * r * 0.8, r * 1.5);
			for (const x of [-r * 0.5, r * 0.5]) {
				const rail = V(x, sign * r * 0.58, -aft + r * 0.05);
				truss(pools, tip, rail, S.strutKm, V(0, sign, 0));
			}
			beaconAt(V(0, sign * r * 0.8, r * 1.88), S.beaconKm);
		}
		// Pipe runs along the keel's shoulders, both flanks.
		for (const sign of [1, -1])
			for (const lane of [0.22, 0.3])
				pipeRun(
					pools,
					[
						V(-r * 2.0, r * lane, -aft + sign * r * 0.24),
						V(-r * 0.6, r * (lane + 0.04), -aft + sign * r * 0.24),
						V(r * 0.5, r * (lane + 0.04), -aft + sign * r * 0.24),
						V(r * 0.9, r * lane, -aft + sign * r * 0.32),
					],
					S.pipeKm,
				);
		// Masts on the keel's aft end and its forward shoulder.
		for (const x of [-r * 2.1, -r * 1.8]) {
			const foot = mount(V(x, r * 0.2, -aft), V(0, 1, 0), r * 0.3);
			const top = mast(pools, group, {
				base: foot,
				up: V(0, 1, 0),
				heightKm: S.mastHeightKm,
				widthKm: S.mastKm,
			});
			beaconAt(top.clone().add(V(0, S.beaconKm * 0.6, 0)), S.beaconKm);
		}
	},

	/**
	 * Refinery A — Warren. A rock of radius ~0.95·r with terraces cut into its
	 * +Z face and two flare stacks canted out of it; three radiator wings at
	 * 1.45·r are the outline and nothing here approaches them. Every base is
	 * cast onto the rock. No beacons: the role does not spin, and the caller
	 * passes none.
	 */
	"refinery/a": ({ group, pools, mount }) => {
		const r = STATION_GEOMETRY.refinery.coreRadiusKm;
		const S = SHIP_SCALE;
		// A lattice frame round the tank farm, four trusses on the rock, and a
		// second crane on the −X shoulder.
		for (const [a, b] of [
			[V(-r * 0.4, -r * 0.8, r * 0.4), V(r * 0.4, -r * 0.8, r * 0.4)],
			[V(-r * 0.4, -r * 0.8, -r * 0.2), V(r * 0.4, -r * 0.8, -r * 0.2)],
			[V(-r * 0.4, -r * 0.8, r * 0.4), V(-r * 0.4, -r * 0.8, -r * 0.2)],
			[V(r * 0.4, -r * 0.8, r * 0.4), V(r * 0.4, -r * 0.8, -r * 0.2)],
		] as const)
			truss(
				pools,
				mount(a, V(0, -1, 0), r * 0.6),
				mount(b, V(0, -1, 0), r * 0.6),
				S.strutKm,
				V(0, -1, 0),
			);
		{
			const rim = mount(
				V(-r * 0.7, r * 0.3, r * 0.45),
				V(-0.6, 0.5, 0.6),
				r * 0.5,
			);
			truss(
				pools,
				rim,
				rim.clone().add(V(-r * 0.55, r * 0.5, -r * 0.1)),
				S.trussKm,
				V(0, 0, 1),
			);
		}
		// Tank farm on the rock's −Y flank: three racks of six.
		for (const lane of [-0.2, 0, 0.2]) {
			const flank = mount(
				V(0, -r * 0.9, r * 0.1 + lane * r),
				V(0, -1, 0),
				r * 0.6,
			);
			tankRack(pools, {
				origin: flank,
				along: V(1, 0, 0),
				up: V(0, -1, 0),
				count: 6,
				radiusKm: S.tankKm,
				lengthKm: S.tankLengthKm,
			});
		}
		// Pipe runs from the terraces over the rock to the tanks, each point
		// landed on the surface; two a side.
		for (const sign of [1, -1])
			for (const lane of [0.42, 0.56]) {
				const points = [
					V(sign * r * lane, -r * 0.05, r * 0.55),
					V(sign * r * (lane + 0.1), -r * 0.45, r * 0.4),
					V(sign * r * lane, -r * 0.8, r * 0.2),
				].map((point) => {
					const normal = point.clone().normalize();
					return mount(point, normal, r * 0.5).addScaledVector(
						normal,
						S.pipeKm * 1.5,
					);
				});
				pipeRun(pools, points, S.pipeKm);
			}
		// A crane truss off the rock's +X+Y shoulder, and a second below it.
		for (const drop of [0, -0.16]) {
			const rim = mount(
				V(r * 0.7, r * (0.3 + drop), r * 0.45),
				V(0.6, 0.5, 0.6),
				r * 0.5,
			);
			truss(
				pools,
				rim,
				rim.clone().add(V(r * 0.55, r * 0.5, -r * 0.1)),
				S.trussKm,
				V(0, 0, 1),
			);
		}
		// Masts on the rock's +Y crown, between the stacks.
		for (const x of [-r * 0.12, r * 0.12]) {
			const crown = mount(V(x, r * 0.95, -r * 0.2), V(0, 1, 0), r * 0.6);
			mast(pools, group, {
				base: crown,
				up: V(0, 1, 0),
				heightKm: S.mastHeightKm,
				widthKm: S.mastKm,
			});
		}
	},

	/**
	 * Outpost A — Derrick. Four tanks in a cluster below z = −1.1·r, a lattice
	 * tower up to the pad deck at +Z. Reach 0.42 km on a 0.15 km core. Nothing
	 * goes near the +Z axis inside the pad's half-diagonal.
	 */
	/**
	 * Refinery D — Works. The rock is the station (#257), so everything here
	 * is mounted **on the rock** rather than on the plant: a ring main round
	 * its waist, tank racks on the −Y flank, and a service truss along the
	 * quarry rim. The plant on the floor is the form's own and carries its
	 * own pipes; a fixture that stood among it would be detail on detail.
	 */
	"refinery/d": ({ pools, mount }) => {
		const r = STATION_GEOMETRY.refinery.coreRadiusKm;
		const S = SHIP_SCALE;
		// A ring main round the rock's waist, every point landed on the surface
		// and stood off it by its own radius.
		const ring: THREE.Vector3[] = [];
		for (let i = 0; i <= 14; i++) {
			const theta = (i / 14) * Math.PI * 2;
			const outward = V(Math.cos(theta), Math.sin(theta), 0);
			ring.push(
				mount(
					outward.clone().multiplyScalar(r * 1.7),
					outward,
					r * 0.9,
				).addScaledVector(outward, S.pipeKm * 1.5),
			);
		}
		pipeRun(pools, ring, S.pipeKm);
		// Tank racks on the −Y flank, two lanes, standing off the rock.
		for (const lane of [-0.28, 0.28]) {
			const flank = mount(
				V(lane * r, -r * 1.7, -r * 0.3),
				V(0, -1, 0),
				r * 0.9,
			);
			tankRack(pools, {
				origin: flank,
				along: V(0, 0, 1),
				up: V(0, -1, 0),
				count: 5,
				radiusKm: S.tankKm,
				lengthKm: S.tankLengthKm,
			});
		}
		// A service truss along the quarry rim, +X side, landed on the floor at
		// both ends so it runs with the surface rather than through it.
		for (const sign of [1, -1]) {
			const a = mount(
				V(sign * r * 0.95, -r * 0.5, r * 0.9),
				V(0, 0, 1),
				r * 0.8,
			);
			const b = mount(
				V(sign * r * 0.95, r * 0.5, r * 0.9),
				V(0, 0, 1),
				r * 0.8,
			);
			truss(pools, a, b, S.trussKm, V(0, 0, 1));
		}
	},

	/**
	 * Outpost D — Cluster. A lattice belt round the core can, a pipe run out
	 * along the spine, and a radiator bank on the −X can's flank. Small, and
	 * off the pad's own face: the deck is 0.31 km across on a 0.15 km core,
	 * so a fixture forward of the plane is in the corridor.
	 */
	"outpost/d": ({ pools, mount }) => {
		const r = STATION_GEOMETRY.outpost.coreRadiusKm;
		const S = SHIP_SCALE;
		// The belt: four trusses round the core can, well behind the deck.
		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
			const b = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
			truss(
				pools,
				V(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, -r * 0.42),
				V(Math.cos(b) * r * 0.42, Math.sin(b) * r * 0.42, -r * 0.42),
				S.strutKm,
				V(0, 0, 1),
			);
		}
		// A pipe run out along the spine both ways, on the −Z side of it.
		for (const sign of [1, -1])
			pipeRun(
				pools,
				[
					V(0, sign * r * 0.2, -r * 0.24),
					V(0, sign * r * 0.9, -r * 0.24),
					V(0, sign * r * 1.5, -r * 0.24),
				],
				S.pipeKm * 0.75,
			);
		// A radiator bank on the −X can's underside, behind the deck.
		const flank = mount(V(-r * 0.7, 0, -r * 0.2), V(0, 0, -1), r * 0.5);
		radiatorArray(pools, {
			origin: flank,
			along: V(-1, 0, 0),
			up: V(0, 0, -1),
			count: 6,
			panelWidthKm: S.panelKm * 0.7,
			panelHeightKm: S.panelHeightKm * 0.7,
		});
	},

	"outpost/a": ({ group, pools, mount, beaconAt }) => {
		const r = STATION_GEOMETRY.outpost.coreRadiusKm;
		const S = SHIP_SCALE;
		// A lattice belt round the tower's legs, and a pipe up two of them
		// from the tanks toward the deck.
		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
			const b = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
			truss(
				pools,
				V(Math.cos(a) * r * 0.46, Math.sin(a) * r * 0.46, -r * 0.3),
				V(Math.cos(b) * r * 0.46, Math.sin(b) * r * 0.46, -r * 0.3),
				S.strutKm,
				V(0, 0, 1),
			);
		}
		for (const theta of [Math.PI / 4, Math.PI * 1.25])
			pipeRun(
				pools,
				[
					V(Math.cos(theta) * r * 0.5, Math.sin(theta) * r * 0.5, -r * 1.1),
					V(Math.cos(theta) * r * 0.5, Math.sin(theta) * r * 0.5, -r * 0.6),
					V(Math.cos(theta) * r * 0.5, Math.sin(theta) * r * 0.5, -r * 0.1),
				],
				S.pipeKm * 0.75,
			);
		// Radiator banks on the tank cluster's −X flank, shifted +z so the
		// bank sits beside the tanks rather than below them: **the tanks'
		// bottom corner is this form's outline** at 0.307 km, and a fin
		// standing below it was the farthest vertex.
		const flank = mount(V(-r * 0.76, 0, -r * 1.5), V(-1, 0, 0), r * 0.4);
		for (const lane of [-0.2, 0.2])
			radiatorArray(pools, {
				origin: flank.clone().add(V(0, lane * r, -r * 0.05)),
				along: V(0, 0, 1),
				up: V(-1, 0, 0),
				count: 6,
				panelWidthKm: S.panelKm * 0.6,
				panelHeightKm: S.panelHeightKm * 0.7,
			});
		// Two ring mains round the cluster's waist.
		for (const z of [-1.45, -1.3])
			pipeRing(
				pools,
				{ centre: V(0, 0, 0), rx: r * 0.82, z: z * r, segments: 12 },
				S.pipeKm * 0.75,
			);
		// A short mast off the tower, leaning outward and clear of the pad.
		const leg = V(r * 0.46 * Math.SQRT1_2, r * 0.46 * Math.SQRT1_2, -r * 0.6);
		const top = mast(pools, group, {
			base: leg,
			up: V(0.7, 0.7, 0.6),
			heightKm: S.mastHeightKm * 0.8,
			widthKm: S.mastKm * 0.7,
		});
		beaconAt(
			top.clone().add(V(S.beaconKm * 0.4, S.beaconKm * 0.4, 0)),
			S.beaconKm * 0.8,
		);
		beaconAt(V(-r * 0.76, 0, -r * 1.25), S.beaconKm * 0.8);
	},
};
